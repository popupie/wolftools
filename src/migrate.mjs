import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { BROWSER_AUDIO_EXTENSIONS, browserAudioMetadata } from "./audio.mjs";
import { requireDirectory, requireFile } from "./files.mjs";
import {
  BROWSER_WODITOR_VERSION,
  WEB_EXPORT_VERSION,
  indexWithLazyAssetLoader,
  lazyAssetLoaderSource,
} from "./web.mjs";

async function details(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJson(path) {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${path}`);
  }
}

function versionParts(version) {
  if (version === 0) return [0, 0];
  const match =
    typeof version === "string" &&
    /^([1-9]\d{3})\.(\d{2})\.(\d{2})(?:\.([1-9]\d*))?$/u.exec(version);
  if (match) {
    const [, year, month, day, suffix] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    const revision = suffix === undefined ? 0 : Number(suffix);
    if (
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() + 1 === Number(month) &&
      date.getUTCDate() === Number(day) &&
      Number.isSafeInteger(revision)
    ) {
      return [Number(`${year}${month}${day}`), revision];
    }
  }
  throw new Error(`Invalid web export version: ${JSON.stringify(version)}`);
}

export function compareExportVersions(left, right) {
  const [leftDate, leftRevision] = versionParts(left);
  const [rightDate, rightRevision] = versionParts(right);
  return (
    Math.sign(leftDate - rightDate) || Math.sign(leftRevision - rightRevision)
  );
}

function assetPath(root, path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new Error(`Invalid asset manifest path: ${JSON.stringify(path)}`);
  }
  return join(root, path);
}

async function deferredAudioUpdates(outputDir, metadata) {
  await requireFile(join(outputDir, "settings.js"));
  await requireFile(join(outputDir, "index.html"));
  await requireFile(join(outputDir, "woditor.js"));
  await requireFile(join(outputDir, "woditor.wasm"));
  await requireFile(join(outputDir, "Data.wolf"));
  const updates = new Map();
  if (metadata.data?.delivery === "archive") return updates;
  if (metadata.data?.delivery !== "files")
    throw new Error("Unsupported web export asset layout.");
  if (metadata.runtime !== `Browser Woditor ${BROWSER_WODITOR_VERSION}`) {
    throw new Error(
      `This migration requires Browser Woditor ${BROWSER_WODITOR_VERSION}.`,
    );
  }
  if (
    metadata.data.manifest !== "asset_manifest.json" ||
    metadata.data.root !== "Data"
  ) {
    throw new Error("Unsupported web export manifest or Data folder location.");
  }
  const shared =
    metadata.layout === "combined" ||
    metadata.data.shared === true ||
    metadata.data.assetBase === "../";
  if (
    metadata.data.assetBase !== undefined &&
    metadata.data.assetBase !== "../"
  ) {
    throw new Error("Unsupported web export asset base.");
  }
  const gameRoot = shared ? dirname(outputDir) : outputDir;
  await requireDirectory(join(gameRoot, "Data"));
  const manifest = await readJson(join(outputDir, "asset_manifest.json"));
  if (!Array.isArray(manifest?.files))
    throw new Error("The asset manifest has no files array.");
  const files = [];
  for (const file of manifest.files) {
    const path = assetPath(gameRoot, file?.path);
    if (!BROWSER_AUDIO_EXTENSIONS.test(file.path)) {
      files.push(file);
      continue;
    }
    const entry = { ...file };
    delete entry.audio;
    let audio;
    try {
      audio = await browserAudioMetadata(path);
    } catch (error) {
      console.warn(
        `${error.message} This file will use the existing asset loader if requested.`,
      );
    }
    files.push({ ...entry, ...(audio ? { audio } : {}) });
  }
  updates.set(
    "asset_manifest.json",
    `${JSON.stringify({ ...manifest, files })}\n`,
  );
  updates.set(
    "lib/lazy_assets.js",
    lazyAssetLoaderSource({ sharedAssets: shared }),
  );
  const index = await readFile(join(outputDir, "index.html"), "utf8");
  updates.set("index.html", indexWithLazyAssetLoader(index));
  return updates;
}

// Release versions stay fixed until a new migration is introduced. Additional
// releases on the same date use .1, .2, etc..
const migrations = [{ version: "2026.11.04", prepare: deferredAudioUpdates }];

async function applyUpdates(outputDir, updates) {
  const originals = new Map();
  for (const path of updates.keys()) {
    const parent = dirname(path);
    if (parent !== ".") {
      const info = await details(join(outputDir, parent));
      if (info && (!info.isDirectory() || info.isSymbolicLink())) {
        throw new Error(
          `Migration target parent must be a regular directory: ${parent}`,
        );
      }
    }
    const target = join(outputDir, path);
    const info = await details(target);
    if (info && (!info.isFile() || info.isSymbolicLink())) {
      throw new Error(`Migration target must be a regular file: ${target}`);
    }
    originals.set(
      path,
      info ? { bytes: await readFile(target), mode: info.mode } : undefined,
    );
  }
  const staging = await mkdtemp(
    join(dirname(outputDir), ".wolftools-migration-"),
  );
  const written = [];
  let keepBackup = false;
  try {
    for (const [path, content] of updates) {
      const next = join(staging, "next", path);
      await mkdir(dirname(next), { recursive: true });
      await writeFile(next, content, { mode: originals.get(path)?.mode });
      const original = originals.get(path);
      if (original) {
        const backup = join(staging, "before", path);
        await mkdir(dirname(backup), { recursive: true });
        await writeFile(backup, original.bytes, { mode: original.mode });
      }
    }
    for (const path of updates.keys()) {
      await mkdir(dirname(join(outputDir, path)), { recursive: true });
      await rename(join(staging, "next", path), join(outputDir, path));
      written.push(path);
    }
  } catch (error) {
    const failures = [];
    for (const path of written.reverse()) {
      try {
        if (originals.get(path))
          await rename(join(staging, "before", path), join(outputDir, path));
        else await rm(join(outputDir, path));
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      keepBackup = true;
      throw new AggregateError(
        [error, ...failures],
        `Migration failed; recovery files are in ${staging}`,
      );
    }
    throw error;
  } finally {
    if (!keepBackup) await rm(staging, { recursive: true, force: true });
  }
}

export async function migrateWebExport({ exportDir }) {
  const root = await requireDirectory(
    exportDir,
    "Existing web export or combined game folder",
  );
  const outputDir = (await details(join(root, "browser-game.json")))
    ? root
    : join(root, "web");
  await requireFile(
    join(outputDir, "browser-game.json"),
    "Web export browser-game.json",
  );
  const metadata = await readJson(join(outputDir, "browser-game.json"));
  if (metadata?.engine !== "wolf-rpg")
    throw new Error("This is not a wolftools WOLF web export.");
  const previousVersion = Object.hasOwn(metadata, "exportVersion")
    ? metadata.exportVersion
    : 0;
  const comparison = compareExportVersions(previousVersion, WEB_EXPORT_VERSION);
  if (comparison > 0) {
    throw new Error(
      `Export version ${previousVersion} is newer than this tool supports (${WEB_EXPORT_VERSION}).`,
    );
  }
  const updates = new Map();
  for (const { version, prepare } of migrations) {
    if (
      compareExportVersions(version, previousVersion) <= 0 ||
      compareExportVersions(version, WEB_EXPORT_VERSION) > 0
    )
      continue;
    for (const [path, content] of await prepare(outputDir, metadata))
      updates.set(path, content);
    metadata.exportVersion = version;
  }
  if (comparison < 0) {
    if (metadata.exportVersion !== WEB_EXPORT_VERSION)
      throw new Error(
        "No migration is available to the current export version.",
      );
    // Publish the version last, after its corresponding files are in place.
    updates.set("browser-game.json", `${JSON.stringify(metadata, null, 2)}\n`);
    await applyUpdates(outputDir, updates);
  }
  return {
    outputDir: resolve(outputDir),
    previousVersion,
    version: WEB_EXPORT_VERSION,
    migrated: comparison < 0,
    files: [...updates.keys()],
  };
}
