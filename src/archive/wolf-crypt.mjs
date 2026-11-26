import { createMsvcRandom, rotateRight8 } from "./crypt-common.mjs";

/*
 * WOLF RPG Editor's DX8 extensions use modified AES-CTR, a generated stream
 * cipher, and (for one format) ChaCha20. This is a JavaScript port of the
 * format behavior documented by UberWolf's MIT-licensed implementation.
 */

const SBOX = Uint8Array.from([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe,
  0xd7, 0xab, 0x76, 0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4,
  0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7,
  0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3,
  0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09,
  0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3,
  0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe,
  0x39, 0x4a, 0x4c, 0x58, 0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85,
  0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92,
  0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c,
  0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19,
  0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14,
  0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2,
  0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5,
  0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08, 0xba, 0x78, 0x25,
  0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86,
  0xc1, 0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e,
  0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42,
  0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const RCON = Uint8Array.from([
  0x8d, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36,
]);

function isVersion35(cryptVersion) {
  return (
    (cryptVersion >= 0x015e && cryptVersion < 0x03e8) || cryptVersion >= 0x03fc
  );
}

function saltBytes(value) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1");
  if (source.length === 0)
    throw new Error("A modern WOLF archive key cannot be empty.");
  return Uint8Array.from(
    { length: 128 },
    (_, index) =>
      (Math.floor(index / source.length) + source[index % source.length]) &
      0xff,
  );
}

export function createWolfCryptKey(cryptVersion, password, options = {}) {
  const pw = Buffer.from(password);
  if (pw.length < 15)
    throw new Error("A modern WOLF archive password needs 15 bytes.");
  const other = Boolean(options.other);
  const key = new Uint8Array(768);
  const factors = new Uint8Array(3);
  const s0 = pw[2];
  const s1 = pw[5];
  const s2 = pw[12];
  let s3 = 0;
  const length = Math.floor(pw[other ? 8 : 11] / (other ? 4 : 3));
  for (let index = 0; index < length; index += 1) {
    s3 = (index ^ rotateRight8(s3 ^ pw[index % 15], other ? 2 : 3)) & 0xff;
  }

  const random = createMsvcRandom((s0 * s1 + s2 + s3) >>> 0);
  factors[s3 % 3] = random() & 0xff;
  if (!other && isVersion35(cryptVersion)) factors[1] = random() % 0xfb;

  for (let index = 0; index < 256; index += 1) {
    const random16 = random() & 0xffff;
    key[index] = factors[0] ^ (random() & 0xff);
    key[index + 256] = factors[1] ^ (random16 >>> 8);
    key[index + 512] = factors[2] ^ random16;
  }

  const proKey = options.proKey;
  if (proKey) {
    for (let index = 0; index < 128; index += 1) {
      const random16 = random() & 0xffff;
      key[index] ^= s3 ^ proKey[2] ^ (random16 >>> 8);
      key[index + 256] ^= s3 ^ proKey[0] ^ random16;
    }
  }

  if (!other) return key;

  const salt =
    cryptVersion === 0x015e ? saltBytes("958") : saltBytes(options.keyString);
  let factor = 7;
  if (isVersion35(cryptVersion)) {
    s3 = (s3 + 0x22) & 0xff;
    factor = 16;
  }
  for (let part = 0; part < 3; part += 1) {
    let running = s3;
    for (let index = 0; index < 256; index += 1) {
      const currentSalt = salt[index & 0x7f];
      const secondSalt = salt[(index + part) & 0x7f];
      const currentKey = key[part * 256 + index];
      const saltXorKey = currentSalt ^ currentKey;
      const round = (secondSalt | (currentSalt << 8)) % factor;
      let nextKey = saltXorKey;
      let skip = false;
      switch (round) {
        case 1:
          if (secondSalt % 0x0b === 0) nextKey = currentKey;
          break;
        case 2:
          if (currentSalt % 0x1d === 0) nextKey = ~saltXorKey;
          break;
        case 3:
          if ((round + index) % 0x25 === 0) nextKey = secondSalt ^ saltXorKey;
          break;
        case 4:
          if ((currentSalt + secondSalt) % 97 === 0)
            nextKey = currentSalt + saltXorKey;
          break;
        case 5:
          if ((index * round) % 0x7b === 0) nextKey = saltXorKey ^ running;
          break;
        case 6:
          if (currentSalt === 0xff && secondSalt === 0) {
            nextKey = 0;
            skip = true;
          }
          break;
        case 7:
          if (
            cryptVersion >= 0x0154 &&
            !(cryptVersion > 0x03e8 && cryptVersion < 0x03fc) &&
            ((round + index) % 0x33 === 0 || cryptVersion >= 0x03fc)
          ) {
            nextKey ^= currentSalt;
          }
          break;
        case 8:
          if (
            cryptVersion >= 0x0154 &&
            !(cryptVersion > 0x03e8 && cryptVersion < 0x03fc) &&
            (currentSalt % 0x1d === 0 || cryptVersion >= 0x03fc)
          ) {
            nextKey ^= currentSalt;
          }
          break;
        default:
          break;
      }
      if ((index + part) % ((currentSalt % 5) + 1) === 0) nextKey ^= running;
      else if (skip) nextKey = ~saltXorKey;
      key[part * 256 + index] = nextKey & 0xff;
      running = (running + part) | 0;
    }
  }
  return key;
}

export function xorWolfCrypt(source, key, position, cryptVersion) {
  const output = Buffer.from(source);
  let low = position % 256;
  let middle = Math.floor(position / 256) % 256;
  let high = Math.floor(position / 0x10000) % 256;
  if (isVersion35(cryptVersion)) {
    const expanded = new Uint8Array(512);
    for (let index = 0; index < expanded.length; index += 1) {
      expanded[index] = key[index % 256] ^ ((7 * index) & 0xff);
    }
    for (let index = 0; index < output.length; index += 1) {
      output[index] ^= expanded[low] ^ expanded[middle + 256];
      low += 1;
      if (low === 256) {
        low = 0;
        middle = (middle + 1) % 256;
      }
    }
    return output;
  }

  for (let index = 0; index < output.length; index += 1) {
    output[index] ^= key[low] ^ key[middle + 256] ^ key[high + 512];
    low += 1;
    if (low === 256) {
      low = 0;
      middle += 1;
      if (middle === 256) {
        middle = 0;
        high = (high + 1) % 256;
      }
    }
  }
  return output;
}

function xorU16(buffer, offset, value) {
  buffer.writeUInt16LE(buffer.readUInt16LE(offset) ^ (value & 0xffff), offset);
}

export function cryptModernHeader(source, cryptVersion) {
  const output = Buffer.from(source);
  const password = output.subarray(49, 64);
  let random;
  if (isVersion35(cryptVersion)) {
    random = createMsvcRandom(
      (0x0c + password[9] * password[10] + password[3]) >>> 0,
    );
    let offset = 8;
    for (let group = 0; group < 2; group += 1) {
      for (let index = 3; index >= 0; index -= 1)
        xorU16(output, offset + index * 2, random());
      offset += 8;
    }
    const r0 = BigInt(random()) << 17n;
    const r1 = BigInt(random()) << 31n;
    const value0 = Number((r0 | r1 | BigInt(random())) & 0xffffffffn) >>> 0;
    const value1 = Number(((r0 >> 32n) | (r1 >> 32n)) & 0xffffffffn) >>> 0;
    output.writeUInt32LE((output.readUInt32LE(offset) ^ value0) >>> 0, offset);
    output.writeUInt32LE(
      (output.readUInt32LE(offset + 4) ^ value1) >>> 0,
      offset + 4,
    );
    offset += 8;
    for (let index = 3; index >= 0; index -= 1)
      xorU16(output, offset + index * 2, random());
    return output;
  }

  random = createMsvcRandom((password[0] + password[7] * password[12]) >>> 0);
  let offset = 8;
  for (let group = 0; group < 4; group += 1) {
    for (let index = 3; index >= 0; index -= 1)
      xorU16(output, offset + index * 2, random());
    offset += 8;
  }
  return output;
}

function expandAesKey(key) {
  const roundKey = new Uint8Array(176);
  roundKey.set(key);
  const temporary = new Uint8Array(4);
  for (let index = 4; index < 44; index += 1) {
    const previous = (index - 1) * 4;
    temporary.set(roundKey.subarray(previous, previous + 4));
    if (index % 4 === 0) {
      const first = temporary[0];
      temporary[0] = temporary[1];
      temporary[1] = temporary[2];
      temporary[2] = temporary[3];
      temporary[3] = first;
      temporary[0] = SBOX[temporary[0]] ^ RCON[index / 4];
      temporary[1] = SBOX[temporary[1]] >>> 4;
      temporary[2] = ~SBOX[temporary[2]];
      temporary[3] = rotateRight8(SBOX[temporary[3]], 7);
    }
    const target = index * 4;
    const earlier = (index - 4) * 4;
    for (let byte = 0; byte < 4; byte += 1) {
      roundKey[target + byte] = roundKey[earlier + byte] ^ temporary[byte];
    }
  }
  return roundKey;
}

function createAesContext(cryptVersion, password, proKey = Buffer.alloc(4)) {
  const pw = Buffer.from(password);
  const key = new Uint8Array(16);
  const iv = new Uint8Array(16);
  if (isVersion35(cryptVersion)) {
    for (let index = 0; index < 15; index += 1) {
      const currentPro = proKey[index % 4];
      const keyIndex =
        ((index * ((currentPro % 5) + 7)) ^ (3 * pw[index])) % 15;
      const ivIndex =
        ((index * ((proKey[(index + 1) % 4] % 7) + 0x0b)) ^
          (5 * pw[(index + 3) % 15])) %
        15;
      key[index] ^=
        (((index ^ currentPro) + (pw[keyIndex] << (index % 3))) % 0xfb) & 0xff;
      iv[index] ^=
        ((pw[ivIndex] >>> (index % 2)) +
          ((index * index) ^ proKey[(index + 2) % 4])) %
        0xf6;
      key[15] ^= (7 * (pw[index] + ((index + 1) ^ currentPro))) % 0xfd;
      const difference =
        (pw[index] - ((index * 2) ^ proKey[(index + 2) % 4])) & 0xffff;
      iv[15] ^= (11 * difference) & 0xff;
    }
  } else if (cryptVersion === 0x03f2) {
    for (let index = 0; index < 15; index += 1) {
      key[index] ^=
        ((pw[(index * 7) % 15] + proKey[index & 3]) * index * index) & 0xff;
      iv[index] ^=
        (pw[(index * 11) % 15] + proKey[(index + 2) % 4] - index * index) &
        0xff;
      key[15] ^= (index * 3 + pw[index] + proKey[index & 3]) & 0xff;
      iv[15] ^= (index * 5 + pw[index] + proKey[(index + 2) % 4]) & 0xff;
    }
  } else {
    for (let index = 0; index < 15; index += 1) {
      key[index] ^= (pw[(index * 7) % 15] + index * index) & 0xff;
      iv[index] ^= (pw[(index * 11) % 15] - index * index) & 0xff;
      key[15] ^= (pw[index] + index * 3) & 0xff;
      iv[15] ^= (pw[index] + index * 5) & 0xff;
    }
  }
  key[0] ^= proKey[0];
  iv[10] ^= proKey[0];
  key[4] ^= proKey[1];
  iv[1] ^= proKey[1];
  key[8] ^= proKey[2];
  iv[4] ^= proKey[2];
  key[12] ^= proKey[3];
  iv[7] ^= proKey[3];
  return { roundKey: expandAesKey(key), iv };
}

export function createWolfAesContext(key, iv) {
  return { roundKey: expandAesKey(key), iv: Uint8Array.from(iv) };
}

function addRoundKey(state, round, roundKey) {
  for (let index = 0; index < 16; index += 1)
    state[index] ^= roundKey[round * 16 + index];
}

function shiftRows(state) {
  let temporary = state[1];
  state[1] = state[5];
  state[5] = state[9];
  state[9] = state[13];
  state[13] = temporary;
  temporary = state[2];
  state[2] = state[10];
  state[10] = temporary;
  temporary = state[6];
  state[6] = state[14];
  state[14] = temporary;
  temporary = state[3];
  state[3] = state[15];
  state[15] = state[11];
  state[11] = state[7];
  state[7] = temporary;
}

function xtime(value) {
  return ((value << 1) ^ (((value >>> 7) & 1) * 0x1b)) & 0xff;
}

function mixColumns(state) {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const first = state[offset];
    const combined =
      state[offset + 1] ^ state[offset] ^ state[offset + 2] ^ state[offset + 3];
    state[offset] ^= combined ^ xtime(state[offset + 1] ^ state[offset]);
    state[offset + 1] ^=
      combined ^ xtime(state[offset + 2] ^ state[offset + 1]);
    state[offset + 2] ^=
      combined ^ xtime(state[offset + 2] ^ state[offset + 3]);
    state[offset + 3] ^= combined ^ xtime(state[offset + 3] ^ first);
  }
}

