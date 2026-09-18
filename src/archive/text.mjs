const decoder = new TextDecoder("shift_jis", { fatal: false });
let reverseMap;

function addMapping(map, bytes) {
  const text = decoder.decode(Buffer.from(bytes));
  if (text && !text.includes("\ufffd") && !map.has(text)) map.set(text, Buffer.from(bytes));
}

function shiftJisMap() {
  if (reverseMap) return reverseMap;
  const map = new Map();
  for (let byte = 0; byte <= 0xff; byte += 1) addMapping(map, [byte]);
  const leads = [
    ...Array.from({ length: 0x9f - 0x81 + 1 }, (_, index) => 0x81 + index),
    ...Array.from({ length: 0xfc - 0xe0 + 1 }, (_, index) => 0xe0 + index),
  ];
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail += 1) {
      if (trail !== 0x7f) addMapping(map, [lead, trail]);
    }
  }
  reverseMap = map;
  return map;
}

export function encodeShiftJis(value) {
  const map = shiftJisMap();
  const chunks = [];
  for (const character of value) {
    const bytes = map.get(character);
    if (!bytes) throw new Error(`The file name cannot be encoded as Shift JIS: ${value}`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function decodeShiftJis(bytes) {
  return decoder.decode(bytes);
}

export function encodeName(value) {
  const original = encodeShiftJis(value);
  const terminatedLength = original.length + 1;
  const packs = Math.ceil(terminatedLength / 4);
  const output = Buffer.alloc(4 + packs * 8);
  output.writeUInt16LE(packs, 0);

  let parity = 0;
  for (let index = 0; index < original.length; index += 1) {
    let byte = original[index];
    if (byte >= 0x61 && byte <= 0x7a) byte -= 0x20;
    output[4 + index] = byte;
    parity = (parity + byte) & 0xffff;
  }
  output.writeUInt16LE(parity, 2);
  original.copy(output, 4 + packs * 4);
  return output;
}

export function decodeName(nameTable, address) {
  if (address < 0 || address + 4 > nameTable.length) throw new Error("Invalid name address.");
  const packs = nameTable.readUInt16LE(address);
  const start = address + 4 + packs * 4;
  const limit = Math.min(start + packs * 4, nameTable.length);
  let end = start;
  while (end < limit && nameTable[end] !== 0) end += 1;
  if (end === limit && packs !== 0) throw new Error("Archive file name is not terminated.");
  return decodeShiftJis(nameTable.subarray(start, end));
}
