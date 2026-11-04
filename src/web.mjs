import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import JSZip from "jszip";

import { packDx8NoKeyArchive } from "./archive/dx8.mjs";
import { unpackWolf } from "./unpack.mjs";
import { isArchivePath } from "./files.mjs";
import { inspectFile } from "./inspect.mjs";
import { browserAudioMetadata } from "./audio.mjs";
import { createDeferredAudioLoader } from "./browser/deferred-audio.mjs";
import { installLazyAssets } from "./browser/lazy-assets.mjs";

export const BROWSER_WODITOR_VERSION = "0.6.2.0";
export const WEB_EXPORT_VERSION = "2026.11.04";
export const BROWSER_WODITOR_URL =
  "https://frostyhowl.com/files/BrowserWoditor_0_6_2_0.zip";
export const BROWSER_WODITOR_SHA256 =
  "50d525af26cfa597c402bfb527d1af66ca6b8db993e019079489e5e50cf91f20";

const RUNTIME_PREFIX = "public/";
const SOURCE_FILES = [
  "Data.wolf",
  "Game.ini",
  "DefaultFont.ttf",
  "DefaultSubFont.ttf",
  "DefaultSoundFont.sf2",
  "FontList.ini",
  "readme.html",
];
const DEFAULT_GAME_INI = [
  "Start=0",
  "SoftModeFlag=0",
  "WindowModeFlag=1",
  "SEandBGM=3",
  "FrameSkip=0",
  "Proxy=",
  "ProxyPort=",
  "ScreenShotFlag=1",
  "F12_Reset=1",
  "Display_Number=0",
  "Old_DirectX_Use=0",
  "",
].join("\r\n");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function requireFile(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch {
    throw new Error(`${label} was not found: ${path}`);
  }
  if (!details.isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

async function requireDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch {
    throw new Error(`${label} was not found: ${path}`);
  }
  if (!details.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

function webPath(path) {
  return path.split(sep).join("/");
}

async function listFiles(root, current = root, { rejectLinks = false } = {}) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(current, entry.name);
    if (rejectLinks && entry.isSymbolicLink()) {
      throw new Error(`Shared game assets cannot be symbolic links: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path, { rejectLinks })));
    } else if (entry.isFile()) {
      files.push(webPath(relative(root, path)));
    }
  }
  return files;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadRuntimeZip({ runtimeZipPath, runtimeUrl, runtimeSha256 }) {
  let bytes;
  if (runtimeZipPath) {
    bytes = await readFile(resolve(runtimeZipPath));
  } else {
    process.stdout.write(
      `Downloading Browser Woditor ${BROWSER_WODITOR_VERSION}...\n`,
    );
    const response = await fetch(runtimeUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `Browser Woditor download failed (${response.status} ${response.statusText}).`,
      );
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }

  if (runtimeSha256) {
    const actualHash = sha256(bytes);
    if (actualHash.toLowerCase() !== runtimeSha256.toLowerCase()) {
      throw new Error(
        `Browser Woditor ZIP checksum mismatch. Expected ${runtimeSha256}, received ${actualHash}.`,
      );
    }
  }

  return JSZip.loadAsync(bytes);
}

async function extractRuntime(zip, outputDir) {
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.startsWith(RUNTIME_PREFIX),
  );
  if (!entries.some((entry) => entry.name === `${RUNTIME_PREFIX}index.html`)) {
    throw new Error("The runtime ZIP does not contain public/index.html.");
  }
  if (
    !entries.some((entry) => entry.name === `${RUNTIME_PREFIX}woditor.wasm`)
  ) {
    throw new Error("The runtime ZIP does not contain public/woditor.wasm.");
  }

  for (const entry of entries) {
    const outputPath = join(outputDir, entry.name.slice(RUNTIME_PREFIX.length));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await entry.async("nodebuffer"));
  }
}

async function browserWoditorMarker(zip) {
  const marker = Object.values(zip.files).find(
    (entry) =>
      !entry.dir &&
      entry.name.replaceAll("\\", "/").endsWith("/BrowserWoditor.dat"),
  );
  if (!marker) {
    throw new Error("The runtime ZIP does not contain BrowserWoditor.dat.");
  }
  return marker.async("nodebuffer");
}

export function lazyAssetLoaderSource({ sharedAssets = false } = {}) {
  return `(${installLazyAssets.toString()})(${JSON.stringify(sharedAssets)}, ${createDeferredAudioLoader.toString()}, ${JSON.stringify(WEB_EXPORT_VERSION)});\n`;
}

export function indexWithLazyAssetLoader(index) {
  const woditorScript =
    /<script\b[^>]*\bsrc=["'](?:\.\/)?woditor\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/i;
  if (!woditorScript.test(index)) {
    throw new Error("The runtime index does not load woditor.js.");
  }
  const loaderTag =
    `<script type="text/javascript" src="lib/lazy_assets.js?wolftools-export=${WEB_EXPORT_VERSION}"></script>`;
  const previousLoader = /<script\b[^>]*\bsrc=["'](?:\.\/)?lib\/lazy_assets\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi;
  return index.replace(previousLoader, "").replace(woditorScript, `${loaderTag}\n  $&`);
}

async function addLazyAssetLoader(outputDir, options) {
  const indexPath = join(outputDir, "index.html");
  const index = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    indexWithLazyAssetLoader(index),
  );
  await mkdir(join(outputDir, "lib"), { recursive: true });
  await writeFile(
    join(outputDir, "lib", "lazy_assets.js"),
    lazyAssetLoaderSource(options),
  );
}

export function safeProjectId(input) {
  const stem = input
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
  const digest = sha256(Buffer.from(input, "utf8")).slice(0, 16);
  return `${stem || "wolf"}-${digest}`;
}

function settingsSource(projectId, title) {
  return `const WoditorGameSettings = {
    projectId: ${JSON.stringify(projectId)},
    projectName: ${JSON.stringify(title)},
    noSystemTouch: false,
    requestFullScreen: false,
    lockOrientation: "landscape-primary",
    hideHeaderFooter: true,
    hideSideButtons: true,
    switchUILeftRight: false,
    limitFPS: 60,
};
`;
}

async function normalizeSourceDir(sourcePath) {
  const input = resolve(sourcePath);
  const details = await stat(input).catch(() => undefined);
  if (!details)
    throw new Error(`Game or prepared release was not found: ${input}`);
  if (details.isDirectory()) return input;
  if (details.isFile() && /Game(?:Pro)?\.exe$/i.test(basename(input)))
    return dirname(input);
  throw new Error(
    "Web input must be a game folder, Game.exe, GamePro.exe, or prepared release.",
  );
}

async function sourceKind(sourceDir) {
  await requireDirectory(sourceDir, "Game or prepared release folder");
  for (const name of ["Game.exe", "GamePro.exe"]) {
    if (await exists(join(sourceDir, name))) {
      const hasData = await exists(join(sourceDir, "Data"));
      const hasDataArchive = await exists(join(sourceDir, "Data.wolf"));
      const hasOtherArchive =
        !hasData &&
        !hasDataArchive &&
        (await containsArchives(sourceDir, await listFiles(sourceDir)));
      if (!hasData && !hasDataArchive && !hasOtherArchive) {
        throw new Error("The game has neither a Data folder nor Data.wolf.");
      }
      return "native";
    }
  }

  await requireFile(
    join(sourceDir, "Data.wolf"),
    "Browser Woditor ready Data.wolf",
  );
  await requireFile(join(sourceDir, "Game.ini"), "Game.ini");
  return "prepared";
}

async function copyPreparedRelease(sourceDir, outputDir) {
  for (const filename of SOURCE_FILES) {
    const sourcePath = join(sourceDir, filename);
    if (await exists(sourcePath)) {
      await cp(sourcePath, join(outputDir, filename), { dereference: true });
    }
  }

  const saveDir = join(sourceDir, "Save");
  if (await exists(saveDir)) {
    await cp(saveDir, join(outputDir, "Save"), {
      recursive: true,
      dereference: true,
    });
  }
}

async function copyGameSupportFiles(sourceDir, outputDir) {
  for (const filename of SOURCE_FILES.filter((name) => name !== "Data.wolf")) {
    const sourcePath = join(sourceDir, filename);
    if (await exists(sourcePath)) {
      await cp(sourcePath, join(outputDir, filename), { dereference: true });
    }
  }

  const saveDir = join(sourceDir, "Save");
  if (await exists(saveDir)) {
    await cp(saveDir, join(outputDir, "Save"), {
      recursive: true,
      dereference: true,
    });
  }
}

async function createAssetManifest(dataDir) {
  const paths = await listFiles(dataDir);
  const files = [];
  let bytes = 0;
  for (const path of paths) {
    const size = (await stat(join(dataDir, path))).size;
    let audio;
    try {
      audio = await browserAudioMetadata(join(dataDir, path));
    } catch (error) {
      console.warn(`${error.message} This file will use the existing asset loader if requested.`);
    }
    files.push({ path: `Data/${path}`, bytes: size, ...(audio ? { audio } : {}) });
    bytes += size;
  }
  return { version: 1, files, bytes };
}

async function findArchives(root, files) {
  const candidates = files.filter(isArchivePath);
  const matches = await Promise.all(
    candidates.map(async (path) =>
      /\.wolfx?$/iu.test(path) || (await inspectFile(join(root, path))).native,
    ),
  );
  // .bin and .data can also be ordinary assets. Only detected archive
  // headers count for those extensions.
  return candidates.filter((_path, index) => matches[index]);
}

async function containsArchives(root, files) {
  return (await findArchives(root, files)).length > 0;
}

async function createLooseBrowserData(sourceDir, outputDir, runtimeZip) {
  const workRoot = await mkdtemp(join(tmpdir(), "wolftools web "));
  const unpackedGame = join(workRoot, "game");
  const bootData = join(workRoot, "boot");
  try {
    const sourceFiles = await listFiles(sourceDir);
    const hasArchives = await containsArchives(sourceDir, sourceFiles);
    if (hasArchives) {
      process.stdout.write("Unpacking source archives...\n");
      await unpackWolf({ sourcePath: sourceDir, outputDir: unpackedGame });
    }
    const dataDir = join(hasArchives ? unpackedGame : sourceDir, "Data");
    await requireDirectory(dataDir, "Unpacked Data folder");

    process.stdout.write("Copying browser assets...\n");
    await cp(dataDir, join(outputDir, "Data"), {
      recursive: true,
      dereference: true,
    });
    const manifest = await createAssetManifest(join(outputDir, "Data"));
    await writeFile(
      join(outputDir, "asset_manifest.json"),
      `${JSON.stringify(manifest)}\n`,
    );

    const markerDir = join(bootData, "BasicData");
    await mkdir(markerDir, { recursive: true });
    await writeFile(
      join(markerDir, "BrowserWoditor.dat"),
      await browserWoditorMarker(runtimeZip),
    );

    process.stdout.write("Creating the small browser startup archive...\n");
    await rm(join(outputDir, "Data.wolf"), { force: true });
    await packDx8NoKeyArchive(bootData, join(outputDir, "Data.wolf"));
    await copyGameSupportFiles(sourceDir, outputDir);
    await addLazyAssetLoader(outputDir);
    return manifest;
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

async function validateSharedGame(sourceDir, kind) {
  if (kind !== "native") {
    throw new Error(
      "Combined mode requires a game folder with Game.exe or GamePro.exe and unpacked Data assets.",
    );
  }
  const dataDir = join(sourceDir, "Data");
  await requireDirectory(
    dataDir,
    "Unpacked Data folder (unpack the game first)",
  );
  if ((await lstat(dataDir)).isSymbolicLink()) {
    throw new Error("Shared Data folder cannot be a symbolic link.");
  }
  const dataFiles = await listFiles(dataDir, dataDir, { rejectLinks: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = [
    ...entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    ...dataFiles.map((path) => `Data/${path}`),
  ];
  if (await containsArchives(sourceDir, files)) {
    throw new Error(
      "Combined mode requires unpacked assets without packed archives. Run wolftools web in an interactive terminal and confirm extraction first.",
    );
  }
  if (dataFiles.length === 0) throw new Error("Shared Data folder is empty.");
}

export async function inspectCombinedGame(sourcePath) {
  const sourceDir = await normalizeSourceDir(sourcePath);
  if ((await readdir(sourceDir)).some((name) => name.toLowerCase() === "web")) {
    throw new Error(
      `Game folder already contains web/: ${join(sourceDir, "web")}`,
    );
  }
  const kind = await sourceKind(sourceDir);
  if (kind !== "native") {
    throw new Error(
      "Combined mode requires a game folder with Game.exe or GamePro.exe and unpacked Data assets.",
    );
  }
  const files = await listFiles(sourceDir);
  const archives = await findArchives(sourceDir, files);
  return {
    sourceDir,
    needsExtraction: archives.length > 0,
    archives,
  };
}

async function createSharedBrowserData(sourceDir, outputDir, runtimeZip) {
  const manifest = await createAssetManifest(join(sourceDir, "Data"));
  manifest.preload = [];
  // Keep tiny browser configuration separate. Fonts and other support assets
  // share the originals, just like Data/, and are materialized in the VFS only.
  const supportFiles = new Set([
    ...SOURCE_FILES.filter(
      (name) => !["Data.wolf", "Game.ini", "readme.html"].includes(name),
    ),
    ...(await readdir(sourceDir)).filter((name) =>
      /\.(?:ttf|ttc|otf|sf2)$/iu.test(name),
    ),
  ]);
  for (const filename of supportFiles) {
    const path = join(sourceDir, filename);
    const details = await lstat(path).catch(() => undefined);
    if (!details) continue;
    if (!details.isFile())
      throw new Error(`Shared support asset must be a regular file: ${path}`);
    manifest.files.push({ path: filename, bytes: details.size });
    manifest.bytes += details.size;
    manifest.preload.push(filename);
    // Drop a bundled fallback when the shared game supplies this asset.
    await rm(join(outputDir, filename), { force: true });
  }
  const sourceIni = join(sourceDir, "Game.ini");
  const iniDetails = await lstat(sourceIni).catch(() => undefined);
  if (iniDetails) {
    if (!iniDetails.isFile())
      throw new Error(`Game.ini must be a regular file: ${sourceIni}`);
    await cp(sourceIni, join(outputDir, "Game.ini"));
  }
  await writeFile(
    join(outputDir, "asset_manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  const bootRoot = await mkdtemp(join(tmpdir(), "wolftools web boot "));
  try {
    await mkdir(join(bootRoot, "BasicData"));
    await writeFile(
      join(bootRoot, "BasicData", "BrowserWoditor.dat"),
      await browserWoditorMarker(runtimeZip),
    );
    await rm(join(outputDir, "Data.wolf"), { force: true });
    await packDx8NoKeyArchive(bootRoot, join(outputDir, "Data.wolf"));
  } finally {
    await rm(bootRoot, { recursive: true, force: true });
  }
  await addLazyAssetLoader(outputDir, { sharedAssets: true });
  return manifest;
}

export async function packageWolfGame({
  sourceDir,
  outputDir,
  runtimeZipPath,
  runtimeUrl = BROWSER_WODITOR_URL,
  runtimeSha256 = BROWSER_WODITOR_SHA256,
  separate = true,
}) {
  if (typeof separate !== "boolean")
    throw new Error("separate must be true or false.");
  const source = await normalizeSourceDir(sourceDir);
  // Check before reading/downloading a runtime or starting any extraction.
  if ((await readdir(source)).some((name) => name.toLowerCase() === "web")) {
    throw new Error(
      `Game folder already contains web/: ${join(source, "web")}`,
    );
  }
  const destination = separate
    ? resolve(outputDir || `${source} web`)
    : join(source, "web");
  if (!separate && outputDir && resolve(outputDir) !== destination) {
    throw new Error(
      `Combined mode output must be ${destination}. Omit the output folder or use that path.`,
    );
  }
  if (
    separate &&
    (source === destination || destination.startsWith(`${source}${sep}`))
  ) {
    throw new Error(
      "The output folder must be outside the prepared release folder.",
    );
  }
  if (await exists(destination)) {
    throw new Error(`Output folder already exists: ${destination}`);
  }

  const kind = await sourceKind(source);
  if (!separate) await validateSharedGame(source, kind);
  const gameTitle = basename(source).trim();
  const saveProjectId = safeProjectId(gameTitle);
  const staging = join(
    dirname(destination),
    `.${basename(destination)}.tmp-${randomUUID()}`,
  );
  const runtimeZip = await loadRuntimeZip({
    runtimeZipPath,
    runtimeUrl,
    runtimeSha256,
  });
  let reserved = false;

  try {
    if (!separate) {
      // Exclusive reservation closes the check/create race. Only this empty
      // reservation is removed on failure; never recursively delete web/.
      await mkdir(destination);
      reserved = true;
    }
    await mkdir(staging, { recursive: true });
    process.stdout.write("Preparing Browser Woditor runtime...\n");
    await extractRuntime(runtimeZip, staging);
    let data;
    if (kind === "native") {
      const manifest = separate
        ? await createLooseBrowserData(source, staging, runtimeZip)
        : await createSharedBrowserData(source, staging, runtimeZip);
      data = {
        delivery: "files",
        manifest: "asset_manifest.json",
        root: "Data",
        bootArchive: "Data.wolf",
        files: manifest.files.length,
        bytes: manifest.bytes,
        ...(!separate ? { assetBase: "../", shared: true } : {}),
      };
    } else {
      process.stdout.write("Copying creator export...\n");
      await copyPreparedRelease(source, staging);
      data = { delivery: "archive", file: "Data.wolf" };
    }

    if (!(await exists(join(staging, "Game.ini")))) {
      await writeFile(join(staging, "Game.ini"), DEFAULT_GAME_INI);
    }

    await writeFile(
      join(staging, "settings.js"),
      settingsSource(saveProjectId, gameTitle),
    );
    await writeFile(
      join(staging, "browser-game.json"),
      `${JSON.stringify(
        {
          exportVersion: WEB_EXPORT_VERSION,
          title: gameTitle,
          engine: "wolf-rpg",
          runtime: `Browser Woditor ${BROWSER_WODITOR_VERSION}`,
          layout: separate ? "separate" : "combined",
          data,
        },
        null,
        2,
      )}\n`,
    );

    const sharedSoundFont =
      !separate && (await exists(join(source, "DefaultSoundFont.sf2")));
    const downloadableFiles = [
      "Data.wolf",
      ...(!sharedSoundFont ? ["DefaultSoundFont.sf2"] : []),
      "Game.ini",
    ];
    const saveFiles = (await exists(join(staging, "Save")))
      ? (await listFiles(join(staging, "Save"))).map((path) => `Save/${path}`)
      : [];
    await writeFile(
      join(staging, "InitialDownloadList.ini"),
      `${[...downloadableFiles, ...saveFiles].join("\r\n")}\r\n`,
    );

    if (separate) {
      await rename(staging, destination);
    } else {
      // Windows cannot rename over an existing directory, even our empty
      // reservation. Publish into that exclusively-created folder without
      // replacing any file another process might have placed there.
      await cp(staging, destination, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      await rm(staging, { recursive: true, force: true });
    }
    reserved = false;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (reserved) await rmdir(destination).catch(() => {});
    throw error;
  }

  return {
    outputDir: destination,
    title: gameTitle,
    projectId: saveProjectId,
    sourceKind: kind,
    separate,
    serveRoot: separate ? destination : source,
  };
}
