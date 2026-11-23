import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import { ensureSlice, readOptionalU64, readU64 } from "./binary.mjs";

export const DIRECTORY_ATTRIBUTE = 0x10;
export const FILE_ATTRIBUTE = 0x20;
export const IO_SIZE = 1024 * 1024;

export async function readAt(handle, position, size, label) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      size - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error(`${label} ended unexpectedly.`);
    offset += bytesRead;
  }
  return buffer;
}

export function safeName(name) {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`Unsafe file name in archive: ${JSON.stringify(name)}`);
  }
  return name;
}

// DX6 and DX8 use the same four 64-bit directory fields.
export function parseDirectory64(directoryTable, offset) {
  const bytes = ensureSlice(directoryTable, offset, 32, "directory header");
  return {
    directoryAddress: readOptionalU64(bytes, 0),
    parentDirectoryAddress: readOptionalU64(bytes, 8),
    fileCount: readU64(bytes, 16),
    fileHeadAddress: readU64(bytes, 24),
  };
}

export async function scanDirectory(path, name = "", maxFileSize = Infinity) {
  const directory = { path, name, entries: [], parent: undefined };
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    const details = await lstat(entryPath);
    if (details.isSymbolicLink())
      throw new Error(`Symbolic links cannot be packed: ${entryPath}`);
    if (details.isDirectory()) {
      const child = await scanDirectory(entryPath, entry.name, maxFileSize);
      child.parent = directory;
      directory.entries.push(child);
    } else if (details.isFile()) {
      if (details.size > maxFileSize)
        throw new Error(
          `File exceeds the ${maxFileSize}-byte archive limit: ${entryPath}`,
        );
      directory.entries.push({
        path: entryPath,
        name: entry.name,
        size: details.size,
        parent: directory,
      });
    }
  }
  return directory;
}

export function flattenDirectories(root) {
  const directories = [];
  function visit(directory) {
    directories.push(directory);
    for (const entry of directory.entries) {
      if (entry.entries) visit(entry);
    }
  }
  visit(root);
  return directories;
}

export function flattenFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of directory.entries) {
      if (entry.entries) visit(entry);
      else files.push(entry);
    }
  }
  visit(root);
  return files;
}
