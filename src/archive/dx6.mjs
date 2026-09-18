import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { PACK_MODES } from "../constants.mjs";
import { align4, ensureSlice, readU64, writeU64, xorBuffer } from "./binary.mjs";
import { decodeLz } from "./lz.mjs";
import { decodeName, encodeName } from "./text.mjs";

const HEADER_SIZE = 48;
const FILE_HEADER_SIZE = 64;
const DIRECTORY_SIZE = 32;
const DIRECTORY_ATTRIBUTE = 0x10;
const FILE_ATTRIBUTE = 0x20;
const MAX_U64 = 0xffffffffffffffffn;
const IO_SIZE = 1024 * 1024;

function nativeModes() {
  return PACK_MODES.filter((mode) => mode.archiveVersion === 6);
}

export function createDx6Key(source) {
  if (source.length !== 12) throw new Error("A DX version 6 key must contain 12 bytes.");
  const key = Buffer.from(source);
  key[0] = ~key[0];
  key[1] = (key[1] >>> 4) | (key[1] << 4);
  key[2] ^= 0x8a;
  key[3] = ~((key[3] >>> 4) | (key[3] << 4));
  key[4] = ~key[4];
  key[5] ^= 0xac;
  key[6] = ~key[6];
  key[7] = ~((key[7] >>> 3) | (key[7] << 5));
  key[8] = (key[8] >>> 5) | (key[8] << 3);
  key[9] ^= 0x7f;
  key[10] = ((key[10] >>> 4) | (key[10] << 4)) ^ 0xd6;
  key[11] ^= 0xcc;
  return key;
}

async function readAt(handle, position, size, label) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset);
    if (bytesRead === 0) throw new Error(`${label} ended unexpectedly.`);
    offset += bytesRead;
  }
  return buffer;
}

function parseHeader(buffer, archiveBytes) {
  if (buffer.length !== HEADER_SIZE) throw new Error("Invalid DX version 6 header size.");
  if (buffer.toString("ascii", 0, 2) !== "DX" || buffer.readUInt16LE(2) !== 6) {
    throw new Error("Not a DX version 6 archive.");
  }
  const header = {
    headSize: buffer.readUInt32LE(4),
    dataStart: readU64(buffer, 8),
    nameTableStart: readU64(buffer, 16),
    fileTableStart: readU64(buffer, 24),
    directoryTableStart: readU64(buffer, 32),
    codePage: readU64(buffer, 40),
  };
  if (header.dataStart !== HEADER_SIZE) throw new Error("Unsupported DX data start address.");
  if (header.nameTableStart < HEADER_SIZE || header.nameTableStart + header.headSize > archiveBytes) {
    throw new Error("The DX header table is outside the archive.");
  }
  if (
    header.fileTableStart < 4 ||
    header.fileTableStart > header.directoryTableStart ||
    header.directoryTableStart > header.headSize
  ) {
    throw new Error("The DX table addresses are invalid.");
  }
  return header;
}

export function detectDx6Header(encryptedHeader, archiveBytes = Number.MAX_SAFE_INTEGER) {
  for (const mode of nativeModes()) {
    const key = createDx6Key(mode.key);
    const headerBytes = xorBuffer(encryptedHeader, key, 0);
    try {
      return { mode, key, header: parseHeader(headerBytes, archiveBytes) };
    } catch {
      continue;
    }
  }
  return undefined;
}

function readOptionalU64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  return value === MAX_U64 ? undefined : readU64(buffer, offset);
}

function parseFileHeader(fileTable, offset) {
  const bytes = ensureSlice(fileTable, offset, FILE_HEADER_SIZE, "file header");
  return {
    nameAddress: readU64(bytes, 0),
    attributes: readU64(bytes, 8),
    dataAddress: readU64(bytes, 40),
    dataSize: readU64(bytes, 48),
    pressDataSize: readOptionalU64(bytes, 56),
  };
}

function parseDirectory(directoryTable, offset) {
  const bytes = ensureSlice(directoryTable, offset, DIRECTORY_SIZE, "directory header");
  return {
    directoryAddress: readOptionalU64(bytes, 0),
    parentDirectoryAddress: readOptionalU64(bytes, 8),
    fileCount: readU64(bytes, 16),
    fileHeadAddress: readU64(bytes, 24),
  };
}

function safeName(name) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`Unsafe file name in archive: ${JSON.stringify(name)}`);
  }
  return name;
}

