import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import { detectDx5Header, unpackDx5Archive } from "./archive/dx5.mjs";
import { detectDx6Header, unpackDx6Archive } from "./archive/dx6.mjs";
import { unpackDx8Archive } from "./archive/dx8.mjs";
import { findWolfProMode, isWolfProKeyArchive } from "./archive/wolf-pro.mjs";
import {
  ensureNewDestination,
  isArchivePath,
  listFiles,
  requireOutsideDirectory,
} from "./files.mjs";

async function copyWithoutArchives(source, destination) {
  const details = await stat(source);
  if (details.isFile()) {
    if (!isArchivePath(source)) await cp(source, destination);
    return;
  }

  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyWithoutArchives(from, to);
    if (entry.isFile() && !isArchivePath(from)) await cp(from, to);
  }
}

async function unpackArchives(
  sourceFolder,
  destinationFolder,
  { archives: selectedArchives, copyLoose = true } = {},
) {
  if (copyLoose) await copyWithoutArchives(sourceFolder, destinationFolder);
  else await mkdir(destinationFolder, { recursive: true });
  const archives =
    selectedArchives || (await listFiles(sourceFolder)).filter(isArchivePath);
  if (archives.length === 0) {
    throw new Error(`No supported WOLF archives were found in ${sourceFolder}`);
  }
  const target = archives.find((archive) => !isWolfProKeyArchive(archive));
  const cryptVersion = target ? await readCryptVersion(target) : undefined;
  const keyArchive = archives.find(isWolfProKeyArchive);
  const proMode = keyArchive
    ? await findWolfProMode(dirname(keyArchive), cryptVersion)
    : undefined;
  let files = 0;
  const outputs = [];
  for (const archive of archives) {
    if (proMode && isWolfProKeyArchive(archive)) continue;
    const relativeParent = relative(sourceFolder, dirname(archive));
    if (relativeParent === ".." || relativeParent.startsWith(`..${sep}`)) {
      throw new Error(`Archive is outside the source folder: ${archive}`);
    }
    const output = join(destinationFolder, relativeParent, parse(archive).name);
    const result = await unpackArchive(
      archive,
      output,
      proMode ? { modes: [proMode] } : undefined,
    );
    files += result.files;
    outputs.push(output);
  }
  return { archives, files, outputs };
}

async function readCryptVersion(archivePath) {
  const archive = await open(archivePath, "r");
  try {
    const header = Buffer.alloc(48);
    const { bytesRead } = await archive.read(header, 0, header.length, 0);
    if (bytesRead >= 48 && header.toString("ascii", 0, 2) === "DX") {
      return header.readUInt32LE(44) >>> 16;
    }
    return undefined;
  } finally {
    await archive.close();
  }
}

export async function unpackArchive(archivePath, outputDir, options) {
  const archive = await open(archivePath, "r");
  let prefix;
  let archiveBytes;
  try {
    prefix = Buffer.alloc(48);
    const { bytesRead } = await archive.read(prefix, 0, prefix.length, 0);
    prefix = prefix.subarray(0, bytesRead);
    archiveBytes = (await archive.stat()).size;
  } finally {
    await archive.close();
  }
  try {
    if (
      prefix.length >= 4 &&
      prefix.toString("ascii", 0, 2) === "DX" &&
      prefix.readUInt16LE(2) === 8
    ) {
      return await unpackDx8Archive(archivePath, outputDir, options);
    }
    if (detectDx5Header(prefix.subarray(0, 28), archiveBytes)) {
      return await unpackDx5Archive(archivePath, outputDir, options);
    }
    if (detectDx6Header(prefix, archiveBytes)) {
      return await unpackDx6Archive(archivePath, outputDir, options);
    }
    throw new Error("The archive format or encryption key is not supported.");
  } catch (error) {
    throw new Error(`Could not unpack ${archivePath}: ${error.message}`, {
      cause: error,
    });
  }
}

