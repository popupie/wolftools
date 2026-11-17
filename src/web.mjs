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
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import JSZip from "jszip";

import { unpackWolf } from "./unpack.mjs";
import { isArchivePath } from "./files.mjs";
import { inspectFile } from "./inspect.mjs";
import { browserAudioMetadata } from "./audio.mjs";
import { createDeferredAudioLoader } from "./browser/deferred-audio.mjs";
import {
  findCheckedAssets,
  writeBrowserBootArchive,
} from "./browser/file-checks.mjs";
import { installLazyAssets } from "./browser/lazy-assets.mjs";

export const BROWSER_WODITOR_VERSION = "0.6.3.0";
export const LEGACY_BROWSER_WODITOR_VERSION = "0.4.1.0";
export const WEB_EXPORT_VERSION = "2026.11.17.4";

const RUNTIME_CHECKSUMS = new Map([
  [
    "0.6.3.0",
    "32b8b899a0e1e003b24b613ab86effe45a66f2ef1173aa4824a12380e55930fa",
  ],
  [
    "0.6.2.0",
    "50d525af26cfa597c402bfb527d1af66ca6b8db993e019079489e5e50cf91f20",
  ],
  [
    LEGACY_BROWSER_WODITOR_VERSION,
    "4bce38b4cb2fa395f9470cf73f39ef6f23be7384ecfced7761637498b01a3507",
  ],
]);

export function resolveRuntimeVersion(requestedVersion) {
  const version =
    requestedVersion === undefined || requestedVersion === "default"
      ? BROWSER_WODITOR_VERSION
      : requestedVersion;
  if (!RUNTIME_CHECKSUMS.has(version)) {
    throw new Error(
      `Unsupported Browser Woditor version ${JSON.stringify(version)}. Available versions: ${[...RUNTIME_CHECKSUMS.keys()].join(", ")}.`,
    );
  }
  return version;
}

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

function getRuntimeCachePath(version) {
  const dir = join(homedir(), ".cache", "wolftools", "runtime");
  const fileName = `browser-woditor-${version}.zip`;
  return join(dir, fileName);
}

