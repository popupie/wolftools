import { access, mkdir, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

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
  if (!details) throw new Error(`${label} was not found: ${resolved}`);
  if (!details.isDirectory())
    throw new Error(`${label} is not a directory: ${resolved}`);
  return resolved;
}

export async function requireFile(path, label = "File") {
  const resolved = resolve(path);
  const details = await stat(resolved).catch(() => undefined);
  if (!details) throw new Error(`${label} was not found: ${resolved}`);
  if (!details.isFile()) throw new Error(`${label} is not a file: ${resolved}`);
  return resolved;
}

export function isArchivePath(path) {
  return ARCHIVE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function listFiles(
  root,
  current = root,
  { rejectLinks = false } = {},
) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(current, entry.name);
    if (rejectLinks && entry.isSymbolicLink()) {
      throw new Error(`Shared game assets cannot be symbolic links: ${path}`);
    }
    if (entry.isDirectory())
      files.push(...(await listFiles(root, path, { rejectLinks })));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

// Resolve existing ancestors too, so a symlink cannot hide a nested output.
async function destinationRealPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(await destinationRealPath(dirname(path)), basename(path));
  }
}

export async function requireOutsideDirectory(path, directory) {
  const [source, destination] = await Promise.all([
    realpath(directory),
    destinationRealPath(resolve(path)),
  ]);
  const inside = relative(source, destination);
  if (
    inside === "" ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
  ) {
    throw new Error(
      "The output folder must be outside the source game folder.",
    );
  }
}

export async function ensureNewDestination(path) {
  const destination = resolve(path);
  if (await exists(destination))
    throw new Error(`Output folder already exists: ${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  return destination;
}
