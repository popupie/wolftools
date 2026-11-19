const TRUE_TYPE = 0x00010000;
const OPEN_TYPE_CFF = 0x4f54544f; // OTTO
const COLLECTION = 0x74746366; // ttcf
const DIRECTORY_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

function tableDirectory(bytes, offset) {
  if (offset + DIRECTORY_HEADER_SIZE > bytes.length) return;
  const format = bytes.readUInt32BE(offset);
  if (format !== TRUE_TYPE && format !== OPEN_TYPE_CFF) return;
  const count = bytes.readUInt16BE(offset + 4);
  const end = offset + DIRECTORY_HEADER_SIZE + count * TABLE_RECORD_SIZE;
  if (end <= bytes.length) return bytes.subarray(offset, end);
}

export function* fontDirectories(bytes) {
  if (bytes.length < DIRECTORY_HEADER_SIZE) return;
  if (bytes.readUInt32BE(0) !== COLLECTION) {
    const directory = tableDirectory(bytes, 0);
    if (directory) yield { directory };
    return;
  }

  const version = bytes.readUInt32BE(4);
  if (version !== 0x00010000 && version !== 0x00020000) return;
  const count = bytes.readUInt32BE(8);
  const offsetsEnd = DIRECTORY_HEADER_SIZE + 4 * count;
  if (offsetsEnd + (version === 0x00020000 ? 12 : 0) > bytes.length) return;
  for (let index = DIRECTORY_HEADER_SIZE; index < offsetsEnd; index += 4) {
    const directory = tableDirectory(bytes, bytes.readUInt32BE(index));
    if (directory) {
      const standaloneExtension =
        directory.readUInt32BE(0) === OPEN_TYPE_CFF ? ".otf" : ".ttf";
      yield { directory, standaloneExtension };
    }
  }
}

export function fontNameTable(bytes, directory) {
  for (
    let entry = DIRECTORY_HEADER_SIZE;
    entry < directory.length;
    entry += TABLE_RECORD_SIZE
  ) {
    if (directory.toString("ascii", entry, entry + 4) !== "name") continue;
    const start = directory.readUInt32BE(entry + 8);
    const length = directory.readUInt32BE(entry + 12);
    if (length >= 6 && start + length <= bytes.length)
      return bytes.subarray(start, start + length);
    return;
  }
}

function checksum(bytes) {
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4)
    sum = (sum + bytes.readUInt32BE(offset)) >>> 0;
  return sum;
}

export function extractFontFace(collection, directory) {
  const tables = [];
  let tableBytes = 0;
  for (
    let entry = DIRECTORY_HEADER_SIZE;
    entry < directory.length;
    entry += TABLE_RECORD_SIZE
  ) {
    const tag = directory.toString("latin1", entry, entry + 4);
    // The original signature no longer applies to the standalone font.
    if (tag === "DSIG") continue;
    const start = directory.readUInt32BE(entry + 8);
    const length = directory.readUInt32BE(entry + 12);
    if (start + length > collection.length) return;
    const paddedLength = Math.ceil(length / 4) * 4;
    tables.push({ entry, tag, start, length, paddedLength });
    tableBytes += paddedLength;
  }

  const head = tables.find((table) => table.tag === "head");
  if (!head || head.length < 12 || tables.length >= 4096) return;
  const directorySize =
    DIRECTORY_HEADER_SIZE + TABLE_RECORD_SIZE * tables.length;
  const size = directorySize + tableBytes;
  if (size > collection.length) return;

  const font = Buffer.alloc(size);
  directory.copy(font, 0, 0, 4);
  const searchPower = Math.floor(Math.log2(tables.length));
  const searchRange = TABLE_RECORD_SIZE * 2 ** searchPower;
  font.writeUInt16BE(tables.length, 4);
  font.writeUInt16BE(searchRange, 6);
  font.writeUInt16BE(searchPower, 8);
  font.writeUInt16BE(TABLE_RECORD_SIZE * tables.length - searchRange, 10);

  let offset = directorySize;
  let headOffset;
  for (const [index, table] of tables.entries()) {
    const entry = DIRECTORY_HEADER_SIZE + index * TABLE_RECORD_SIZE;
    directory.copy(font, entry, table.entry, table.entry + TABLE_RECORD_SIZE);
    font.writeUInt32BE(offset, entry + 8);
    collection.copy(font, offset, table.start, table.start + table.length);
    if (table === head) {
      headOffset = offset;
      font.writeUInt32BE(0, offset + 8);
      font.writeUInt32BE(
        checksum(font.subarray(offset, offset + table.paddedLength)),
        entry + 4,
      );
    }
    offset += table.paddedLength;
  }
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}
