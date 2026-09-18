import { cp, mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, parse, resolve } from "node:path";

import { unpackDx6Archive } from "./archive/dx6.mjs";
import { unpackDx8Archive } from "./archive/dx8.mjs";
import { ensureNewDestination, isArchivePath, listFiles } from "./files.mjs";

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

async function unpackArchives(sourceFolder, destinationFolder) {
  await copyWithoutArchives(sourceFolder, destinationFolder);
  const archives = (await listFiles(sourceFolder)).filter(isArchivePath);
  if (archives.length === 0) {
    throw new Error(`No supported WOLF archives were found in ${sourceFolder}`);
  }
  let files = 0;
  for (const archive of archives) {
    const relativeParent = dirname(archive).slice(sourceFolder.length).replace(/^[/\\]+/, "");
    const output = join(destinationFolder, relativeParent, parse(archive).name);
    const result = await unpackArchive(archive, output);
    files += result.files;
  }
  return files;
}

async function unpackArchive(archivePath, outputDir) {
  const archive = await open(archivePath, "r");
  let prefix;
  try {
    prefix = Buffer.alloc(4);
    await archive.read(prefix, 0, prefix.length, 0);
  } finally {
    await archive.close();
  }
  if (prefix.toString("ascii", 0, 2) === "DX" && prefix.readUInt16LE(2) === 8) {
    return unpackDx8Archive(archivePath, outputDir);
  }
  return unpackDx6Archive(archivePath, outputDir);
}

export async function unpackWolf({ sourcePath, outputDir }) {
  const source = resolve(sourcePath);
  const details = await stat(source).catch(() => undefined);
  if (!details) throw new Error(`Input was not found: ${source}`);
  const destination = await ensureNewDestination(
    outputDir || join(dirname(source), `${parse(source).name} unpacked`),
  );

  try {
    if (details.isFile() && isArchivePath(source)) {
      await unpackArchive(source, destination);
    } else if (details.isFile() && extname(source).toLowerCase() === ".exe") {
      if (!/Game(?:Pro)?\.exe$/i.test(basename(source))) {
        throw new Error("Executable input must be Game.exe or GamePro.exe.");
      }
      const sourceGame = dirname(source);
      await unpackArchives(sourceGame, destination);
    } else if (details.isDirectory()) {
      await unpackArchives(source, destination);
    } else {
      throw new Error("Input must be a WOLF archive, Game.exe, GamePro.exe, or a folder.");
    }

    const files = await listFiles(destination);
    if (files.length === 0) throw new Error("No files were unpacked.");
    return { outputDir: destination, files: files.length };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
