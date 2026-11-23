import { createMsvcRandom, rotateRight8 } from "./crypt-common.mjs";

/* WOLF Pro archive-key derivation, ported from UberWolf's MIT-licensed format implementation. */

import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { ARCHIVE_EXTENSIONS } from "../constants.mjs";
import { createWolfAesContext, xorWolfAes } from "./wolf-crypt.mjs";

const SPECIAL_NAMES = new Set([
  "game",
  "list",
  "data2",
  "gamefile",
  "basicdata2",
]);

export function isWolfProKeyArchive(path) {
  return (
    ARCHIVE_EXTENSIONS.has(extname(path).toLowerCase()) &&
    SPECIAL_NAMES.has(basename(path, extname(path)).toLowerCase())
  );
}

function deriveV1Key(source) {
  if (source.length < 0x5cb8)
    throw new Error("The WOLF Pro key archive is too small.");
  const bytes = Buffer.from(source);
  const random = createMsvcRandom(bytes[4]);
  for (let index = 20; index < bytes.length; index += 1)
    bytes[index] ^= random() >>> 12;
  const keyLength = bytes[19];
  if (keyLength === 0 || keyLength > 63)
    throw new Error("The WOLF Pro archive key length is invalid.");
  const step = Math.floor(0x58b1 / keyLength);
  const key = Buffer.alloc(keyLength);
  let offset = 30;
  for (let index = 0; index < keyLength; index += 1) {
    if (offset >= bytes.length)
      throw new Error("The WOLF Pro archive key is truncated.");
    key[index] = bytes[offset];
    offset += step;
  }
  return key;
}

function deriveChaCha2Key(fileSize) {
  const size = (fileSize - 31) >>> 0;
  const remainder = size % 0x064b;
  const xor = (size ^ 0x70) >>> 0;
  const sum = (remainder + 152) >>> 0;
  const divide4 = (Math.floor(size / 4) + 1285) >>> 0;
  const divide2 = (Math.floor(size / 2) + 171) >>> 0;
  const data = Uint8Array.from([
    (divide4 ^ divide2) & 0xff,
    (xor + sum) & 0xff,
    (xor - divide4) & 0xff,
    Math.imul(divide4, xor) & 0xff,
  ]);
  const mod1 = [0x3f, 0xa7, 0xd2, 0x1c];
  const mod2 = [0xb4, 0xe1, 0x9d, 0x58];
  const mod3 = [0x6a, 0x2b, 0x4c, 0x8e];
  const key = Buffer.alloc(64);
  for (let index = 0; index < key.length; index += 1) {
    const part = index % 4;
    let value = ((data[part] + mod2[part]) ^ (mod1[part] + 17 * index)) & 0xff;
    value = index % 2 === 0 ? rotateRight8(value, 5) : rotateRight8(value, 2);
    key[index] = ~(value ^ data[part] ^ mod3[part]);
  }
  return key;
}

function createRngData() {
  return {
    seed1: 0,
    seed2: 0,
    counter: 0,
    data: Array.from({ length: 0x20 }, () => new Uint32Array(0x100)),
  };
}

function customRng1(rng) {
  const seed1 = rng.seed1 >>> 0;
  const shifted = ((seed1 << 11) ^ seed1) >>> 0;
  const seedPart = (seed1 ^ (shifted >>> 8)) >>> 0;
  const seed = ((seed1 << 11) ^ seedPart) >>> 0;
  let state = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  let modifier =
    (Math.imul(13, seedPart) + 95) & 1 ? (state * 4) >>> 0 : state >>> 3;
  state = (state ^ modifier) >>> 0;
  if ((state & 0x400) !== 0) {
    state = (state ^ (state << 21)) >>> 0;
    modifier = state >>> 9;
  } else {
    state = (state ^ Math.imul(state, 4)) >>> 0;
    modifier = state >>> 22;
  }
  state = (state ^ modifier) >>> 0;
  if ((state & 0xfffff) === 0) state = (state + 256) >>> 0;
  rng.seed1 = state;
  return state;
}

function customRng2(rng) {
  const seed = rng.seed1 >>> 0;
  let state = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  const modifier = (seed & 7) + 1;
  if (state % 3 !== 0) {
    if (state % 3 === 1) state = (state ^ (state >>> modifier)) >>> 0;
    else state = (~state + (state << modifier)) >>> 0;
  } else {
    state = (state ^ (state << modifier)) >>> 0;
  }
  if (state !== 0) {
    if ((state & 0xffff) === 0) state = (state ^ 0x55aa55aa) >>> 0;
  } else {
    state = 0x00173bef;
  }
  rng.seed1 = state;
  return state;
}