export async function loadRuntimeZip({
  runtimeZipPath,
  runtimeVersion: requestedVersion,
  runtimeUrl,
  runtimeSha256: requestedSha256,
} = {}) {
  const runtimeVersion = resolveRuntimeVersion(requestedVersion);
  const runtimeSha256 =
    requestedSha256 === undefined
      ? RUNTIME_CHECKSUMS.get(runtimeVersion)
      : requestedSha256;
  const expectedHash = runtimeSha256 && runtimeSha256.toLowerCase();
  let bytes;
  let cachePath;
  if (runtimeZipPath) {
    bytes = await readFile(resolve(runtimeZipPath));
  } else {
    cachePath = getRuntimeCachePath(runtimeVersion);
    if (expectedHash && (await exists(cachePath))) {
      const cachedBytes = await readFile(cachePath);
      if (sha256(cachedBytes) === expectedHash) {
        process.stdout.write(
          `Using cached Browser Woditor ${runtimeVersion}...\n`,
        );
        return JSZip.loadAsync(cachedBytes);
      }
    }

    process.stdout.write(`Downloading Browser Woditor ${runtimeVersion}...\n`);
    const url =
      runtimeUrl ??
      `https://frostyhowl.com/files/BrowserWoditor_${runtimeVersion.replaceAll(".", "_")}.zip`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `Browser Woditor download failed (${response.status} ${response.statusText}).`,
      );
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }

  if (expectedHash) {
    const actualHash = sha256(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Browser Woditor ZIP checksum mismatch. Expected ${runtimeSha256}, received ${actualHash}.`,
      );
    }
    if (cachePath) {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, bytes);
    }
  }

  return JSZip.loadAsync(bytes);
}

// Match the current runtime's save namespace when running the legacy engine.
function getGameProjectPath() {
  const gameId =
    document.baseURI.match(/GameFilesUpdate\/(\d+)\/(\d+)/)?.[1] ||
    new URLSearchParams(window.location.search).get("Game_ID") ||
    window.location.pathname.match(/Game_ID=([A-Za-z0-9]+)/)?.[1];
  if (gameId) return `${gameId}_${WoditorGameSettings.projectId}`;

  let dir;
  try {
    dir = top.location.pathname;
  } catch {
    dir = window.location.pathname;
  }
  const separator = dir.endsWith("/") ? "" : "/";
  return `${dir}${separator}${WoditorGameSettings.projectId}`
    .replace("index.html/", "")
    .replace(/^\//, "")
    .replaceAll(".", "_")
    .replaceAll("/", "_");
}

async function runtimeFileContent(entry, path, runtimeVersion) {
  if (runtimeVersion !== LEGACY_BROWSER_WODITOR_VERSION)
    return entry.async("nodebuffer");

  if (path === "lib/system.js") {
    const source = await entry.async("string");
    const projectPath = /^function getGameProjectPath\(\)\s*\{[\s\S]*?^\}/m;
    if (!projectPath.test(source)) {
      throw new Error(
        "The legacy runtime does not define its save project path.",
      );
    }
    return Buffer.from(
      source.replace(projectPath, () => getGameProjectPath.toString()),
    );
  }
  if (path === "index.html") {
    const source = await entry.async("string");
    // The legacy runtime puts its click-to-start text in the header.
    return Buffer.from(
      source.replace(
        'document.getElementById("title-content").hidden = noHeaderFooter;',
        'document.getElementById("title-content").hidden = noHeaderFooter && !!window.Module?.woditor?.initialized;',
      ),
    );
  }
  return entry.async("nodebuffer");
}

export function runtimeFile(zip, path, runtimeVersion) {
  const entry = zip.file(`${RUNTIME_PREFIX}${path}`);
  if (!entry)
    throw new Error(
      `The runtime ZIP does not contain ${RUNTIME_PREFIX}${path}.`,
    );
  return runtimeFileContent(entry, path, runtimeVersion);
}

async function extractRuntime(zip, outputDir, runtimeVersion) {
  const entries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      entry.name.startsWith(RUNTIME_PREFIX) &&
      !entry.name.startsWith(`${RUNTIME_PREFIX}.vscode/`),
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
    const path = entry.name.slice(RUNTIME_PREFIX.length);
    // ZIP paths use forward slashes. Reject names Windows could reinterpret.
    if (
      /[\\:\0]/u.test(path) ||
      path.split("/").some((part) => !part || /[. ]$/u.test(part))
    ) {
      throw new Error(
        `Unsafe file name in runtime ZIP: ${JSON.stringify(entry.name)}`,
      );
    }
    const outputPath = join(outputDir, path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      await runtimeFileContent(entry, path, runtimeVersion),
    );
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

export function lazyAssetLoaderSource({
  sharedAssets = false,
  runtimeVersion,
} = {}) {
  const args = [
    JSON.stringify(sharedAssets),
    createDeferredAudioLoader.toString(),
    JSON.stringify(WEB_EXPORT_VERSION),
  ];
  if (runtimeVersion === LEGACY_BROWSER_WODITOR_VERSION) {
    // The pinned 0.4.1.0 build imports _alBufferData and _alDeleteBuffers
    // as a.F and a.Z in its generated Emscripten glue.
    args.push(
      JSON.stringify({ namespace: "a", bufferData: "F", deleteBuffers: "Z" }),
    );
  }
  return `(${installLazyAssets.toString()})(${args.join(", ")});\n`;
}

export function indexWithLazyAssetLoader(index) {
  const woditorScript =
    /<script\b[^>]*\bsrc=["'](?:\.\/)?woditor\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/i;
  if (!woditorScript.test(index)) {
    throw new Error("The runtime index does not load woditor.js.");
  }
  const loaderTag = `<script type="text/javascript" src="lib/lazy_assets.js?wolftools-export=${WEB_EXPORT_VERSION}"></script>`;
  const previousLoader =
    /<script\b[^>]*\bsrc=["'](?:\.\/)?lib\/lazy_assets\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi;
  return index
    .replace(previousLoader, "")
    .replace(woditorScript, `${loaderTag}\n  $&`);
}

export function indexWithCanvasFit(index) {
  // Match Browser Woditor's original width calculation and keep the rest of
  // its layout and input handling in place.
  const sizing = new RegExp(
    String.raw`^([ \t]*)const idealHeight = wholeHeight \* canvasRate;\s+` +
      String.raw`const idealWidth = idealHeight \* aspectRatio \+ minButtonWidth;\s+` +
      String.raw`const actualCanvasWidth = wholeWidth > idealWidth \? idealHeight \* aspectRatio : wholeWidth - minButtonWidth;`,
    "mu",
  );
  const fittedIndex = index.replace(sizing, (_match, indent) =>
    [
      'const holder = document.getElementById("screen-holder-main");',
      "const holderStyle = holder && window.getComputedStyle(holder);",
      "const availableWidth = wholeWidth - minButtonWidth",
      "  - (parseFloat(holderStyle?.marginLeft) || 0) - (parseFloat(holderStyle?.marginRight) || 0);",
      "const portraitLayout = typeof isPortrait === 'boolean'",
      "  ? isPortrait : wholeWidth / wholeHeight < 3.5 / 4;",
      "const availableHeight = holder && !portraitLayout",
      "  ? holder.getBoundingClientRect().height",
      "  : wholeHeight - (parseFloat(holderStyle?.marginTop) || 0) - (parseFloat(holderStyle?.marginBottom) || 0);",
      "const maxCanvasWidth = WoditorGameSettings.isFullscreen ? Infinity : canvas.width;",
      "const actualCanvasWidth = Math.max(0, Math.min(",
      "  availableWidth, availableHeight * canvasRate * aspectRatio, maxCanvasWidth",
      "));",
    ]
      .map((line) => indent + line)
      .join("\n"),
  );
  if (fittedIndex === index) return index;
  return fittedIndex.replace(
    /^([ \t]*)(function adjustGameUI\s*\(\)\s*\{)/mu,
    '$1window.addEventListener("resize", () => window.requestAnimationFrame(adjustGameUI));\n$1$2',
  );
}

async function addLazyAssetLoader(outputDir, options) {
  const indexPath = join(outputDir, "index.html");
  const index = await readFile(indexPath, "utf8");
  await writeFile(indexPath, indexWithLazyAssetLoader(index));
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
      console.warn(
        `${error.message} This file will use the existing asset loader if requested.`,
      );
    }
    files.push({
      path: `Data/${path}`,
      bytes: size,
      ...(audio ? { audio } : {}),
    });
    bytes += size;
  }
  return { version: 1, files, bytes };
}

async function findArchives(root, files) {
  const candidates = files.filter(isArchivePath);
  const matches = await Promise.all(
    candidates.map(
      async (path) =>
        /\.wolfx?$/iu.test(path) ||
        (await inspectFile(join(root, path))).native,
    ),
  );
  // .bin and .data can also be ordinary assets. Only detected archive
  // headers count for those extensions.
  return candidates.filter((_path, index) => matches[index]);
}

async function containsArchives(root, files) {
  return (await findArchives(root, files)).length > 0;
}

async function createLooseBrowserData(sourceDir, outputDir, runtimeVersion) {
  const workRoot = await mkdtemp(join(tmpdir(), "wolftools web "));
  const unpackedGame = join(workRoot, "game");
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

    await copyGameSupportFiles(sourceDir, outputDir);
    await addLazyAssetLoader(outputDir, { runtimeVersion });
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

function combinedOutputPath(sourceDir, outputDir) {
  const destination = join(sourceDir, "web");
  if (outputDir && resolve(outputDir) !== destination) {
    throw new Error(
      `Combined mode output must be ${destination}. Omit the output folder or use that path.`,
    );
  }
  return destination;
}

async function requireNoWebEntry(sourceDir) {
  const entry = (await readdir(sourceDir)).find(
    (name) => name.toLowerCase() === "web",
  );
  if (entry) {
    throw new Error(
      `Game folder already contains this path: ${join(sourceDir, entry)}`,
    );
  }
}

export async function inspectCombinedGame(sourcePath, { outputDir } = {}) {
  const sourceDir = await normalizeSourceDir(sourcePath);
  await requireNoWebEntry(sourceDir);
  combinedOutputPath(sourceDir, outputDir);
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

async function createSharedBrowserData(sourceDir, outputDir, runtimeVersion) {
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
  await addLazyAssetLoader(outputDir, { sharedAssets: true, runtimeVersion });
  return manifest;
}

export async function packageWolfGame({
  sourceDir,
  outputDir,
  runtimeZipPath,
  runtimeVersion: requestedVersion,
  runtimeUrl,
  runtimeSha256,
  separate = true,
}) {
  if (typeof separate !== "boolean")
    throw new Error("separate must be true or false.");
  const runtimeVersion = resolveRuntimeVersion(requestedVersion);
  const source = await normalizeSourceDir(sourceDir);
  // Check before reading/downloading a runtime or starting any extraction.
  await requireNoWebEntry(source);
  const destination = separate
    ? resolve(outputDir || `${source} web`)
    : combinedOutputPath(source, outputDir);
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
    runtimeVersion,
    runtimeUrl,
    runtimeSha256,
  });
  try {
    await mkdir(staging, { recursive: true });
    process.stdout.write("Preparing Browser Woditor runtime...\n");
    await extractRuntime(runtimeZip, staging, runtimeVersion);
    const indexPath = join(staging, "index.html");
    const index = await readFile(indexPath, "utf8");
    const fittedIndex = indexWithCanvasFit(index);
    if (fittedIndex !== index) await writeFile(indexPath, fittedIndex);
    let data;
    if (kind === "native") {
      const manifest = separate
        ? await createLooseBrowserData(source, staging, runtimeVersion)
        : await createSharedBrowserData(source, staging, runtimeVersion);
      const assets = await findCheckedAssets(
        join(separate ? staging : source, "Data"),
        manifest.files,
      );
      process.stdout.write("Creating the browser startup archive...\n");
      const bootArchive = join(staging, "Data.wolf");
      await rm(bootArchive, { force: true });
      await writeBrowserBootArchive(bootArchive, {
        assets,
        marker: await browserWoditorMarker(runtimeZip),
      });
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
          runtime: `Browser Woditor ${runtimeVersion}`,
          ...(requestedVersion && requestedVersion !== "default"
            ? { runtimePin: runtimeVersion }
            : {}),
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

    // Keep web/ absent until the export is complete and ready to publish.
    if (!separate) await requireNoWebEntry(source);
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (
      !separate &&
      error.syscall === "rename" &&
      ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)
    ) {
      await requireNoWebEntry(source);
    }
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
