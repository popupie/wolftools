import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { DX8_MODES } from "../constants.mjs";
import { align4, ensureSlice, readU64, writeU64 } from "./binary.mjs";
import { decodeHuffman, inspectHuffman } from "./huffman.mjs";
import { decodeLz } from "./lz.mjs";
import { decodeName, encodeName } from "./text.mjs";
import {
  createModernCryptContext,
  cryptModernHeader,
  isModernCryptVersion,
  xorChaCha20,
  xorModernOuter,
  xorWolfCrypt,
} from "./wolf-crypt.mjs";

const HEADER_SIZE = 64;
const FILE_HEADER_SIZE = 72;
const DIRECTORY_SIZE = 32;
const DIRECTORY_ATTRIBUTE = 0x10;
const FILE_ATTRIBUTE = 0x20;
const NO_KEY = 0x00000001;
const NO_HEAD_PRESS = 0x00000002;
const MAX_U64 = 0xffffffffffffffffn;
const IO_SIZE = 1024 * 1024;
const DEFAULT_KEY_STRING = Buffer.from("DXLIBARC", "latin1");
const MAX_KEY_STRING = 63;
const MAX_FILE_KEY_STRING = 2040;

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

async function readAt(handle, position, size, label) {
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

function crc32(source) {
  let crc = 0xffffffff;
  for (const byte of source)
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createDx8Key(value) {
  let source = Buffer.from(value);
  if (source.length < 4) source = Buffer.concat([source, DEFAULT_KEY_STRING]);
  const even = Buffer.alloc(Math.ceil(source.length / 2));
  const odd = Buffer.alloc(Math.floor(source.length / 2));
  for (let index = 0; index < source.length; index += 1) {
    (index % 2 === 0 ? even : odd)[index >>> 1] = source[index];
  }
  const evenCrc = crc32(even);
  const oddCrc = crc32(odd);
  const key = Buffer.alloc(7);
  key.writeUInt32LE(evenCrc, 0);
  key[4] = oddCrc & 0xff;
  key[5] = (oddCrc >>> 8) & 0xff;
  key[6] = (oddCrc >>> 16) & 0xff;
  return key;
}

function xorDx8(source, key, position = 0) {
  const output = Buffer.from(source);
  if (!key) return output;
  for (let index = 0; index < output.length; index += 1) {
    output[index] ^= key[(position + index) % key.length];
  }
  return output;
}

function parseHeader(buffer, archiveBytes) {
  if (buffer.toString("ascii", 0, 2) !== "DX" || buffer.readUInt16LE(2) !== 8) {
    throw new Error("Not a DX version 8 archive.");
  }
  const rawFlags = buffer.readUInt32LE(44);
  const cryptVersion = rawFlags >>> 16;
  const decoded = isModernCryptVersion(cryptVersion)
    ? cryptModernHeader(buffer, cryptVersion)
    : buffer;
  const header = {
    headSize: decoded.readUInt32LE(4),
    dataStart: readU64(decoded, 8),
    nameTableStart: readU64(decoded, 16),
    fileTableStart: readU64(decoded, 24),
    directoryTableStart: readU64(decoded, 32),
    codePage: decoded.readUInt32LE(40),
    flags: rawFlags,
    cryptVersion,
    huffmanEncodeKB: decoded[48],
    reserve: Buffer.from(decoded.subarray(49, 64)),
  };
  if (header.dataStart !== HEADER_SIZE)
    throw new Error("Unsupported DX data start address.");
  if (
    header.nameTableStart < HEADER_SIZE ||
    header.nameTableStart > archiveBytes ||
    ((header.flags & NO_HEAD_PRESS) !== 0 &&
      header.nameTableStart + header.headSize > archiveBytes) ||
    header.fileTableStart < 4 ||
    header.fileTableStart > header.directoryTableStart ||
    header.directoryTableStart > header.headSize
  ) {
    throw new Error("The DX version 8 header addresses are invalid.");
  }
  return header;
}

function createCipher(mode, key) {
  if (!mode) return undefined;
  if (mode.algorithm === "dx8") return { algorithm: "dx8", key };
  if (mode.algorithm === "chacha20") {
    return { algorithm: "chacha20", key: mode.key, nonce: mode.nonce };
  }
  if (mode.algorithm === "wolf") {
    return { algorithm: "wolf", key, cryptVersion: mode.cryptVersion };
  }
  throw new Error(`Unknown DX8 encryption algorithm: ${mode.algorithm}`);
}

function xorCipher(source, cipher, position = 0) {
  if (!cipher) return Buffer.from(source);
  if (cipher.algorithm === "dx8") return xorDx8(source, cipher.key, position);
  if (cipher.algorithm === "chacha20") {
    return xorChaCha20(source, cipher.key, cipher.nonce, position);
  }
  if (cipher.algorithm === "wolf") {
    return xorWolfCrypt(source, cipher.key, position, cipher.cryptVersion);
  }
  throw new Error(`Unknown DX8 encryption algorithm: ${cipher.algorithm}`);
}

async function readArchiveAt(archive, position, size, label, modern) {
  const source = await readAt(archive, position, size, label);
  return modern ? xorModernOuter(source, modern, position) : source;
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
    huffPressDataSize: readOptionalU64(bytes, 64),
  };
}

function parseDirectory(directoryTable, offset) {
  const bytes = ensureSlice(
    directoryTable,
    offset,
    DIRECTORY_SIZE,
    "directory header",
  );
  return {
    directoryAddress: readOptionalU64(bytes, 0),
    parentDirectoryAddress: readOptionalU64(bytes, 8),
    fileCount: readU64(bytes, 16),
    fileHeadAddress: readU64(bytes, 24),
  };
}

function safeName(name) {
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

function normalizedNameBytes(nameTable, address) {
  if (address < 0 || address + 4 > nameTable.length)
    throw new Error("Invalid name address.");
  const packs = nameTable.readUInt16LE(address);
  const start = address + 4;
  const limit = Math.min(start + packs * 4, nameTable.length);
  let end = start;
  while (end < limit && nameTable[end] !== 0) end += 1;
  if (end === limit && packs !== 0)
    throw new Error("Archive key name is not terminated.");
  return nameTable.subarray(start, end);
}

function validateTables(tables, header) {
  if (tables.length !== header.headSize)
    throw new Error("The DX table size is invalid.");
  const nameTable = tables.subarray(0, header.fileTableStart);
  const fileTable = tables.subarray(
    header.fileTableStart,
    header.directoryTableStart,
  );
  const directoryTable = tables.subarray(header.directoryTableStart);
  const root = parseDirectory(directoryTable, 0);
  if (root.parentDirectoryAddress !== undefined)
    throw new Error("The DX root directory is invalid.");
  if (root.fileCount > fileTable.length / FILE_HEADER_SIZE) {
    throw new Error("The DX root file count is invalid.");
  }
  for (let index = 0; index < root.fileCount; index += 1) {
    const file = parseFileHeader(
      fileTable,
      root.fileHeadAddress + index * FILE_HEADER_SIZE,
    );
    decodeName(nameTable, file.nameAddress);
  }
  return { nameTable, fileTable, directoryTable };
}

async function loadTables(archive, header, archiveBytes, additionalModes = []) {
  const noKey = (header.flags & NO_KEY) !== 0;
  const noHeadPress = (header.flags & NO_HEAD_PRESS) !== 0;
  const storedSize = noHeadPress
    ? header.headSize
    : archiveBytes - header.nameTableStart;
  if (!Number.isSafeInteger(storedSize) || storedSize <= 0) {
    throw new Error("The DX archive table storage size is invalid.");
  }
  const availableModes = [...additionalModes, ...DX8_MODES].map((mode) =>
    mode.dynamic ? { ...mode, cryptVersion: header.cryptVersion } : mode,
  );
  const matchingModes =
    header.cryptVersion === 0
      ? availableModes.filter((mode) => mode.cryptVersion === 0)
      : availableModes.filter(
          (mode) => mode.cryptVersion === header.cryptVersion,
        );
  const candidates = noKey
    ? [{ name: "clear", label: "Clear DX8", algorithm: "clear" }]
    : matchingModes;
  if (candidates.length === 0) {
    throw new Error(
      `WOLF crypt version ${header.cryptVersion} requires a game-specific or unsupported key.`,
    );
  }

  for (const mode of candidates) {
    try {
      const modern =
        mode.algorithm === "wolf"
          ? createModernCryptContext(header, mode, archiveBytes)
          : undefined;
      const stored = await readArchiveAt(
        archive,
        header.nameTableStart,
        storedSize,
        "Archive tables",
        modern,
      );
      const archiveKey =
        mode.algorithm === "dx8"
          ? createDx8Key(mode.key.subarray(0, MAX_KEY_STRING))
          : modern?.innerKey;
      const cipher =
        mode.algorithm === "clear" ? undefined : createCipher(mode, archiveKey);
      const decrypted = xorCipher(stored, cipher, 0);
      let tables;
      if (noHeadPress) {
        tables = decrypted;
      } else {
        const huffman = inspectHuffman(decrypted);
        if (
          huffman.originalSize < 9 ||
          huffman.originalSize > header.headSize * 2 + 1024
        ) {
          throw new Error("The compressed DX table size is invalid.");
        }
        tables = decodeLz(
          decodeHuffman(decrypted, huffman.originalSize),
          header.headSize,
        );
      }
      return {
        ...validateTables(tables, header),
        cipher,
        mode,
        modern,
        keyString: mode.algorithm === "dx8" ? mode.key : undefined,
      };
    } catch {
      continue;
    }
  }
  throw new Error(
    "The DX version 8 archive key or table format is not supported.",
  );
}

function createFileKey({
  keyString,
  directory,
  file,
  nameTable,
  fileTable,
  directoryTable,
}) {
  if (!keyString) return undefined;
  const parts = [keyString, normalizedNameBytes(nameTable, file.nameAddress)];
  let current = directory;
  while (current.parentDirectoryAddress !== undefined) {
    if (current.directoryAddress === undefined)
      throw new Error("The DX directory key path is invalid.");
    const directoryFile = parseFileHeader(fileTable, current.directoryAddress);
    parts.push(normalizedNameBytes(nameTable, directoryFile.nameAddress));
    current = parseDirectory(directoryTable, current.parentDirectoryAddress);
  }
  return createDx8Key(Buffer.concat(parts).subarray(0, MAX_FILE_KEY_STRING));
}

function storedFileSize(file, header) {
  const baseSize = file.pressDataSize ?? file.dataSize;
  if (file.huffPressDataSize === undefined) return baseSize;
  const edgeSize = header.huffmanEncodeKB * 1024;
  if (header.huffmanEncodeKB !== 0xff && baseSize > edgeSize * 2) {
    return file.huffPressDataSize + baseSize - edgeSize * 2;
  }
  return file.huffPressDataSize;
}

async function readDecodedFile({
  archive,
  header,
  file,
  cipher,
  dataPosition,
  modern,
}) {
  const baseSize = file.pressDataSize ?? file.dataSize;
  let base;
  if (file.huffPressDataSize !== undefined) {
    const encryptedHuffman = await readArchiveAt(
      archive,
      dataPosition,
      file.huffPressDataSize,
      "Huffman file data",
      modern,
    );
    const huffman = xorCipher(encryptedHuffman, cipher, file.dataSize);
    const edgeSize = header.huffmanEncodeKB * 1024;
    const partial = header.huffmanEncodeKB !== 0xff && baseSize > edgeSize * 2;
    if (partial) {
      const edges = decodeHuffman(huffman, edgeSize * 2);
      const middleSize = baseSize - edgeSize * 2;
      const encryptedMiddle = await readArchiveAt(
        archive,
        dataPosition + file.huffPressDataSize,
        middleSize,
        "Partially compressed file data",
        modern,
      );
      const middle = xorCipher(
        encryptedMiddle,
        cipher,
        file.dataSize + file.huffPressDataSize,
      );
      base = Buffer.alloc(baseSize);
      edges.copy(base, 0, 0, edgeSize);
      middle.copy(base, edgeSize);
      edges.copy(base, edgeSize + middleSize, edgeSize);
    } else {
      base = decodeHuffman(huffman, baseSize);
    }
  } else {
    const encrypted = await readArchiveAt(
      archive,
      dataPosition,
      baseSize,
      "Compressed file data",
      modern,
    );
    base = xorCipher(encrypted, cipher, file.dataSize);
  }
  return file.pressDataSize === undefined
    ? base
    : decodeLz(base, file.dataSize);
}

async function writeDecodedFile({
  archive,
  header,
  file,
  cipher,
  modern,
  outputPath,
}) {
  const dataPosition = header.dataStart + file.dataAddress;
  const storedSize = storedFileSize(file, header);
  if (
    dataPosition < header.dataStart ||
    dataPosition + storedSize > header.nameTableStart
  ) {
    throw new Error(
      `File data is outside the archive: ${basename(outputPath)}`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const output = await open(outputPath, "wx");
  try {
    if (file.dataSize === 0) return;
    if (
      file.pressDataSize !== undefined ||
      file.huffPressDataSize !== undefined
    ) {
      const decoded = await readDecodedFile({
        archive,
        header,
        file,
        cipher,
        dataPosition,
        modern,
      });
      await output.write(decoded, 0, decoded.length, 0);
      return;
    }
    let offset = 0;
    while (offset < file.dataSize) {
      const size = Math.min(IO_SIZE, file.dataSize - offset);
      const encrypted = await readArchiveAt(
        archive,
        dataPosition + offset,
        size,
        "File data",
        modern,
      );
      const bytes = xorCipher(encrypted, cipher, file.dataSize + offset);
      await output.write(bytes, 0, bytes.length, offset);
      offset += size;
    }
  } finally {
    await output.close();
  }
}

export async function inspectDx8Archive(archivePath, options = {}) {
  const archive = await open(archivePath, "r");
  try {
    const details = await archive.stat();
    const header = parseHeader(
      await readAt(archive, 0, HEADER_SIZE, "Archive header"),
      details.size,
    );
    const tables = await loadTables(
      archive,
      header,
      details.size,
      options.modes,
    );
    return {
      archiveVersion: 8,
      encrypted: (header.flags & NO_KEY) === 0,
      compressedTables: (header.flags & NO_HEAD_PRESS) === 0,
      mode: tables.mode,
    };
  } finally {
    await archive.close();
  }
}

export async function unpackDx8Archive(archivePath, outputDir, options = {}) {
  const archive = await open(archivePath, "r");
  try {
    const details = await archive.stat();
    const header = parseHeader(
      await readAt(archive, 0, HEADER_SIZE, "Archive header"),
      details.size,
    );
    const {
      nameTable,
      fileTable,
      directoryTable,
      mode,
      keyString,
      cipher,
      modern,
    } = await loadTables(archive, header, details.size, options.modes);
    const visited = new Set();
    let files = 0;

    async function extractDirectory(directoryOffset, destination) {
      if (visited.has(directoryOffset))
        throw new Error("The archive directory tree contains a cycle.");
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
        } else if (!options.includeFile || options.includeFile(name)) {
          const fileCipher = keyString
            ? createCipher(
                mode,
                createFileKey({
                  keyString,
                  directory,
                  file,
                  nameTable,
                  fileTable,
                  directoryTable,
                }),
              )
            : cipher;
          await writeDecodedFile({
            archive,
            header,
            file,
            cipher: fileCipher,
            modern,
            outputPath: path,
          });
          files += 1;
        }
      }
    }

    await extractDirectory(0, outputDir);
    return {
      files,
      archiveVersion: 8,
      encrypted: (header.flags & NO_KEY) === 0,
      mode,
    };
  } finally {
    await archive.close();
  }
}

export const unpackDx8NoKeyArchive = unpackDx8Archive;

async function scanDirectory(path, name = "") {
  const directory = { path, name, entries: [], parent: undefined };
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    const details = await lstat(entryPath);
    if (details.isSymbolicLink())
      throw new Error(`Symbolic links cannot be packed: ${entryPath}`);
    if (details.isDirectory()) {
      const child = await scanDirectory(entryPath, entry.name);
      child.parent = directory;
      directory.entries.push(child);
    } else if (details.isFile()) {
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
    writeU64(
      fileTable,
      entry.entries ? DIRECTORY_ATTRIBUTE : FILE_ATTRIBUTE,
      target + 8,
    );
    writeU64(
      fileTable,
      entry.entries ? entry.directoryOffset : entry.dataAddress,
      target + 40,
    );
    writeU64(fileTable, entry.entries ? 0 : entry.size, target + 48);
    fileTable.writeBigUInt64LE(MAX_U64, target + 56);
    fileTable.writeBigUInt64LE(MAX_U64, target + 64);
  }

  writeFileHeader(0, {
    nameAddress: 0,
    entries: root.entries,
    directoryOffset: 0,
  });
  for (const directory of directories) {
    for (const entry of directory.entries)
      writeFileHeader(entry.fileHeaderOffset, entry);
    const offset = directory.directoryOffset;
    writeU64(
      directoryTable,
      directory === root ? 0 : directory.fileHeaderOffset,
      offset,
    );
    if (directory === root)
      directoryTable.writeBigUInt64LE(MAX_U64, offset + 8);
    else writeU64(directoryTable, directory.parent.directoryOffset, offset + 8);
    writeU64(directoryTable, directory.entries.length, offset + 16);
    writeU64(directoryTable, directory.fileHeadAddress, offset + 24);
  }
  return { nameTable, fileTable, directoryTable };
}

function entryKey(mode, file) {
  const parts = [mode.key, normalizedNameBytes(encodeName(file.name), 0)];
  let directory = file.parent;
  while (directory?.parent) {
    parts.push(normalizedNameBytes(encodeName(directory.name), 0));
    directory = directory.parent;
  }
  return createDx8Key(Buffer.concat(parts).subarray(0, MAX_FILE_KEY_STRING));
}

function archiveCipher(mode, modern) {
  if (!mode) return undefined;
  if (mode.algorithm === "dx8") {
    return createCipher(
      mode,
      createDx8Key(mode.key.subarray(0, MAX_KEY_STRING)),
    );
  }
  if (mode.algorithm === "wolf") return createCipher(mode, modern.innerKey);
  return createCipher(mode);
}

async function applyModernOuterCrypt(archivePath, headerBytes, modern) {
  const archive = await open(archivePath, "r+");
  try {
    let position = HEADER_SIZE;
    while (position < modern.archiveSize) {
      const size = Math.min(IO_SIZE, modern.archiveSize - position);
      const source = await readAt(archive, position, size, "Archive data");
      const encrypted = xorModernOuter(source, modern, position);
      await archive.write(encrypted, 0, encrypted.length, position);
      position += size;
    }
    const encryptedHeader = cryptModernHeader(headerBytes, modern.cryptVersion);
    await archive.write(encryptedHeader, 0, encryptedHeader.length, 0);
  } finally {
    await archive.close();
  }
}

export async function packDx8Archive(sourceDir, archivePath, mode) {
  if (mode && mode.archiveVersion !== 8) {
    throw new Error(`DX8 packing is not available for ${mode.label}.`);
  }
  const root = await scanDirectory(sourceDir);
  const files = flattenFiles(root);
  let dataSize = 0;
  for (const file of files) {
    file.dataAddress = dataSize;
    dataSize += align4(file.size);
  }

  const { nameTable, fileTable, directoryTable } = createTables(root);
  const tables = Buffer.concat([nameTable, fileTable, directoryTable]);
  if (mode?.algorithm === "wolf" && dataSize + tables.length < 0x400) {
    dataSize = 0x400 - tables.length;
  }
  const header = Buffer.alloc(HEADER_SIZE);
  header.write("DX", 0, "ascii");
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(tables.length, 4);
  writeU64(header, HEADER_SIZE, 8);
  writeU64(header, HEADER_SIZE + dataSize, 16);
  writeU64(header, nameTable.length, 24);
  writeU64(header, nameTable.length + fileTable.length, 32);
  header.writeUInt32LE(932, 40);
  const cryptVersion = mode?.cryptVersion || 0;
  header.writeUInt32LE(
    (cryptVersion << 16) | NO_HEAD_PRESS | (mode ? 0 : NO_KEY),
    44,
  );
  header[48] = 0;

  const archiveBytes = HEADER_SIZE + dataSize + tables.length;
  const parsedHeader = {
    reserve: header.subarray(49, 64),
    cryptVersion,
    nameTableStart: HEADER_SIZE + dataSize,
  };
  const modern =
    mode?.algorithm === "wolf"
      ? createModernCryptContext(parsedHeader, mode, archiveBytes)
      : undefined;
  const tableCipher = archiveCipher(mode, modern);

  const archive = await open(archivePath, "wx");
  try {
    await archive.write(header, 0, header.length, 0);
    for (const file of files) {
      const input = await open(file.path, "r");
      try {
        let offset = 0;
        while (offset < file.size) {
          const size = Math.min(IO_SIZE, file.size - offset);
          const bytes = Buffer.alloc(size);
          const { bytesRead } = await input.read(bytes, 0, size, offset);
          if (bytesRead !== size)
            throw new Error(`File changed while it was packed: ${file.path}`);
          const fileCipher =
            mode?.algorithm === "dx8"
              ? createCipher(mode, entryKey(mode, file))
              : tableCipher;
          const encrypted = xorCipher(bytes, fileCipher, file.size + offset);
          await archive.write(
            encrypted,
            0,
            encrypted.length,
            HEADER_SIZE + file.dataAddress + offset,
          );
          offset += size;
        }
        const padding = align4(file.size) - file.size;
        if (padding > 0) {
          await archive.write(
            Buffer.alloc(padding),
            0,
            padding,
            HEADER_SIZE + file.dataAddress + file.size,
          );
        }
      } finally {
        await input.close();
      }
    }
    const encryptedTables = xorCipher(tables, tableCipher, 0);
    await archive.write(
      encryptedTables,
      0,
      encryptedTables.length,
      HEADER_SIZE + dataSize,
    );
  } finally {
    await archive.close();
  }

  if (modern) await applyModernOuterCrypt(archivePath, header, modern);

  return {
    files: files.length,
    bytes: archiveBytes,
    archiveVersion: 8,
    mode,
  };
}

export async function packDx8NoKeyArchive(sourceDir, archivePath) {
  return packDx8Archive(sourceDir, archivePath);
}
