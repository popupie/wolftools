import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { BROWSER_AUDIO_EXTENSIONS, browserAudioMetadata } from "./audio.mjs";
import {
  findCheckedAssets,
  writeBrowserBootArchive,
} from "./browser/file-checks.mjs";
import { requireDirectory, requireFile } from "./files.mjs";
import {
  LEGACY_BROWSER_WODITOR_VERSION,
  WEB_EXPORT_VERSION,
  assetHasUnicodeBom,
  indexWithCanvasFit,
  indexWithLazyAssetLoader,
  lazyAssetLoaderSource,
  loadRuntimeZip,
  resolveRuntimeVersion,
  runtimeFile,
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

function usesSharedAssets(metadata) {
  return (
    metadata.layout === "combined" ||
    metadata.data.shared === true ||
    metadata.data.assetBase === "../"
  );
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
  if (
    metadata.data.manifest !== "asset_manifest.json" ||
    metadata.data.root !== "Data"
  ) {
    throw new Error("Unsupported web export manifest or Data folder location.");
  }
  const shared = usesSharedAssets(metadata);
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

async function canvasFitUpdates(outputDir, _metadata, pending) {
  const index =
    pending.get("index.html") ??
    (await readFile(join(outputDir, "index.html"), "utf8"));
  const fittedIndex = indexWithCanvasFit(index);
  return fittedIndex === index
    ? new Map()
    : new Map([["index.html", fittedIndex]]);
}

async function bootArchiveUpdates(outputDir, metadata, _pending, { workDir }) {
  const updates = new Map();
  if (metadata.data?.delivery !== "files") return updates;

  const root = usesSharedAssets(metadata) ? dirname(outputDir) : outputDir;
  const manifest = await readJson(join(outputDir, "asset_manifest.json"));
  if (!Array.isArray(manifest?.files))
    throw new Error("The asset manifest has no files array.");
  const assets = await findCheckedAssets(join(root, "Data"), manifest.files);
  if (!assets.length) return updates;

  const previousArchive = join(outputDir, "Data.wolf");
  const existing = await details(previousArchive);
  if (!existing?.isFile())
    throw new Error("The browser startup archive must be a regular file.");
  const archivePath = join(workDir, "Data.wolf");
  if (await writeBrowserBootArchive(archivePath, { assets, previousArchive })) {
    updates.set("Data.wolf", { sourcePath: archivePath });
  }
  return updates;
}

async function binaryAssetUpdates(
  outputDir,
  metadata,
  pending,
  { runtimeVersion },
) {
  const updates = new Map();
  if (metadata.data?.delivery !== "files") return updates;

  const manifestPath = "asset_manifest.json";
  const manifest = pending.has(manifestPath)
    ? JSON.parse(pending.get(manifestPath))
    : await readJson(join(outputDir, manifestPath));
  if (!Array.isArray(manifest?.files))
    throw new Error("The asset manifest has no files array.");
  const gameRoot = usesSharedAssets(metadata) ? dirname(outputDir) : outputDir;
  for (const entry of manifest.files) {
    const path = assetPath(gameRoot, entry?.path);
    const hasBom = await assetHasUnicodeBom(path).catch((error) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return false;
    });
    if (hasBom) entry.hasUnicodeBom = true;
  }
  updates.set(manifestPath, `${JSON.stringify(manifest)}\n`);
  const index =
    pending.get("index.html") ??
    (await readFile(join(outputDir, "index.html"), "utf8"));
  updateAssetLoader(updates, index, metadata, runtimeVersion);
  return updates;
}

function updateAssetLoader(updates, index, metadata, runtimeVersion) {
  updates.set("index.html", indexWithLazyAssetLoader(index));
  updates.set(
    "lib/lazy_assets.js",
    lazyAssetLoaderSource({
      sharedAssets: usesSharedAssets(metadata),
      runtimeVersion,
    }),
  );
}

async function updateRuntime(updates, zip, metadata, runtimeVersion) {
  const legacy = runtimeVersion === LEGACY_BROWSER_WODITOR_VERSION;
  const wasLegacy =
    metadata.runtime === `Browser Woditor ${LEGACY_BROWSER_WODITOR_VERSION}`;
  const paths = ["lib/system.js", "woditor.js", "woditor.wasm"];
  if (legacy || wasLegacy) {
    paths.push("lib/keydispatch.js");
    if (!legacy) paths.push("img/bwoditor.svg", "lib/jszip.min.js");

    const template = await runtimeFile(zip, "index.html", runtimeVersion);
    const index = indexWithCanvasFit(template.toString("utf8"));
    if (metadata.data?.delivery === "files") {
      updateAssetLoader(updates, index, metadata, runtimeVersion);
    } else {
      updates.set("index.html", index);
    }
  }
  for (const path of paths) {
    updates.set(path, await runtimeFile(zip, path, runtimeVersion));
  }
}

// Release versions stay fixed until a new migration is introduced. Additional
// releases on the same date use .1, .2, etc..
const migrations = [
  { version: "2026.11.04", prepare: deferredAudioUpdates },
  { version: "2026.11.17", prepare: canvasFitUpdates },
  { version: "2026.11.17.4", prepare: bootArchiveUpdates },
  { version: "2026.11.18", prepare: binaryAssetUpdates },
];

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
    originals.set(path, info);
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
      const original = originals.get(path);
      if (content.sourcePath) {
        await copyFile(content.sourcePath, next);
        if (original) await chmod(next, original.mode);
      } else {
        await writeFile(next, content, { mode: original?.mode });
      }
      if (original) {
        const backup = join(staging, "before", path);
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(join(outputDir, path), backup);
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

export async function migrateWebExport({
  exportDir,
  runtimeVersion,
  runtimeZipPath,
}) {
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
  const lock = join(outputDir, ".wolftools-migration-lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `A migration is already running or left a lock at ${lock}.`,
      );
    throw error;
  }
  try {
    return await migrateExportFiles(
      outputDir,
      runtimeVersion,
      runtimeZipPath,
      lock,
    );
  } finally {
    await rm(join(lock, "Data.wolf"), { force: true });
    await rmdir(lock);
  }
}

async function migrateExportFiles(
  outputDir,
  requestedVersion,
  runtimeZipPath,
  workDir,
) {
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
  const runtimePin =
    requestedVersion === "default"
      ? undefined
      : (requestedVersion ?? metadata.runtimePin);
  const runtimeVersion = resolveRuntimeVersion(runtimePin);
  const runtime = `Browser Woditor ${runtimeVersion}`;
  const legacy = runtimeVersion === LEGACY_BROWSER_WODITOR_VERSION;
  const runtimeChanged =
    metadata.runtime !== runtime ||
    (legacy && compareExportVersions(previousVersion, "2026.11.17.2") < 0);

  const updates = new Map();
  for (const { version, prepare } of migrations) {
    if (
      compareExportVersions(version, previousVersion) <= 0 ||
      compareExportVersions(version, WEB_EXPORT_VERSION) > 0
    )
      continue;
    for (const [path, content] of await prepare(outputDir, metadata, updates, {
      workDir,
      runtimeVersion,
    }))
      updates.set(path, content);
  }

  if (runtimeChanged || runtimeZipPath) {
    const zip = await loadRuntimeZip({ runtimeVersion, runtimeZipPath });
    if (runtimeChanged)
      await updateRuntime(updates, zip, metadata, runtimeVersion);
  }
  const migrated =
    comparison < 0 || runtimeChanged || runtimePin !== metadata.runtimePin;
  if (migrated) {
    metadata.exportVersion = WEB_EXPORT_VERSION;
    metadata.runtime = runtime;
    if (runtimePin === undefined) delete metadata.runtimePin;
    else metadata.runtimePin = runtimePin;
    // Publish the version last, after its corresponding files are in place.
    updates.set("browser-game.json", `${JSON.stringify(metadata, null, 2)}\n`);
    await applyUpdates(outputDir, updates);
  }
  return {
    outputDir: resolve(outputDir),
    previousVersion,
    version: WEB_EXPORT_VERSION,
    runtimeVersion,
    migrated,
    files: [...updates.keys()],
  };
}
