import { open } from "node:fs/promises";

import { parseFile } from "music-metadata";

export const BROWSER_AUDIO_EXTENSIONS = /\.(?:mp3|ogg|opus|wav)$/iu;

async function waveLoop(path) {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(12);
    await file.read(header, 0, header.length, 0);
    if (
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    )
      return undefined;
    const { size } = await file.stat();
    for (let offset = 12; offset + 8 <= size; ) {
      const chunk = Buffer.alloc(8);
      await file.read(chunk, 0, 8, offset);
      const length = chunk.readUInt32LE(4);
      if (offset + 8 + length > size) break;
      if (chunk.toString("ascii", 0, 4) === "smpl" && length >= 60) {
        const sampler = Buffer.alloc(60);
        await file.read(sampler, 0, 60, offset + 8);
        if (sampler.readUInt32LE(28) > 0 && sampler.readUInt32LE(40) === 0) {
          return {
            start: sampler.readUInt32LE(44),
            end: sampler.readUInt32LE(48) + 1,
          };
        }
      }
      offset += 8 + length + (length % 2);
    }
  } finally {
    await file.close();
  }
}

async function opusFrames(path) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(27);
    let serial, preSkip;
    for (let offset = 0; offset + header.length <= size; ) {
      await file.read(header, 0, header.length, offset);
      if (header.toString("ascii", 0, 4) !== "OggS" || header[4] !== 0) break;
      const lacing = Buffer.alloc(header[26]);
      await file.read(lacing, 0, lacing.length, offset + header.length);
      const body = offset + header.length + lacing.length;
      const length = lacing.reduce((sum, value) => sum + value, 0);
      if (body + length > size) break;
      if (serial === undefined) {
        const id = Buffer.alloc(19);
        if (length < id.length) break;
        await file.read(id, 0, id.length, body);
        if (id.toString("ascii", 0, 8) !== "OpusHead") break;
        serial = header.readUInt32LE(14);
        preSkip = id.readUInt16LE(10);
      }
      if (header.readUInt32LE(14) === serial && header[5] & 4) {
        const frames = header.readBigUInt64LE(6) - BigInt(preSkip);
        if (frames > 0 && frames <= BigInt(Number.MAX_SAFE_INTEGER))
          return Number(frames);
        break;
      }
      offset = body + length;
    }
  } finally {
    await file.close();
  }
}

export async function browserAudioMetadata(path) {
  if (!BROWSER_AUDIO_EXTENSIONS.test(path)) return undefined;
  try {
    const { format, native } = await parseFile(path, {
      duration: true,
      skipCovers: true,
    });
    // Opus granules count 48 kHz samples. The header's input-rate field is
    // only a hint (and may be zero), which music-metadata reports as sampleRate.
    const opus = format.codec === "Opus";
    const sampleRate = opus ? 48000 : format.sampleRate;
    const channels = format.numberOfChannels;
    const samples =
      format.numberOfSamples ?? (opus ? await opusFrames(path) : undefined);
    const frames = Math.round(samples ?? format.duration * sampleRate);
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate <= 0 ||
      ![1, 2].includes(channels) ||
      !Number.isSafeInteger(frames) ||
      frames <= 0 ||
      frames * channels * 2 + 36 > 0xffffffff
    ) {
      throw new Error(
        "The audio needs a known duration and one or two channels within the WAV size limit.",
      );
    }
    const tags = new Map();
    for (const tag of Object.values(native).flat()) {
      const name = /(?:^|:)(LOOPSTART|LOOPEND|LOOPLENGTH)$/iu.exec(tag.id)?.[1];
      const value = Number(tag.value);
      if (name && Number.isSafeInteger(value) && value >= 0) {
        tags.set(name.toUpperCase(), value);
      }
    }
    const start = tags.get("LOOPSTART") ?? 0;
    const end =
      tags.get("LOOPEND") ??
      (tags.has("LOOPLENGTH")
        ? start + tags.get("LOOPLENGTH")
        : tags.has("LOOPSTART")
          ? frames
          : undefined);
    const loop = /\.wav$/iu.test(path)
      ? await waveLoop(path)
      : end !== undefined
        ? { start, end }
        : undefined;
    return {
      sampleRate,
      channels,
      frames,
      ...(loop && loop.start >= 0 && loop.start < loop.end && loop.end <= frames
        ? { loop }
        : {}),
    };
  } catch (error) {
    throw new Error(
      `Could not read browser audio metadata for ${path}: ${error.message}`,
      { cause: error },
    );
  }
}
