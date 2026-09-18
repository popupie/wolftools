import { access, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import { ARCHIVE_EXTENSIONS } from "./constants.mjs";

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function requireDirectory(path, label = "Folder") {
  const resolved = resolve(path);
  const details = await stat(resolved).catch(() => undefined);
  if (!details?.isDirectory()) throw new Error(`${label} was not found: ${resolved}`);
  return resolved;
}

export async function requireFile(path, label = "File") {
  const resolved = resolve(path);
  const details = await stat(resolved).catch(() => undefined);
  if (!details?.isFile()) throw new Error(`${label} was not found: ${resolved}`);
  return resolved;
}

export function isArchivePath(path) {
  return ARCHIVE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function ensureNewDestination(path) {
  const destination = resolve(path);
  if (await exists(destination)) throw new Error(`Output folder already exists: ${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  return destination;
}
