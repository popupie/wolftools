// Serialized into the generated, classic (non-module) lazy_assets.js script.
export function installLazyAssets(
  sharedAssets,
  createDeferredAudioLoader,
  exportVersion = 0,
  audioImports,
) {
  const loaderScript = document.currentScript;
  if (!loaderScript?.src)
    throw new Error("Could not determine the WOLF game folder URL.");
  const exportRoot = new URL("../", loaderScript.src);
  const gameRoot = new URL(sharedAssets ? "../" : "./", exportRoot);
  const manifestUrl = new URL("asset_manifest.json", exportRoot);
  if (exportVersion)
    manifestUrl.searchParams.set("wolftools-export", exportVersion);
  const request = new XMLHttpRequest();
  request.open("GET", manifestUrl.href, false);
  request.send(null);
  if (request.status < 200 || request.status >= 300) {
    throw new Error(
      `Could not load the WOLF asset manifest. HTTP ${request.status}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(request.responseText);
  } catch {
    throw new Error(
      `The WOLF asset manifest URL returned invalid JSON: ${manifestUrl.href}`,
    );
  }

  function normalize(path) {
    const normalized = [];
    for (const part of String(path).replaceAll("\\", "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") normalized.pop();
      else normalized.push(part);
    }
    return normalized.join("/");
  }

  function pathKeys(path) {
    const keys = new Set();
    const normalized = normalize(path);
    for (const candidate of [
      normalized,
      normalized.normalize("NFC"),
      normalized.normalize("NFD"),
    ]) {
      const lower = candidate.toLowerCase();
      keys.add(lower);
      if (lower.startsWith("data/")) keys.add(candidate.slice(5).toLowerCase());
      const dataOffset = lower.lastIndexOf("/data/");
      if (dataOffset >= 0)
        keys.add(candidate.slice(dataOffset + 1).toLowerCase());
    }
    return Array.from(keys);
  }

  const available = new Map();
  const directories = new Set();
  for (const file of manifest.files) {
    const stored = normalize(file.path);
    for (const key of pathKeys(stored)) available.set(key, stored);
    if (!stored.toLowerCase().startsWith("data/")) continue;
    for (let end = stored.lastIndexOf("/"); end > 0; ) {
      const parent = stored.slice(0, end);
      if (directories.has(parent)) break;
      directories.add(parent);
      end = parent.lastIndexOf("/");
    }
  }
  const directoryKeys = new Set([...directories].flatMap(pathKeys));
  const stats = {
    requests: 0,
    bytes: 0,
    files: [],
    missing: [],
    pendingAudio: [],
    audioErrors: [],
  };
  window.WolfLazyAssetStats = stats;
  const reportedMissing = new Set();
  const assetUrl = (path) =>
    new URL(path.split("/").map(encodeURIComponent).join("/"), gameRoot).href;
  const binaryAssets = new Map(
    manifest.files
      .filter((file) => file.hasUnicodeBom)
      .map((file) => [normalize(file.path), undefined]),
  );

  async function preloadBinaryAsset(path) {
    try {
      const response = await fetch(assetUrl(path));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      binaryAssets.set(path, new Uint8Array(await response.arrayBuffer()));
    } catch (cause) {
      binaryAssets.set(
        path,
        new Error(`Could not load WOLF asset ${path}: ${cause.message}`, {
          cause,
        }),
      );
    }
  }

  function loaded(path, bytes) {
    stats.requests++;
    stats.bytes += bytes;
    stats.files.push(path);
    console.log(`wolftools loaded asset: ${path} (${bytes} bytes)`);
  }
  const audio = createDeferredAudioLoader(Module, manifest.files, {
    audioImports,
    pathKeys,
    assetUrl,
    exportRoot: exportRoot.href,
    onLoad: loaded,
    onPending(path, pending) {
      if (pending) stats.pendingAudio.push(path);
      else stats.pendingAudio.splice(stats.pendingAudio.indexOf(path), 1);
    },
    onError(path, error) {
      stats.audioErrors.push({ path, error });
      console.warn(`wolftools could not load audio ${path}: ${error}`);
    },
  });

  function load(path) {
    const requested = normalize(path);
    const keys = pathKeys(requested);
    const relative = keys
      .map((key) => available.get(key))
      .find((candidate) => candidate !== undefined);
    const audioPath = audio.resolve(requested, relative);
    if (audioPath) return audioPath;
    const absolute = `/${requested}`;
    if (!relative) {
      const lower = requested.toLowerCase();
      const isAssetDirectory =
        keys.some((key) => directoryKeys.has(key)) ||
        (/^data0\/[^/]+-gamecache\/data$/u.test(lower) &&
          directoryKeys.has("data"));
      // Browser Woditor probes the parent directory before opening a loose file.
      if (isAssetDirectory && !/^data0\/[^/]+-save\//u.test(lower)) {
        if (!FS.analyzePath(absolute).exists) FS.mkdirTree(absolute);
        return;
      }
      if (
        lower.includes("data/") &&
        /\.[^/.]{1,8}$/u.test(requested) &&
        !lower.includes("-gamecache/") &&
        !lower.includes("-save/") &&
        !lower.endsWith(".wolf") &&
        !lower.endsWith(".wolfx") &&
        !reportedMissing.has(lower)
      ) {
        reportedMissing.add(lower);
        stats.missing.push(requested);
        console.debug(`wolftools could not match asset: ${requested}`);
      }
      return;
    }
    if (FS.analyzePath(absolute).exists) return;
    let bytes = binaryAssets.get(relative);
    if (binaryAssets.has(relative)) {
      if (bytes instanceof Error) throw bytes;
      if (!bytes) throw new Error(`Still loading WOLF asset ${relative}.`);
    } else {
      const request = new XMLHttpRequest();
      request.open("GET", assetUrl(relative), false);
      request.overrideMimeType("text/plain; charset=x-user-defined");
      request.send(null);
      if (request.status < 200 || request.status >= 300) {
        throw new Error(
          `Could not load WOLF asset ${relative}. HTTP ${request.status}`,
        );
      }
      bytes = Uint8Array.from(
        request.responseText,
        (character) => character.charCodeAt(0) & 255,
      );
    }
    FS.mkdirTree(absolute.slice(0, absolute.lastIndexOf("/")) || "/");
    FS.writeFile(absolute, bytes);
    loaded(relative, bytes.byteLength);
  }

  Module.preRun.push(() => {
    audio.initialize(FS);
    const originalOpen = FS.open;
    const originalStat = FS.stat;
    const originalLstat = FS.lstat;
    FS.open = function (path, flags) {
      const readOnly =
        typeof flags === "string" ? !/[wa+]/.test(flags) : (flags & 3) === 0;
      const redirected =
        readOnly && typeof path === "string" ? load(path) : undefined;
      const args = Array.from(arguments);
      if (redirected) args[0] = redirected;
      return originalOpen.apply(FS, args);
    };
    FS.stat = function (path) {
      const args = Array.from(arguments);
      args[0] = load(path) ?? path;
      return originalStat.apply(FS, args);
    };
    FS.lstat = function (path) {
      const args = Array.from(arguments);
      args[0] = load(path) ?? path;
      return originalLstat.apply(FS, args);
    };
    const preload = manifest.preload || [];
    for (const path of preload) {
      if (!binaryAssets.has(normalize(path))) load(path);
    }
    if (binaryAssets.size) {
      // Synchronous XHR on the main thread exposes a text response. Its BOM
      // detection can override x-user-defined, so fetch these assets as bytes.
      const dependency = "wolftools-binary-assets";
      addRunDependency(dependency);
      Promise.all(Array.from(binaryAssets.keys(), preloadBinaryAsset))
        .then(() => {
          for (const path of preload) {
            if (binaryAssets.has(normalize(path))) load(path);
          }
        })
        .catch((error) => console.error(error))
        .finally(() => removeRunDependency(dependency));
    }
  });
}
