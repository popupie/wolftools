import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import JSZip from "jszip";

import { packDx8NoKeyArchive } from "./archive/dx8.mjs";
import { unpackWolf } from "./unpack.mjs";

export const BROWSER_WODITOR_VERSION = "0.6.2.0";
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

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
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
    process.stdout.write(`Downloading Browser Woditor ${BROWSER_WODITOR_VERSION}...\n`);
    const response = await fetch(runtimeUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Browser Woditor download failed (${response.status} ${response.statusText}).`);
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
  if (!entries.some((entry) => entry.name === `${RUNTIME_PREFIX}woditor.wasm`)) {
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
    (entry) => !entry.dir && entry.name.replaceAll("\\", "/").endsWith("/BrowserWoditor.dat"),
  );
  if (!marker) {
    throw new Error("The runtime ZIP does not contain BrowserWoditor.dat.");
  }
  return marker.async("nodebuffer");
}

export function lazyAssetLoaderSource() {
  return `(() => {
  const loaderScript = document.currentScript;
  if (!loaderScript?.src) {
    throw new Error("Could not determine the WOLF game folder URL.");
  }
  const gameRoot = new URL("../", loaderScript.src);

  function readManifest() {
    const manifestUrl = new URL("asset_manifest.json", gameRoot);
    const request = new XMLHttpRequest();
    request.open("GET", manifestUrl.href, false);
    request.send(null);
    if (request.status < 200 || request.status >= 300) {
      throw new Error(\`Could not load the WOLF asset manifest. HTTP \${request.status}\`);
    }
    try {
      return JSON.parse(request.responseText);
    } catch {
      throw new Error(\`The WOLF asset manifest URL returned invalid JSON: \${manifestUrl.href}\`);
    }
  }

  const manifest = readManifest();
  const available = new Map();
  for (const file of manifest.files) {
    const storedPath = normalize(file.path);
    for (const key of pathKeys(storedPath)) available.set(key, storedPath);
  }

  const stats = { requests: 0, bytes: 0, files: [], missing: [] };
  window.WolfLazyAssetStats = stats;
  const reportedMissing = new Set();

  function normalize(path) {
    const parts = String(path).replaceAll("\\\\", "/").split("/");
    const normalized = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") normalized.pop();
      else normalized.push(part);
    }
    return normalized.join("/");
  }

  function pathKeys(path) {
    const keys = new Set();
    const normalized = normalize(path);
    for (const candidate of new Set([
      normalized,
      normalized.normalize("NFC"),
      normalized.normalize("NFD"),
    ])) {
      const lower = candidate.toLowerCase();
      keys.add(lower);
      if (lower.startsWith("data/")) keys.add(candidate.slice(5).toLowerCase());
      const dataOffset = lower.lastIndexOf("/data/");
      if (dataOffset >= 0) keys.add(candidate.slice(dataOffset + 1).toLowerCase());
    }
    return Array.from(keys);
  }

  function assetUrl(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return new URL(encoded, gameRoot).href;
  }

  function ensureParents(path) {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current += \`/\${part}\`;
      if (!FS.analyzePath(current).exists) FS.mkdir(current);
    }
  }

  function load(path) {
    const requested = normalize(path);
    const relative = pathKeys(requested)
      .map((key) => available.get(key))
      .find((candidate) => candidate !== undefined);
    if (!relative) {
      const lower = requested.toLowerCase();
      if (
        lower.includes("data/") &&
        /\.[^/.]{1,8}$/u.test(requested) &&
        !/-(?:gamecache|save)\//iu.test(requested) &&
        !lower.endsWith(".wolf") &&
        !lower.endsWith(".wolfx") &&
        !reportedMissing.has(lower)
      ) {
        reportedMissing.add(lower);
        stats.missing.push(requested);
        console.debug(\`Wolf Tools could not match asset: \${requested}\`);
      }
      return false;
    }

    const absolute = \`/\${requested}\`;
    if (FS.analyzePath(absolute).exists) return true;

    const request = new XMLHttpRequest();
    request.open("GET", assetUrl(relative), false);
    request.overrideMimeType("text/plain; charset=x-user-defined");
    request.send(null);
    if (request.status < 200 || request.status >= 300) {
      throw new Error(\`Could not load WOLF asset \${relative}. HTTP \${request.status}\`);
    }

    const bytes = new Uint8Array(request.responseText.length);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = request.responseText.charCodeAt(index) & 255;
    }
    ensureParents(requested);
    FS.writeFile(absolute, bytes);
    stats.requests += 1;
    stats.bytes += bytes.byteLength;
    stats.files.push(relative);
    console.log(\`Wolf Tools loaded asset: \${relative} (\${bytes.byteLength} bytes)\`);
    return true;
  }

  Module.preRun.push(() => {
    const originalOpen = FS.open;
    const originalStat = FS.stat;
    const originalLstat = FS.lstat;

    FS.open = function(path, flags) {
      const readOnly = typeof flags === "string"
        ? !/[wa+]/.test(flags)
        : (flags & 3) === 0;
      if (readOnly) load(path);
      return originalOpen.apply(FS, arguments);
    };
    FS.stat = function(path) {
      load(path);
      return originalStat.apply(FS, arguments);
    };
    FS.lstat = function(path) {
      load(path);
      return originalLstat.apply(FS, arguments);
    };
  });
})();
`;
}

async function addLazyAssetLoader(outputDir) {
  const indexPath = join(outputDir, "index.html");
  const index = await readFile(indexPath, "utf8");
  const woditorScript = /<script\b[^>]*\bsrc=["']woditor\.js["'][^>]*><\/script>/i;
  if (!woditorScript.test(index)) {
    throw new Error("The runtime index does not load woditor.js.");
  }
  const loaderTag = '<script type="text/javascript" src="lib/lazy_assets.js"></script>';
  await writeFile(indexPath, index.replace(woditorScript, `${loaderTag}\n  $&`));
  await mkdir(join(outputDir, "lib"), { recursive: true });
  await writeFile(join(outputDir, "lib", "lazy_assets.js"), lazyAssetLoaderSource());
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
  if (!details) throw new Error(`Game or prepared release was not found: ${input}`);
  if (details.isDirectory()) return input;
  if (details.isFile() && /Game(?:Pro)?\.exe$/i.test(basename(input))) return dirname(input);
  throw new Error("Web input must be a game folder, Game.exe, GamePro.exe, or prepared release.");
}

async function sourceKind(sourceDir) {
  await requireDirectory(sourceDir, "Game or prepared release folder");
  for (const name of ["Game.exe", "GamePro.exe"]) {
    if (await exists(join(sourceDir, name))) {
      if (!(await exists(join(sourceDir, "Data"))) && !(await exists(join(sourceDir, "Data.wolf")))) {
        throw new Error("The game has neither a Data folder nor Data.wolf.");
      }
      return "native";
    }
  }

  await requireFile(join(sourceDir, "Data.wolf"), "Browser Woditor ready Data.wolf");
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
    await cp(saveDir, join(outputDir, "Save"), { recursive: true, dereference: true });
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
    await cp(saveDir, join(outputDir, "Save"), { recursive: true, dereference: true });
  }
}

async function createAssetManifest(dataDir) {
  const paths = await listFiles(dataDir);
  const files = [];
  let bytes = 0;
  for (const path of paths) {
    const size = (await stat(join(dataDir, path))).size;
    files.push({ path: `Data/${path}`, bytes: size });
    bytes += size;
  }
  return { version: 1, files, bytes };
}

async function createLooseBrowserData(sourceDir, outputDir, runtimeZip) {
  const workRoot = await mkdtemp(join(tmpdir(), "wolftools web "));
  const unpackedGame = join(workRoot, "game");
  const bootData = join(workRoot, "boot");
  try {
    process.stdout.write("Unpacking source archives...\n");
    await unpackWolf({ sourcePath: sourceDir, outputDir: unpackedGame });
    const dataDir = join(unpackedGame, "Data");
    await requireDirectory(dataDir, "Unpacked Data folder");

    process.stdout.write("Copying browser assets...\n");
    await cp(dataDir, join(outputDir, "Data"), { recursive: true, dereference: true });
    const manifest = await createAssetManifest(join(outputDir, "Data"));
    await writeFile(
      join(outputDir, "asset_manifest.json"),
      `${JSON.stringify(manifest)}\n`,
    );

    const markerDir = join(bootData, "BasicData");
    await mkdir(markerDir, { recursive: true });
    await writeFile(join(markerDir, "BrowserWoditor.dat"), await browserWoditorMarker(runtimeZip));

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

export async function packageWolfGame({
  sourceDir,
  outputDir,
  runtimeZipPath,
  runtimeUrl = BROWSER_WODITOR_URL,
  runtimeSha256 = BROWSER_WODITOR_SHA256,
}) {
  const source = await normalizeSourceDir(sourceDir);
  const destination = resolve(outputDir || `${source} web`);
  if (source === destination || destination.startsWith(`${source}${sep}`)) {
    throw new Error("The output folder must be outside the prepared release folder.");
  }
  if (await exists(destination)) {
    throw new Error(`Output folder already exists: ${destination}`);
  }

  const kind = await sourceKind(source);
  const gameTitle = basename(source).trim();
  const saveProjectId = safeProjectId(gameTitle);
  const staging = join(dirname(destination), `.${basename(destination)}.tmp-${randomUUID()}`);
  const runtimeZip = await loadRuntimeZip({ runtimeZipPath, runtimeUrl, runtimeSha256 });

  try {
    await mkdir(staging, { recursive: true });
    process.stdout.write("Preparing Browser Woditor runtime...\n");
    await extractRuntime(runtimeZip, staging);
    let data;
    if (kind === "native") {
      const manifest = await createLooseBrowserData(source, staging, runtimeZip);
      data = {
        delivery: "files",
        manifest: "asset_manifest.json",
        root: "Data",
        bootArchive: "Data.wolf",
        files: manifest.files.length,
        bytes: manifest.bytes,
      };
    } else {
      process.stdout.write("Copying creator export...\n");
      await copyPreparedRelease(source, staging);
      data = { delivery: "archive", file: "Data.wolf" };
    }

    if (!(await exists(join(staging, "Game.ini")))) {
      await writeFile(join(staging, "Game.ini"), DEFAULT_GAME_INI);
    }

    await writeFile(join(staging, "settings.js"), settingsSource(saveProjectId, gameTitle));
    await writeFile(
      join(staging, "browser-game.json"),
      `${JSON.stringify({
        title: gameTitle,
        engine: "wolf-rpg",
        runtime: `Browser Woditor ${BROWSER_WODITOR_VERSION}`,
        data,
      }, null, 2)}\n`,
    );

    const downloadableFiles = ["Data.wolf", "DefaultSoundFont.sf2", "Game.ini"];
    const saveFiles = (await exists(join(staging, "Save")))
      ? (await listFiles(join(staging, "Save"))).map((path) => `Save/${path}`)
      : [];
    await writeFile(
      join(staging, "InitialDownloadList.ini"),
      `${[...downloadableFiles, ...saveFiles].join("\r\n")}\r\n`,
    );

    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    outputDir: destination,
    title: gameTitle,
    projectId: saveProjectId,
    sourceKind: kind,
  };
}
