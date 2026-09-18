import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { packDx6Archive } from "./archive/dx6.mjs";
import { PACK_MODES } from "./constants.mjs";
import { ensureNewDestination, exists, isArchivePath, requireDirectory } from "./files.mjs";

function resolveMode(value = "2.20") {
  const normalized = value.toLowerCase().replace(/^v/, "");
  const mode = PACK_MODES.find((candidate) => candidate.name === normalized);
  if (!mode) {
    throw new Error(`Unknown pack mode: ${value}\nSupported modes: ${PACK_MODES.map((item) => item.name).join(", ")}`);
  }
  return mode;
}

async function findGameExecutable(source) {
  const details = await stat(source).catch(() => undefined);
  if (!details) throw new Error(`Input was not found: ${source}`);
  if (details.isFile() && /Game(?:Pro)?\.exe$/i.test(basename(source))) return source;
  if (!details.isDirectory()) throw new Error("Pack input must be Game.exe, GamePro.exe, or its project folder.");
  for (const name of ["Game.exe", "GamePro.exe"]) {
    const candidate = join(source, name);
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Game.exe or GamePro.exe was not found in ${source}`);
}

async function findOptionalGameExecutable(source) {
  const details = await stat(source).catch(() => undefined);
  if (!details) throw new Error(`Input was not found: ${source}`);
  if (details.isFile()) return findGameExecutable(source);
  if (!details.isDirectory()) throw new Error("Pack input must be a folder or game executable.");
  for (const name of ["Game.exe", "GamePro.exe"]) {
    const candidate = join(source, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function copyReleaseFiles(stagedGame, destination) {
  await mkdir(join(destination, "Data"), { recursive: true });
  for (const entry of await readdir(stagedGame, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await cp(join(stagedGame, entry.name), join(destination, entry.name));
  }
  for (const entry of await readdir(join(stagedGame, "Data"), { withFileTypes: true })) {
    if (!entry.isFile() || isArchivePath(entry.name)) continue;
    await cp(join(stagedGame, "Data", entry.name), join(destination, "Data", entry.name));
  }
}

export async function packWolf({ sourcePath, outputDir, modeName }) {
  const input = resolve(sourcePath);
  const mode = resolveMode(modeName);
  const executable = await findOptionalGameExecutable(input);
  if (!executable) {
    const destination = await ensureNewDestination(
      outputDir || join(dirname(input), `${basename(input)}.wolf`),
    );
    try {
      await packDx6Archive(input, destination, mode);
      return { outputDir: destination, archives: 1, mode };
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
  }
  const gameFolder = dirname(executable);
  const dataFolder = await requireDirectory(join(gameFolder, "Data"), "Data folder");
  const dataFolders = (await readdir(dataFolder, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  if (dataFolders.length === 0) {
    throw new Error("The Data folder needs at least one subfolder to pack.");
  }
  const destination = await ensureNewDestination(
    outputDir || join(dirname(gameFolder), `${basename(gameFolder)} packed`),
  );
  const stagingRoot = await mkdtemp(join(dirname(destination), `.${basename(destination)} staging `));
  const stagedGame = join(stagingRoot, basename(destination));

  try {
    await mkdir(stagedGame, { recursive: true });
    await mkdir(join(stagedGame, "Data"), { recursive: true });
    for (const name of [basename(executable), "Game.ini", "Game.dat", "Config.exe"]) {
      const sourceFile = join(gameFolder, name);
      if (await exists(sourceFile)) await cp(sourceFile, join(stagedGame, name));
    }
    await copyReleaseFiles(gameFolder, stagedGame);

    for (const folder of dataFolders) {
      await packDx6Archive(
        join(dataFolder, folder.name),
        join(stagedGame, "Data", `${folder.name}.wolf`),
        mode,
      );
    }

    await rename(stagedGame, destination);
    return { outputDir: destination, archives: dataFolders.length, mode };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