function customRng3(rng) {
  const seed = rng.seed2 >>> 0;
  let state = (Math.imul(1566083941, seed) ^ Math.imul(292331520, seed)) >>> 0;
  state =
    (state ^ (state >>> 17) ^ Math.imul(32, state ^ (state >>> 17))) >>> 0;
  state =
    Math.imul(69069, state ^ ((state ^ (state >>> 11)) & 0x3fffffff)) >>> 0;
  if (state !== 0) {
    if ((state & 0xffff) === 0) state = (state ^ 0x59a6f141) >>> 0;
    if ((state & 0xfffff) === 0) state = (state + 256) >>> 0;
  } else {
    state = 1566083941;
  }
  rng.seed2 = state;
  return state;
}

function rngChain(rng, target) {
  let index = 0;
  for (let position = 0; position < target.length; position += 1) {
    const random = customRng2(rng);
    let value = (random ^ customRng3(rng)) >>> 0;
    rng.counter = (rng.counter + 1) >>> 0;
    if ((rng.counter & 1) === 0) value = (value + customRng3(rng)) >>> 0;
    const counter = rng.counter;
    if (counter % 3 === 0)
      value = (value ^ ((customRng1(rng) + 3) >>> 0)) >>> 0;
    if (counter % 7 === 0) value = (value + customRng3(rng) + 1) >>> 0;
    if ((counter & 7) === 0) value = Math.imul(value, customRng1(rng)) >>> 0;
    if ((index + rng.seed1) % 5 === 0) value = (value ^ customRng1(rng)) >>> 0;
    if (counter % 9 === 0) value = (value + customRng2(rng) + 4) >>> 0;
    if (counter % 0x18 === 0) value = (value + customRng2(rng) + 7) >>> 0;
    if (counter % 0x1f === 0)
      value = (value + Math.imul(3, customRng3(rng))) >>> 0;
    if (counter % 0x3d === 0) value = (value + customRng3(rng) + 1) >>> 0;
    if (counter % 0xa1 === 0) value = (value + customRng2(rng)) >>> 0;
    if ((random & 0xffff) === 256)
      value = (value + Math.imul(3, customRng3(rng))) >>> 0;
    target[position] = value;
    index += 1;
  }
}

function runRngChain(rng, seed1, seed2) {
  rng.seed1 = seed1 >>> 0;
  rng.seed2 = seed2 >>> 0;
  rng.counter = 0;
  for (const row of rng.data) rngChain(rng, row);
}

function aLotOfRng(rng, initial2, initial3, outputIndex, cryptData) {
  let value2 = initial2 >>> 0;
  let value3 = initial3 >>> 0;
  let iterations = 20;
  for (let index = 0; index < iterations; index += 1) {
    const index1 = (value2 ^ customRng1(rng)) & 0x1f;
    const index2 = (value3 ^ customRng2(rng)) & 0xff;
    value3 = rng.data[index1][index2];
    switch ((value2 + rng.counter) % 0x14) {
      case 1:
        rngChain(rng, rng.data[(value2 + 5) & 0x1f]);
        break;
      case 2:
        value3 = (value3 ^ customRng1(rng)) >>> 0;
        break;
      case 5:
        if ((value2 & 0xfffff) === 0) cryptData[outputIndex] ^= customRng3(rng);
        break;
      case 9:
      case 0x0e: {
        const target = customRng2(rng) % 0x30;
        cryptData[target] = (cryptData[target] + value3) & 0xff;
        break;
      }
      case 0x0b:
        cryptData[outputIndex] ^= customRng1(rng);
        break;
      case 0x11:
        iterations += 1;
        break;
      case 0x13:
        if ((value2 & 0xffff) === 0) cryptData[outputIndex] ^= customRng2(rng);
        break;
      default:
        break;
    }
    value2 = (value2 + customRng3(rng)) >>> 0;
    if (iterations > 50) iterations = 50;
  }
  cryptData[outputIndex] = (cryptData[outputIndex] + value3) & 0xff;
}

