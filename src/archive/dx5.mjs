import { mkdir, open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { PACK_MODES } from "../constants.mjs";
import {
  align4,
  ensureSlice,
  xorBuffer,
  MAX_U32,
  readOptionalU32,
} from "./binary.mjs";
import {
  DIRECTORY_ATTRIBUTE,
  FILE_ATTRIBUTE,
  IO_SIZE,
  flattenDirectories,
  flattenFiles,
  readAt,
  safeName,
  scanDirectory,
} from "./common.mjs";
import { createLegacyDxKey } from "./crypt-common.mjs";
import { decodeLz } from "./lz.mjs";
import { decodeName, encodeName } from "./text.mjs";

const HEADER_SIZE = 28;
const FILE_HEADER_SIZE = 44;
const DIRECTORY_SIZE = 16;

function nativeModes() {
  return PACK_MODES.filter((mode) => mode.archiveVersion === 5);
}

export function createDx5Key(source) {
  return createLegacyDxKey(source, 5);
}

function parseHeader(buffer, archiveBytes) {
  if (buffer.length !== HEADER_SIZE)
    throw new Error("Invalid DX version 5 header size.");
  if (buffer.toString("ascii", 0, 2) !== "DX" || buffer.readUInt16LE(2) !== 5) {
    throw new Error("Not a DX version 5 archive.");
  }
  const header = {
    headSize: buffer.readUInt32LE(4),
    dataStart: buffer.readUInt32LE(8),
    nameTableStart: buffer.readUInt32LE(12),
    fileTableStart: buffer.readUInt32LE(16),
    directoryTableStart: buffer.readUInt32LE(20),
    codePage: buffer.readUInt32LE(24),
  };
  if (header.dataStart !== HEADER_SIZE)
    throw new Error("Unsupported DX5 data start address.");
  if (
    header.nameTableStart < HEADER_SIZE ||
    header.nameTableStart + header.headSize > archiveBytes
  ) {
    throw new Error("The DX5 header table is outside the archive.");
  }
  if (
    header.fileTableStart < 4 ||
    header.fileTableStart > header.directoryTableStart ||
    header.directoryTableStart > header.headSize
  ) {
    throw new Error("The DX5 table addresses are invalid.");
  }
  return header;
}

export function detectDx5Header(
  encryptedHeader,
  archiveBytes = Number.MAX_SAFE_INTEGER,
) {
  for (const mode of nativeModes()) {
    const key = createDx5Key(mode.key);
    const headerBytes = xorBuffer(encryptedHeader, key, 0);
    try {
      return { mode, key, header: parseHeader(headerBytes, archiveBytes) };
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseFileHeader(fileTable, offset) {
  const bytes = ensureSlice(
    fileTable,
    offset,
    FILE_HEADER_SIZE,
    "DX5 file header",
  );
  return {
    nameAddress: bytes.readUInt32LE(0),
    attributes: bytes.readUInt32LE(4),
    dataAddress: bytes.readUInt32LE(32),
    dataSize: bytes.readUInt32LE(36),
    pressDataSize: readOptionalU32(bytes, 40),
  };
}

function parseDirectory(directoryTable, offset) {
  const bytes = ensureSlice(
    directoryTable,
    offset,
    DIRECTORY_SIZE,
    "DX5 directory header",
  );
  return {
    directoryAddress: readOptionalU32(bytes, 0),
    parentDirectoryAddress: readOptionalU32(bytes, 4),
    fileCount: bytes.readUInt32LE(8),
    fileHeadAddress: bytes.readUInt32LE(12),
  };
}

async function writeDecodedFile({ archive, header, key, file, outputPath }) {
  const dataPosition = header.dataStart + file.dataAddress;
  const storedSize = file.pressDataSize ?? file.dataSize;
  if (
    dataPosition < header.dataStart ||
    dataPosition + storedSize > header.nameTableStart
  ) {
    throw new Error(
      `File data is outside the DX5 archive: ${basename(outputPath)}`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const output = await open(outputPath, "wx");
  try {
    if (file.dataSize === 0) return;
    if (file.pressDataSize !== undefined) {
      const encrypted = await readAt(
        archive,
        dataPosition,
        file.pressDataSize,
        "Compressed file data",
      );
      const compressed = xorBuffer(encrypted, key, file.dataSize);
      const decoded = decodeLz(compressed, file.dataSize);
      await output.write(decoded, 0, decoded.length, 0);
      return;
    }
    let offset = 0;
    while (offset < file.dataSize) {
      const size = Math.min(IO_SIZE, file.dataSize - offset);
      const encrypted = await readAt(
        archive,
        dataPosition + offset,
        size,
        "File data",
      );
      const decoded = xorBuffer(encrypted, key, file.dataSize + offset);
      await output.write(decoded, 0, decoded.length, offset);
      offset += size;
    }
  } finally {
    await output.close();
  }
}

export async function unpackDx5Archive(
  archivePath,
  outputDir,
  { includeFile } = {},
) {
  const archive = await open(archivePath, "r");
  try {
    const details = await archive.stat();
    const encryptedHeader = await readAt(
      archive,
      0,
      HEADER_SIZE,
      "Archive header",
    );
    const detected = detectDx5Header(encryptedHeader, details.size);
    if (!detected)
      throw new Error(
        "The archive is not a supported native DX version 5 archive.",
      );
    const { header, key, mode } = detected;
    const encryptedTables = await readAt(
      archive,
      header.nameTableStart,
      header.headSize,
      "Archive tables",
    );
    const tables = xorBuffer(encryptedTables, key, 0);
    const nameTable = tables.subarray(0, header.fileTableStart);
    const fileTable = tables.subarray(
      header.fileTableStart,
      header.directoryTableStart,
    );
    const directoryTable = tables.subarray(header.directoryTableStart);
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
        const name = safeName(
          decodeName(nameTable, file.nameAddress, header.codePage),
        );
        const path = join(destination, name);
        if ((file.attributes & DIRECTORY_ATTRIBUTE) !== 0) {
          await extractDirectory(file.dataAddress, path);
        } else if (!includeFile || includeFile(name)) {
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
    return { files, archiveVersion: 5, mode };
  } finally {
    await archive.close();
  }
}

function writeU32(target, value, offset, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) {
    throw new Error(`${label} exceeds the DX5 32-bit limit.`);
  }
  target.writeUInt32LE(value, offset);
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
    writeU32(fileTable, entry.nameAddress, target, "Name address");
    writeU32(
      fileTable,
      entry.entries ? DIRECTORY_ATTRIBUTE : FILE_ATTRIBUTE,
      target + 4,
      "Attributes",
    );
    writeU32(
      fileTable,
      entry.entries ? entry.directoryOffset : entry.dataAddress,
      target + 32,
      "Data address",
    );
    writeU32(
      fileTable,
      entry.entries ? 0 : entry.size,
      target + 36,
      "File size",
    );
    fileTable.writeUInt32LE(MAX_U32, target + 40);
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
    writeU32(
      directoryTable,
      directory === root ? 0 : directory.fileHeaderOffset,
      offset,
      "Directory address",
    );
    if (directory === root) directoryTable.writeUInt32LE(MAX_U32, offset + 4);
    else
      writeU32(
        directoryTable,
        directory.parent.directoryOffset,
        offset + 4,
        "Parent directory",
      );
    writeU32(
      directoryTable,
      directory.entries.length,
      offset + 8,
      "Directory file count",
    );
    writeU32(
      directoryTable,
      directory.fileHeadAddress,
      offset + 12,
      "File header address",
    );
  }
  return { nameTable, fileTable, directoryTable };
}

export async function packDx5Archive(sourceDir, archivePath, mode) {
  if (mode.archiveVersion !== 5)
    throw new Error(`DX5 packing is not available for ${mode.label}.`);
  const root = await scanDirectory(sourceDir, "", MAX_U32);
  const files = flattenFiles(root);
  let dataSize = 0;
  for (const file of files) {
    file.dataAddress = dataSize;
    dataSize += align4(file.size);
    if (dataSize > MAX_U32 - HEADER_SIZE)
      throw new Error("DX5 archives cannot exceed 4 GiB.");
  }
  const { nameTable, fileTable, directoryTable } = createTables(root);
  const tables = Buffer.concat([nameTable, fileTable, directoryTable]);
  const header = Buffer.alloc(HEADER_SIZE);
  header.write("DX", 0, "ascii");
  header.writeUInt16LE(5, 2);
  writeU32(header, tables.length, 4, "Table size");
  writeU32(header, HEADER_SIZE, 8, "Data start");
  writeU32(header, HEADER_SIZE + dataSize, 12, "Name table start");
  writeU32(header, nameTable.length, 16, "File table start");
  writeU32(
    header,
    nameTable.length + fileTable.length,
    20,
    "Directory table start",
  );
  writeU32(header, 932, 24, "Code page");

  const key = createDx5Key(mode.key);
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
          if (bytesRead !== size)
            throw new Error(`File changed while it was packed: ${file.path}`);
          const encrypted = xorBuffer(buffer, key, file.size + offset);
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
    const encryptedTables = xorBuffer(tables, key, 0);
    await archive.write(
      encryptedTables,
      0,
      encryptedTables.length,
      HEADER_SIZE + dataSize,
    );
  } finally {
    await archive.close();
  }
  return {
    files: files.length,
    bytes: HEADER_SIZE + dataSize + tables.length,
    mode,
  };
}
