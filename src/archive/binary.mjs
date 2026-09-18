const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function readU64(buffer, offset) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > MAX_SAFE_BIGINT) {
    throw new Error(`Archive value is too large at byte ${offset}.`);
  }
  return Number(value);
}

export function writeU64(buffer, value, offset) {
  buffer.writeBigUInt64LE(BigInt(value), offset);
}

export function align4(value) {
  return Math.ceil(value / 4) * 4;
}

export function xorBuffer(buffer, key, position = 0) {
  const output = Buffer.from(buffer);
  for (let index = 0; index < output.length; index += 1) {
    output[index] ^= key[(position + index) % key.length];
  }
  return output;
}

export function ensureSlice(buffer, offset, size, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0) {
    throw new Error(`Invalid ${label} range.`);
  }
  if (offset + size > buffer.length) throw new Error(`${label} is outside the archive.`);
  return buffer.subarray(offset, offset + size);
}