function aesKeyGen(cryptData, rng) {
  runRngChain(rng, cryptData.seedBytes[0], cryptData.seedBytes[1]);
  const generated = new Uint8Array(0x30);
  for (let index = 0; index < generated.length; index += 1) {
    aLotOfRng(
      rng,
      (index + cryptData.seedBytes[3]) >>> 0,
      (cryptData.seedBytes[2] - index) >>> 0,
      index,
      generated,
    );
  }
  const indexes = Uint8Array.from({ length: 0x30 }, (_, index) => index);
  const shuffled = new Uint8Array(0x30);
  const random = createMsvcRandom(
    cryptData.seedBytes[1] ^ cryptData.seedBytes[2],
  );
  for (let index = 0; index < indexes.length; index += 1) {
    const target = random() % indexes.length;
    const old = indexes[index];
    indexes[index] = indexes[target];
    indexes[target] = old;
  }
  for (let index = 0; index < indexes.length; index += 1)
    shuffled[index] = generated[indexes[index]];
  return { key: shuffled.subarray(0, 16), iv: shuffled.subarray(16, 32) };
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function deriveModernProKey(source) {
  if (source.length < 32)
    throw new Error("The WOLF Pro key archive is too small.");
  const bytes = Buffer.from(source);
  const dataSize = bytes.length - 31;
  const sizeDiv = Math.floor(dataSize / 3) >>> 0;
  const value1 = (sizeDiv + 71 + (sizeDiv >>> 31)) >>> 0;
  const value2 = (dataSize ^ 0x70) >>> 0;
  const value3 = ((dataSize % 1200) + 152) >>> 0;
  const value4 = (Math.imul(3, dataSize) + 85) >>> 0;
  const keyBytes = Uint8Array.from([
    (value4 ^ value1) & 0xff,
    (value3 + value2) & 0xff,
    (value2 - value4) & 0xff,
    Math.imul(value2, value4) & 0xff,
  ]);
  const seedBytes = Uint8Array.from([
    (value1 + bytes[3]) & 0xff,
    (value3 + bytes[7]) & 0xff,
    (value2 + bytes[5]) & 0xff,
    (value4 + bytes[6]) & 0xff,
  ]);
  const cryptData = { keyBytes, seedBytes };
  const rng = createRngData();
  runRngChain(rng, value1, value3);
  const { key, iv } = aesKeyGen(cryptData, rng);
  xorWolfAes(
    bytes.subarray(30, 30 + dataSize),
    createWolfAesContext(key, iv),
    0,
  ).copy(bytes, 30);

  let step = (bytes[4] + ((bytes[3] * bytes[6]) & 0x03ff)) >>> 0;
  while (greatestCommonDivisor(dataSize, step) > 1) step += 1;
  const keyLength = bytes[19];
  if (keyLength === 0 || keyLength > 63)
    throw new Error("The WOLF Pro archive key length is invalid.");
  const result = Buffer.alloc(keyLength + 5);
  for (let index = 0; index < keyLength; index += 1) {
    const offset = ((index * step) % dataSize) + 30 + bytes[7];
    if (offset >= bytes.length)
      throw new Error("The WOLF Pro archive key is truncated.");
    result[index] = bytes[offset];
  }
  keyBytes.forEach((byte, index) => {
    result[keyLength + 1 + index] = byte;
  });
  return {
    key: result.subarray(0, keyLength),
    proKey: result.subarray(keyLength + 1),
  };
}

export function deriveWolfProMode(source, cryptVersion) {
  const bytes = Buffer.from(source);
  if (bytes.length === 0) throw new Error("The WOLF Pro key archive is empty.");
  if (bytes[0] === 0xa0) {
    return {
      name: "pro-v1",
      label: "WOLF RPG Pro v1",
      archiveVersion: 8,
      cryptVersion: 1000,
      algorithm: "dx8",
      dynamic: true,
      key: deriveV1Key(bytes),
    };
  }
  if (bytes[0] === 0xf1) {
    const material = deriveChaCha2Key(bytes.length);
    return {
      name: "pro-chacha2",
      label: "WOLF RPG Pro ChaCha2",
      archiveVersion: 8,
      cryptVersion: 0x00c8,
      algorithm: "chacha20",
      dynamic: true,
      key: material.subarray(0, 32),
      nonce: material.subarray(34, 46),
    };
  }
  const material = deriveModernProKey(bytes);
  return {
    name: "pro-modern",
    label: "WOLF RPG Pro 3.x",
    archiveVersion: 8,
    cryptVersion,
    algorithm: "wolf",
    dynamic: true,
    key: material.key,
    proKey: material.proKey,
  };
}

export async function findWolfProMode(folder, cryptVersion) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !isWolfProKeyArchive(entry.name)) continue;
    const candidate = join(folder, entry.name);
    return deriveWolfProMode(await readFile(candidate), cryptVersion);
  }
  return undefined;
}
