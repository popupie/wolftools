import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { packDx8NoKeyArchive, unpackDx8Archive } from "../archive/dx8.mjs";
import { decodeShiftJis, encodeShiftJis } from "../archive/text.mjs";

const fileCheck = Buffer.from("<<GET_FILE_EXIST>>");
const utf8 = new TextDecoder("utf-8", { fatal: true });

function dataPath(path) {
  if (typeof path !== "string") return;
  const [root, ...parts] = path.replaceAll("\\", "/").split("/");
  if (
    root.toLowerCase() === "data" &&
    parts.length &&
    parts.every(
      (part) =>
        part && part !== "." && part !== ".." && !/[\0<>:"|?*]/u.test(part),
    )
  ) {
    return parts.join("/");
  }
}

function* literalFileChecks(bytes) {
  for (
    let offset = bytes.indexOf(fileCheck);
    offset !== -1;
    offset = bytes.indexOf(fileCheck, offset + fileCheck.length)
  ) {
    if (offset < 4) continue;
    const start = offset + fileCheck.length;
    const end = bytes.indexOf(0, start);
    // WOLF event strings have a 32-bit byte length that includes a final NUL.
    if (end <= start || bytes.readUInt32LE(offset - 4) !== end + 1 - offset)
      continue;
    const value = bytes.subarray(start, end);
    const paths = new Set([dataPath(decodeShiftJis(value))]);
    try {
      paths.add(dataPath(utf8.decode(value)));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    paths.delete(undefined);
    if (paths.size) yield paths;
  }
}

function pathKey(path) {
  return path.normalize("NFC").toLowerCase();
}

async function checkedAsset(dataDir, path, directories) {
  const parts = path.split("/");
  const stored = [];
  let source = dataDir;
  let entry;
  for (const [index, part] of parts.entries()) {
    if (!directories.has(source)) {
      directories.set(source, await readdir(source, { withFileTypes: true }));
    }
    const entries = directories.get(source);
    entry = entries.find((candidate) => candidate.name === part);
    if (!entry) {
      const key = pathKey(part);
      const matches = entries.filter(
        (candidate) => pathKey(candidate.name) === key,
      );
      if (matches.length !== 1) return;
      [entry] = matches;
    }
    if (!entry.isDirectory() && !(index === parts.length - 1 && entry.isFile()))
      return;
    stored.push(entry.name);
    source = join(source, entry.name);
  }
  return {
    source,
    path: stored.join("/").normalize("NFC"),
    directory: entry.isDirectory(),
  };
}

export async function findCheckedAssets(dataDir, files) {
  const candidates = files
    .map((file) => dataPath(file?.path))
    .filter(
      (path) =>
        path && (/\.mps$/iu.test(path) || /^BasicData\/.*\.dat$/iu.test(path)),
    );
  if (!candidates.length) return [];

  const root = await realpath(dataDir);
  const directories = new Map();
  const assets = new Map();
  for (const path of candidates) {
    const source = await realpath(join(root, path)).catch((error) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    });
    if (!source) continue;
    const inside = relative(root, source);
    if (
      !inside ||
      inside === ".." ||
      inside.startsWith(".." + sep) ||
      isAbsolute(inside)
    )
      continue;

    for (const names of literalFileChecks(await readFile(source))) {
      const matches = new Map();
      for (const name of names) {
        const asset = await checkedAsset(root, name, directories);
        if (asset) matches.set(asset.source, asset);
      }
      if (matches.size !== 1) continue;
      const [asset] = matches.values();
      if (assets.has(asset.path)) continue;
      try {
        encodeShiftJis(asset.path);
      } catch (error) {
        console.warn(
          `Could not add Data/${asset.path} to Data.wolf: ${error.message}`,
        );
        continue;
      }
      assets.set(asset.path, asset);
    }
  }
  return [...assets.values()];
}

export async function writeBrowserBootArchive(
  outputPath,
  { assets, marker, previousArchive },
) {
  const root = await mkdtemp(join(tmpdir(), "wolftools web boot "));
  const dataDir = join(root, "Data");
  try {
    if (previousArchive) {
      await unpackDx8Archive(previousArchive, dataDir);
    } else {
      await mkdir(join(dataDir, "BasicData"), { recursive: true });
      await writeFile(join(dataDir, "BasicData", "BrowserWoditor.dat"), marker);
    }

    let added = 0;
    for (const asset of assets) {
      const destination = join(dataDir, asset.path);
      const existing = await lstat(destination).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (existing) continue;
      if (asset.directory) {
        await mkdir(destination, { recursive: true });
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(asset.source, destination);
      }
      added++;
    }

    if (!previousArchive || added)
      await packDx8NoKeyArchive(dataDir, outputPath);
    return added;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
