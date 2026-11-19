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
  const originalInstantiate = Module.instantiateWasm;

  function startupError(error) {
    Module.printErr?.(String(error));
    if (typeof abort === "function") abort(error);
    else console.error(error);
  }

  // Install this gate synchronously: the audio adapter needs the manifest
  // before it can wrap Wasm imports, and preRun must be registered before run().
  Module.instantiateWasm = function (imports, receiveInstance) {
    (async () => {
      const response = await fetch(manifestUrl.href);
      if (!response.ok)
        throw new Error(
          `Could not load the WOLF asset manifest. HTTP ${response.status}`,
        );
      let manifest;
      try {
        manifest = await response.json();
      } catch {
        throw new Error(
          `The WOLF asset manifest URL returned invalid JSON: ${manifestUrl.href}`,
        );
      }
      Module.instantiateWasm = originalInstantiate ?? instantiateWasm;
      initialize(manifest);
      await Module.instantiateWasm.call(this, imports, receiveInstance);
    })().catch(startupError);
    return {};
  };

  async function instantiateWasm(imports, receiveInstance) {
    let bytes = Module.wasmBinary;
    if (!bytes) {
      const url = Module.locateFile
        ? Module.locateFile("woditor.wasm", exportRoot.href)
        : new URL("woditor.wasm", exportRoot).href;
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(
          `Could not load Browser Woditor. HTTP ${response.status}`,
        );
      bytes = await response.arrayBuffer();
    }
    const result = await WebAssembly.instantiate(bytes, imports);
    receiveInstance(result.instance ?? result, result.module);
  }

  function initialize(manifest) {
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
        if (lower.startsWith("data/"))
          keys.add(candidate.slice(5).toLowerCase());
        const dataOffset = lower.lastIndexOf("/data/");
        if (dataOffset >= 0)
          keys.add(candidate.slice(dataOffset + 1).toLowerCase());
      }
      return Array.from(keys);
    }

    const available = new Map();
    const assetSizes = new Map();
    const pendingFiles = new WeakSet();
    const audioFiles = new Set();
    const directories = new Set();
    for (const file of manifest.files) {
      const stored = normalize(file.path);
      if (file.audio) audioFiles.add(stored);
      for (const key of pathKeys(stored)) available.set(key, stored);
      assetSizes.set(stored, file.bytes ?? 0);
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
    const exportedAssets = new Map(
      manifest.files
        .filter((file) => file.exportPath)
        .map((file) => [normalize(file.path), file.exportPath]),
    );
    const assetUrl = (path) =>
      new URL(
        (exportedAssets.get(path) ?? path)
          .split("/")
          .map(encodeURIComponent)
          .join("/"),
        exportedAssets.has(path) ? exportRoot : gameRoot,
      ).href;
    const cachedAssets = new Map(
      manifest.files
        .filter((file) => file.hasUnicodeBom)
        .map((file) => [normalize(file.path), undefined]),
    );

    const preload = manifest.preload || [];
    for (const path of preload) {
      const relative = pathKeys(path)
        .map((key) => available.get(key))
        .find((candidate) => candidate !== undefined);
      if (relative && !audioFiles.has(relative))
        cachedAssets.set(relative, undefined);
    }

    async function preloadAsset(path) {
      try {
        const response = await fetch(assetUrl(path));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        cachedAssets.set(path, bytes);
        loaded(path, bytes.byteLength);
      } catch (cause) {
        cachedAssets.set(
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

    function assetBytes(relative) {
      if (cachedAssets.has(relative)) {
        const bytes = cachedAssets.get(relative);
        if (bytes instanceof Error) throw bytes;
        if (!bytes) throw new Error(`Still loading WOLF asset ${relative}.`);
        return bytes;
      }
      const request = new XMLHttpRequest();
      request.open("GET", assetUrl(relative), false);
      request.overrideMimeType("text/plain; charset=x-user-defined");
      request.send(null);
      if (request.status < 200 || request.status >= 300) {
        throw new Error(
          `Could not load WOLF asset ${relative}. HTTP ${request.status}`,
        );
      }
      const bytes = Uint8Array.from(
        request.responseText,
        (character) => character.charCodeAt(0) & 255,
      );
      loaded(relative, bytes.byteLength);
      return bytes;
    }

    function fillLazyFile(node, relative) {
      const bytes = assetBytes(relative);
      node.contents = bytes;
      node.usedBytes = bytes.byteLength;
      return bytes;
    }

    function createLazyFile(absolute, relative) {
      FS.mkdirTree(absolute.slice(0, absolute.lastIndexOf("/")) || "/");
      const node = FS.create(absolute);
      node.usedBytes = assetSizes.get(relative);
      pendingFiles.add(node);
      const nodeOps = node.node_ops;
      node.node_ops = {
        ...nodeOps,
        setattr(target, attributes) {
          // Truncation discards the old bytes. MEMFS must not read the lazy
          // contents just to replace them with an empty buffer.
          if (attributes.size === 0 && pendingFiles.has(target)) {
            target.contents = new Uint8Array(0);
            target.usedBytes = 0;
          }
          return nodeOps.setattr(target, attributes);
        },
      };
      // Native copy_file/access and IDBFS need a real node, not just a stat
      // result. MEMFS stats use usedBytes without reading contents. Reading
      // contents (including an IDBFS flush) must fetch the real bytes first.
      Object.defineProperty(node, "contents", {
        configurable: true,
        enumerable: true,
        get() {
          return fillLazyFile(node, relative);
        },
        set(contents) {
          Object.defineProperty(node, "contents", {
            configurable: true,
            enumerable: true,
            writable: true,
            value: contents,
          });
          pendingFiles.delete(node);
          node.node_ops = nodeOps;
        },
      });
    }

    function load(path, metadataOnly = false) {
      if (typeof path !== "string") return;
      const requested = normalize(path);
      const keys = pathKeys(requested);
      const relative = keys
        .map((key) => available.get(key))
        .find((candidate) => candidate !== undefined);
      const audioPath = audio.resolve(requested, relative, metadataOnly);
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
      const info = FS.analyzePath(absolute, metadataOnly);
      if (info.exists) {
        if (!metadataOnly && pendingFiles.has(info.object))
          fillLazyFile(info.object, relative);
        return;
      }
      if (metadataOnly) return createLazyFile(absolute, relative);
      const bytes = assetBytes(relative);
      FS.mkdirTree(absolute.slice(0, absolute.lastIndexOf("/")) || "/");
      FS.writeFile(absolute, bytes);
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
        args[0] = load(path, true) ?? path;
        return originalStat.apply(FS, args);
      };
      FS.lstat = function (path) {
        const args = Array.from(arguments);
        args[0] = load(path, true) ?? path;
        return originalLstat.apply(FS, args);
      };
      if (cachedAssets.size) {
        // Synchronous XHR on the main thread exposes a text response. Its BOM
        // detection can override x-user-defined, so fetch these assets as bytes.
        const dependency = "wolftools-startup-assets";
        addRunDependency(dependency);
        return Promise.all(Array.from(cachedAssets.keys(), preloadAsset))
          .then(() => {
            for (const path of preload) load(path);
            removeRunDependency(dependency);
          })
          .catch(startupError);
      }
      for (const path of preload) load(path);
    });
  }
}