async function writeDecodedFile({ archive, header, key, file, outputPath }) {
  const dataPosition = header.dataStart + file.dataAddress;
  const storedSize = file.pressDataSize ?? file.dataSize;
  if (dataPosition < header.dataStart || dataPosition + storedSize > header.nameTableStart) {
    throw new Error(`File data is outside the archive: ${basename(outputPath)}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const output = await open(outputPath, "wx");
  try {
    if (file.dataSize === 0) return;
    if (file.pressDataSize !== undefined) {
      const encrypted = await readAt(archive, dataPosition, file.pressDataSize, "Compressed file data");
      const compressed = xorBuffer(encrypted, key, file.dataSize);
      const decoded = decodeLz(compressed, file.dataSize);
      await output.write(decoded, 0, decoded.length, 0);
      return;
    }

    let offset = 0;
    while (offset < file.dataSize) {
      const size = Math.min(IO_SIZE, file.dataSize - offset);
      const encrypted = await readAt(archive, dataPosition + offset, size, "File data");
      const decoded = xorBuffer(encrypted, key, file.dataSize + offset);
      await output.write(decoded, 0, decoded.length, offset);
      offset += size;
    }
  } finally {
    await output.close();
  }
}

export async function unpackDx6Archive(archivePath, outputDir) {
  const archive = await open(archivePath, "r");
  try {
    const details = await archive.stat();
    const encryptedHeader = await readAt(archive, 0, HEADER_SIZE, "Archive header");
    const detected = detectDx6Header(encryptedHeader, details.size);
    if (!detected) throw new Error("The archive is not a supported native DX version 6 archive.");
    const { header, key, mode } = detected;
    const encryptedTables = await readAt(
      archive,
      header.nameTableStart,
      header.headSize,
      "Archive tables",
    );
    const tables = xorBuffer(encryptedTables, key, 0);
    const nameTable = tables.subarray(0, header.fileTableStart);
    const fileTable = tables.subarray(header.fileTableStart, header.directoryTableStart);
    const directoryTable = tables.subarray(header.directoryTableStart);
    const visited = new Set();
    let files = 0;

    async function extractDirectory(directoryOffset, destination) {
      if (visited.has(directoryOffset)) throw new Error("The archive directory tree contains a cycle.");
      visited.add(directoryOffset);
      const directory = parseDirectory(directoryTable, directoryOffset);
      if (directory.fileCount > fileTable.length / FILE_HEADER_SIZE) {
        throw new Error("The archive directory has an invalid file count.");
      }
      await mkdir(destination, { recursive: true });
      for (let index = 0; index < directory.fileCount; index += 1) {
        const file = parseFileHeader(
          fileTable,
          directory.fileHeadAddress + index * FILE_HEADER_SIZE,
        );
        const name = safeName(decodeName(nameTable, file.nameAddress));
        const path = join(destination, name);
        if ((file.attributes & DIRECTORY_ATTRIBUTE) !== 0) {
          await extractDirectory(file.dataAddress, path);
        } else {
          await writeDecodedFile({
            archive,
            header,
            key,
            file,
            outputPath: path,
          });
          files += 1;
        }
      }
    }

    await extractDirectory(0, outputDir);
    return { files, mode };
  } finally {
    await archive.close();
  }
}

async function scanDirectory(path, name = "") {
  const directory = { path, name, entries: [], parent: undefined };
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    const details = await lstat(entryPath);
    if (details.isSymbolicLink()) throw new Error(`Symbolic links cannot be packed: ${entryPath}`);
    if (details.isDirectory()) {
      const child = await scanDirectory(entryPath, entry.name);
      child.parent = directory;
      directory.entries.push(child);
    } else if (details.isFile()) {
      directory.entries.push({ path: entryPath, name: entry.name, size: details.size, parent: directory });
    }
  }
  return directory;
}

function flattenDirectories(root) {
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

function flattenFiles(root) {
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

function createTables(root) {
  const directories = flattenDirectories(root);
  directories.forEach((directory, index) => {
    directory.directoryOffset = index * DIRECTORY_SIZE;
  });

  let nextFileHeader = FILE_HEADER_SIZE;
  for (const directory of directories) {
    directory.fileHeadAddress = nextFileHeader;
    directory.entries.forEach((entry, index) => {
      entry.fileHeaderOffset = nextFileHeader + index * FILE_HEADER_SIZE;
    });
    nextFileHeader += directory.entries.length * FILE_HEADER_SIZE;
  }

  const nameParts = [encodeName("")];
  let nameSize = nameParts[0].length;
  for (const directory of directories) {
    for (const entry of directory.entries) {
      entry.nameAddress = nameSize;
      const bytes = encodeName(entry.name);
      nameParts.push(bytes);
      nameSize += bytes.length;
    }
  }
  const nameTable = Buffer.concat(nameParts);
  const fileTable = Buffer.alloc(nextFileHeader);
  const directoryTable = Buffer.alloc(directories.length * DIRECTORY_SIZE);

  function writeFileHeader(target, entry) {
    writeU64(fileTable, entry.nameAddress, target);
    writeU64(fileTable, entry.entries ? DIRECTORY_ATTRIBUTE : FILE_ATTRIBUTE, target + 8);
    writeU64(fileTable, entry.entries ? entry.directoryOffset : entry.dataAddress, target + 40);
    writeU64(fileTable, entry.entries ? 0 : entry.size, target + 48);
    fileTable.writeBigUInt64LE(MAX_U64, target + 56);
  }

  writeFileHeader(0, {
    nameAddress: 0,
    entries: root.entries,
    directoryOffset: 0,
  });
  for (const directory of directories) {
    for (const entry of directory.entries) writeFileHeader(entry.fileHeaderOffset, entry);
    const offset = directory.directoryOffset;
    writeU64(
      directoryTable,
      directory === root ? 0 : directory.fileHeaderOffset,
      offset,
    );
    if (directory === root) directoryTable.writeBigUInt64LE(MAX_U64, offset + 8);
    else writeU64(directoryTable, directory.parent.directoryOffset, offset + 8);
    writeU64(directoryTable, directory.entries.length, offset + 16);
    writeU64(directoryTable, directory.fileHeadAddress, offset + 24);
  }
  return { nameTable, fileTable, directoryTable };
}

export async function packDx6Archive(sourceDir, archivePath, mode) {
  if (mode.archiveVersion !== 6) throw new Error(`Native packing is not available for ${mode.label}.`);
  const root = await scanDirectory(sourceDir);
  const files = flattenFiles(root);
  let dataSize = 0;
  for (const file of files) {
    file.dataAddress = dataSize;
    dataSize += align4(file.size);
  }
  const { nameTable, fileTable, directoryTable } = createTables(root);
  const tables = Buffer.concat([nameTable, fileTable, directoryTable]);
  const header = Buffer.alloc(HEADER_SIZE);
  header.write("DX", 0, "ascii");
  header.writeUInt16LE(6, 2);
  header.writeUInt32LE(tables.length, 4);
  writeU64(header, HEADER_SIZE, 8);
  writeU64(header, HEADER_SIZE + dataSize, 16);
  writeU64(header, nameTable.length, 24);
  writeU64(header, nameTable.length + fileTable.length, 32);
  writeU64(header, 932, 40);

  const key = createDx6Key(mode.key);
  const archive = await open(archivePath, "wx");
  try {
    const encryptedHeader = xorBuffer(header, key, 0);
    await archive.write(encryptedHeader, 0, encryptedHeader.length, 0);
    for (const file of files) {
      const input = await open(file.path, "r");
      try {
        let offset = 0;
        while (offset < file.size) {
          const size = Math.min(IO_SIZE, file.size - offset);
          const buffer = Buffer.alloc(size);
          const { bytesRead } = await input.read(buffer, 0, size, offset);
          if (bytesRead !== size) throw new Error(`File changed while it was packed: ${file.path}`);
          const encrypted = xorBuffer(buffer, key, file.size + offset);
          await archive.write(encrypted, 0, encrypted.length, HEADER_SIZE + file.dataAddress + offset);
          offset += size;
        }
        const padding = align4(file.size) - file.size;
        if (padding > 0) {
          const encrypted = xorBuffer(Buffer.alloc(padding), key, file.size + file.size);
          await archive.write(
            encrypted,
            0,
            encrypted.length,
            HEADER_SIZE + file.dataAddress + file.size,
          );
        }
      } finally {
        await input.close();
      }
    }
    const encryptedTables = xorBuffer(tables, key, 0);
    await archive.write(encryptedTables, 0, encryptedTables.length, HEADER_SIZE + dataSize);
  } finally {
    await archive.close();
  }
  return { files: files.length, bytes: HEADER_SIZE + dataSize + tables.length, mode };
}