export async function unpackWolf({ sourcePath, outputDir }) {
  const source = resolve(sourcePath);
  const details = await stat(source).catch(() => undefined);
  if (!details) throw new Error(`Input was not found: ${source}`);
  const sourceGame = details.isDirectory()
    ? source
    : details.isFile() && /Game(?:Pro)?\.exe$/i.test(basename(source))
      ? dirname(source)
      : undefined;
  const defaultSource = sourceGame || source;
  const requestedDestination =
    outputDir ||
    join(dirname(defaultSource), `${parse(defaultSource).name} unpacked`);
  if (sourceGame)
    await requireOutsideDirectory(requestedDestination, sourceGame);
  const destination = await ensureNewDestination(requestedDestination);

  try {
    if (details.isFile() && isArchivePath(source)) {
      if (isWolfProKeyArchive(source)) {
        throw new Error(
          "This WOLF Pro support archive stores a key and is not a game-data archive.",
        );
      }
      const cryptVersion = await readCryptVersion(source);
      const proMode = await findWolfProMode(dirname(source), cryptVersion);
      await unpackArchive(
        source,
        destination,
        proMode ? { modes: [proMode] } : undefined,
      );
    } else if (details.isFile() && extname(source).toLowerCase() === ".exe") {
      if (!/Game(?:Pro)?\.exe$/i.test(basename(source))) {
        throw new Error("Executable input must be Game.exe or GamePro.exe.");
      }
      await unpackArchives(sourceGame, destination);
    } else if (details.isDirectory()) {
      await unpackArchives(source, destination);
    } else {
      throw new Error(
        "Input must be a WOLF archive, Game.exe, GamePro.exe, or a folder.",
      );
    }

    const files = await listFiles(destination);
    if (files.length === 0) throw new Error("No files were unpacked.");
    return { outputDir: destination, files: files.length };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function unpackWolfInPlace({ sourcePath, archivePaths }) {
  const input = resolve(sourcePath);
  const details = await stat(input).catch(() => undefined);
  if (!details) throw new Error(`Input was not found: ${input}`);
  const source = details.isDirectory()
    ? input
    : details.isFile() && /Game(?:Pro)?\.exe$/i.test(basename(input))
      ? dirname(input)
      : undefined;
  if (!source)
    throw new Error(
      "In-place extraction needs a game folder, Game.exe, or GamePro.exe.",
    );

  const archives = archivePaths
    ? archivePaths.map((path) => resolve(source, path))
    : (await listFiles(source)).filter(isArchivePath);
  if (archives.length === 0)
    throw new Error(`No supported WOLF archives were found in ${source}`);
  for (const archive of archives) {
    const inside = relative(source, archive);
    if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`)) {
      throw new Error(`Archive is outside the game folder: ${archive}`);
    }
  }
  const targets = archives
    .filter((archive) => !isWolfProKeyArchive(archive))
    .map((archive) => join(dirname(archive), parse(archive).name));
  for (const target of targets) {
    if (await stat(target).catch(() => undefined)) {
      throw new Error(
        `Automatic extraction would overwrite an existing file or folder: ${target}`,
      );
    }
  }

  const staging = await mkdtemp(
    join(dirname(source), `.${basename(source)} extract `),
  );
  const moved = [];
  const movedArchives = [];
  try {
    const result = await unpackArchives(source, staging, {
      archives,
      copyLoose: false,
    });
    for (const stagedPath of result.outputs) {
      const target = join(source, relative(staging, stagedPath));
      await mkdir(dirname(target), { recursive: true });
      await rename(stagedPath, target);
      moved.push({ stagedPath, target });
    }
    const archivedRoot = join(staging, ".archives");
    for (const archive of result.archives) {
      const stagedArchive = join(archivedRoot, relative(source, archive));
      await mkdir(dirname(stagedArchive), { recursive: true });
      await rename(archive, stagedArchive);
      movedArchives.push({ archive, stagedArchive });
    }
    return {
      sourceDir: source,
      archives: result.archives.length,
      files: result.files,
    };
  } catch (error) {
    for (const item of movedArchives.reverse()) {
      await mkdir(dirname(item.archive), { recursive: true });
      await rename(item.stagedArchive, item.archive).catch(() => undefined);
    }
    for (const item of moved.reverse()) {
      await mkdir(dirname(item.stagedPath), { recursive: true });
      await rename(item.target, item.stagedPath).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
