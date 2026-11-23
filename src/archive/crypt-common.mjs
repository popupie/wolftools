export function createMsvcRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

export function rotateRight8(value, bits) {
  return ((value >>> bits) | (value << (8 - bits))) & 0xff;
}

export function createLegacyDxKey(source, version) {
  if (source.length !== 12)
    throw new Error(`A DX version ${version} key must contain 12 bytes.`);
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