function aesBlock(source, roundKey) {
  const state = Uint8Array.from(source);
  addRoundKey(state, 0, roundKey);
  for (let round = 1; round < 10; round += 1) {
    for (let index = 0; index < 16; index += 1)
      state[index] = SBOX[state[index]];
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, round, roundKey);
  }
  for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index]];
  shiftRows(state);
  addRoundKey(state, 10, roundKey);
  return state;
}

function counterAt(iv, amount) {
  const counter = Uint8Array.from(iv);
  let carry = BigInt(amount);
  for (let index = 15; index >= 0 && carry !== 0n; index -= 1) {
    const sum = BigInt(counter[index]) + (carry & 0xffn);
    counter[index] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

export function xorWolfAes(source, context, streamPosition) {
  const output = Buffer.from(source);
  let block = Math.floor(streamPosition / 16);
  let offset = streamPosition % 16;
  let position = 0;
  while (position < output.length) {
    const stream = aesBlock(counterAt(context.iv, block), context.roundKey);
    const length = Math.min(16 - offset, output.length - position);
    for (let index = 0; index < length; index += 1) {
      output[position + index] ^= stream[offset + index];
    }
    position += length;
    block += 1;
    offset = 0;
  }
  return output;
}

function createXorShift(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 11;
    state ^= state >>> 19;
    state ^= state << 7;
    state >>>= 0;
    return state;
  };
}

function modernBodySize(cryptVersion, password, archiveSize, proKey) {
  if (!isVersion35(cryptVersion)) return Math.min(0x400, archiveSize - 64);
  let seed =
    cryptVersion >= 1020
      ? (proKey[0] * proKey[1] + password[2] * password[4] + password[11]) >>> 0
      : (password[2] * password[4] + password[12]) >>> 0;
  if (seed === 0) seed = 1;
  const random = createXorShift(seed);
  random();
  if (archiveSize >= (random() % 500) + 800) random();
  let size = archiveSize - 64;
  if (size >= (random() % 500) + 800) size = (random() % 500) + 800;
  return size;
}

export function createModernCryptContext(header, mode, archiveSize) {
  const password = Buffer.from(header.reserve);
  const cryptVersion = header.cryptVersion;
  const proKey = mode.proKey;
  const effectiveProKey = proKey || Buffer.alloc(4);
  return {
    archiveSize,
    bodySize: modernBodySize(
      cryptVersion,
      password,
      archiveSize,
      effectiveProKey,
    ),
    cryptVersion,
    innerKey: createWolfCryptKey(cryptVersion, password, { proKey }),
    outerKey: createWolfCryptKey(cryptVersion, password, {
      other: true,
      keyString: mode.key,
    }),
    aes: createAesContext(cryptVersion, password, effectiveProKey),
    nameTableStart: header.nameTableStart,
  };
}

function transformIntersection(
  source,
  absolutePosition,
  start,
  end,
  transform,
) {
  const sourceEnd = absolutePosition + source.length;
  const overlapStart = Math.max(absolutePosition, start);
  const overlapEnd = Math.min(sourceEnd, end);
  if (overlapStart >= overlapEnd) return Buffer.from(source);
  const output = Buffer.from(source);
  const localStart = overlapStart - absolutePosition;
  const localEnd = overlapEnd - absolutePosition;
  transform(output.subarray(localStart, localEnd), overlapStart);
  return output;
}

export function xorModernOuter(source, context, absolutePosition) {
  let output = transformIntersection(
    source,
    absolutePosition,
    64,
    context.archiveSize - 64,
    (slice, position) => {
      xorWolfCrypt(
        slice,
        context.outerKey,
        position,
        context.cryptVersion,
      ).copy(slice);
    },
  );
  output = transformIntersection(
    output,
    absolutePosition,
    64,
    64 + context.bodySize,
    (slice, position) => {
      xorWolfAes(slice, context.aes, position - 64).copy(slice);
    },
  );
  const tableStreamStart = Math.ceil(context.bodySize / 16) * 16;
  output = transformIntersection(
    output,
    absolutePosition,
    context.nameTableStart,
    context.archiveSize,
    (slice, position) => {
      xorWolfAes(
        slice,
        context.aes,
        tableStreamStart + position - context.nameTableStart,
      ).copy(slice);
    },
  );
  return output;
}

function rotateLeft32(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function quarterRound(state, a, b, c, d) {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotateLeft32(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotateLeft32(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotateLeft32(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotateLeft32(state[b] ^ state[c], 7);
}

function chachaBlock(key, nonce, counter) {
  const initial = new Uint32Array(16);
  Buffer.from("expand 32-byte k", "ascii").copy(Buffer.from(initial.buffer), 0);
  for (let index = 0; index < 8; index += 1)
    initial[4 + index] = key.readUInt32LE(index * 4);
  initial[12] = counter >>> 0;
  for (let index = 0; index < 3; index += 1)
    initial[13 + index] = nonce.readUInt32LE(index * 4);
  const state = Uint32Array.from(initial);
  for (let round = 0; round < 10; round += 1) {
    quarterRound(state, 0, 4, 8, 12);
    quarterRound(state, 1, 5, 9, 13);
    quarterRound(state, 2, 6, 10, 14);
    quarterRound(state, 3, 7, 11, 15);
    quarterRound(state, 0, 5, 10, 15);
    quarterRound(state, 1, 6, 11, 12);
    quarterRound(state, 2, 7, 8, 13);
    quarterRound(state, 3, 4, 9, 14);
  }
  for (let index = 0; index < 16; index += 1)
    state[index] = (state[index] + initial[index]) >>> 0;
  return Buffer.from(state.buffer, state.byteOffset, state.byteLength);
}

export function xorChaCha20(source, key, nonce, position = 0) {
  const output = Buffer.from(source);
  let counter = (1 + Math.floor(position / 64)) >>> 0;
  let offset = position % 64;
  let target = 0;
  while (target < output.length) {
    const stream = chachaBlock(Buffer.from(key), Buffer.from(nonce), counter);
    const length = Math.min(64 - offset, output.length - target);
    for (let index = 0; index < length; index += 1)
      output[target + index] ^= stream[offset + index];
    target += length;
    counter = (counter + 1) >>> 0;
    offset = 0;
  }
  return output;
}

export function isModernCryptVersion(cryptVersion) {
  return (cryptVersion >= 331 && cryptVersion < 1000) || cryptVersion >= 1010;
}
