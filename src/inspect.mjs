import { open, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

import { detectDx6Header } from "./archive/dx6.mjs";
import { inspectDx8Archive } from "./archive/dx8.mjs";
import { CRYPT_VERSION_NAMES } from "./constants.mjs";
import { isArchivePath, listFiles, requireFile } from "./files.mjs";

async function readStart(path, length = 64) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function scanExecutable(path) {
  const handle = await open(path, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  let carry = "";
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const text = carry + buffer.subarray(0, bytesRead).toString("latin1");
      const version = text.match(/Game(?:Pro)?([0-9]+(?:\.[0-9]+)+)\.pdb/i)?.[1];
      if (version) return version;
      carry = text.slice(-128);
      position += bytesRead;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

export async function inspectFile(path) {
  const file = await requireFile(path);
  const details = await stat(file);
  const start = await readStart(file);
  const extension = extname(file).toLowerCase();
  const result = {
    path: file,
    name: basename(file),
    bytes: details.size,
    type: "file",
  };

  if (extension === ".exe" && start[0] === 0x4d && start[1] === 0x5a) {
    return {
      ...result,
      type: "wolf executable",
      pro: basename(file).toLowerCase() === "gamepro.exe",
      editorVersion: await scanExecutable(file),
    };
  }

  if (!isArchivePath(file)) return result;

  const clearHeader = start.length >= 49 && start.toString("ascii", 0, 2) === "DX";
  if (!clearHeader) {
    const native = start.length >= 48 ? detectDx6Header(start.subarray(0, 48), details.size) : undefined;
    return {
      ...result,
      type: "wolf archive",
      header: native ? "encrypted" : "encrypted or obfuscated",
      archiveVersion: native?.header ? 6 : undefined,
      cryptVersion: undefined,
      mode: native?.mode.label,
      native: Boolean(native),
    };
  }

  const archiveVersion = start.readUInt16LE(2);
  const flags = start.readUInt32LE(44);
  const cryptVersion = flags >>> 16;
  let dx8;
  if (archiveVersion === 8 && cryptVersion === 0) {
    dx8 = await inspectDx8Archive(file).catch(() => undefined);
  }
  return {
    ...result,
    type: "wolf archive",
    header: "DX",
    archiveVersion,
    cryptVersion,
    mode: dx8?.mode.label || CRYPT_VERSION_NAMES.get(cryptVersion),
    native: Boolean(dx8),
  };
}

export async function inspectPath(path) {
  const target = resolve(path);
  const details = await stat(target).catch(() => undefined);
  if (!details) throw new Error(`Path was not found: ${target}`);
  if (details.isFile()) return [await inspectFile(target)];

  const files = await listFiles(target);
  const relevant = files.filter((file) => isArchivePath(file) || /Game(?:Pro)?\.exe$/i.test(file));
  const results = await Promise.all(relevant.map((file) => inspectFile(file)));
  return results.map((result) => ({ ...result, path: relative(target, result.path) }));
}

export function formatInspection(results) {
  if (results.length === 0) return "No WOLF archives or game executable were found.";
  return results
    .map((result) => {
      const lines = [result.path, `  Type: ${result.type}`, `  Size: ${result.bytes} bytes`];
      if (result.editorVersion) lines.push(`  Editor: ${result.editorVersion}`);
      if (result.pro !== undefined) lines.push(`  Pro: ${result.pro ? "yes" : "no"}`);
      if (result.header) lines.push(`  Header: ${result.header}`);
      if (result.archiveVersion !== undefined) lines.push(`  DX archive: ${result.archiveVersion}`);
      if (result.cryptVersion !== undefined) lines.push(`  Crypt value: ${result.cryptVersion}`);
      if (result.mode) lines.push(`  Mode: ${result.mode}`);
      if (result.native !== undefined) lines.push(`  Native support: ${result.native ? "yes" : "not yet"}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
