export function createDeferredAudioLoader(Module, files, options) {
  const records = new Map();
  const byId = new Map();
  const loops = new Map();
  const buffers = new WeakMap();
  const waiting = new WeakSet();
  let FS;
  let AL;
  let nextId = 1;

  for (const file of files) {
    if (!file.audio) continue;
    const record = {
      id: nextId++,
      path: file.path,
      ...file.audio,
      state: "idle",
      audio: null,
      buffers: new Set(),
      virtualPath: null,
    };
    records.set(file.path, record);
    byId.set(record.id, record);
    if (record.loop) {
      const path = file.path.replace(/\.[^/.]+$/u, "_loop.txt");
      for (const key of options.pathKeys(path)) loops.set(key, record);
    }
  }

  // The marker survives native WAV decoding and identifies both the asset and
  // the exact PCM frame offset, including cached sounds and stream refills.
  // Mix the block offset into each word so a loop's partial tail differs from
  // the same marker phase in the intro.
  function marker(record, sample) {
    const frame = Math.floor(sample / record.channels);
    const base = Math.floor(frame / 8) * 8;
    const idLow = record.id & 0xffff;
    const idHigh = record.id >>> 16;
    const low = base & 0xffff;
    const high = base >>> 16;
    switch (frame % 8) {
      case 0:
        return 0x6f57 ^ low;
      case 1:
        return 0x666c ^ low ^ high;
      case 2:
        return idLow ^ low;
      case 3:
        return idHigh ^ low ^ high;
      case 4:
        return low;
      case 5:
        return low ^ high;
      case 6:
        return idLow ^ idHigh ^ low ^ high ^ 0x3347;
      default:
        return 0x3158 ^ low ^ high;
    }
  }

  function identify(pointer, size, frequency, format) {
    if (![4353, 4355].includes(format) || size < 12) return undefined;
    const channels = format === 4355 ? 2 : 1;
    const heap = new Uint16Array(Module.HEAP8.buffer, pointer, size / 2);
    const length = heap.length / channels;
    const matches = (record, at, frame) => {
      if (frame < 0 || frame >= record.frames) return false;
      const value = marker(record, frame * record.channels);
      for (let channel = 0; channel < channels; channel++) {
        if (heap[at * channels + channel] !== value) return false;
      }
      return true;
    };
    const loopRanges = (record) =>
      [record.loop, { start: 0, end: record.frames }].filter(Boolean);
    let identified;
    let previous;
    for (
      let index = 0;
      index + 6 * channels <= heap.length;
      index += channels
    ) {
      if (!identified && index >= 24 * channels) break;
      const word = (offset) => heap[index + offset * channels];
      const low = word(4),
        high = word(4) ^ word(5);
      if (word(0) !== (0x6f57 ^ low) || word(1) !== (0x666c ^ low ^ high))
        continue;
      const idLow = word(2) ^ low,
        idHigh = word(3) ^ low ^ high;
      const id = (idLow | (idHigh << 16)) >>> 0;
      const base = (low | (high << 16)) >>> 0;
      if (base % 8 !== 0) continue;
      if (
        index + 7 * channels <= heap.length &&
        word(6) !== (idLow ^ idHigh ^ low ^ high ^ 0x3347)
      )
        continue;
      if (
        index + 8 * channels <= heap.length &&
        word(7) !== (0x3158 ^ low ^ high)
      )
        continue;
      const record = byId.get(id);
      const frame = base - index / channels;
      if (record && base < record.frames && frequency === record.sampleRate) {
        const at = index / channels;
        const sourceFrame = base;
        if (!identified) {
          identified = { record, spans: [{ at: 0, frame }] };
          // The buffer may wrap before its first complete marker. Recover the
          // short prefix from a known loop instead of extrapolating below zero
          // (or into the intro preceding an embedded loop).
          for (const loop of loopRanges(record)) {
            const boundary = at - (base - loop.start);
            if (
              boundary <= 0 ||
              boundary > at ||
              boundary > loop.end - loop.start
            )
              continue;
            let valid = true;
            for (let i = 0; i < at; i++) {
              const candidate =
                i < boundary
                  ? loop.end - boundary + i
                  : loop.start + i - boundary;
              if (!matches(record, i, candidate)) {
                valid = false;
                break;
              }
            }
            if (valid) {
              identified.spans = [
                { at: 0, frame: loop.end - boundary },
                { at: boundary, frame: loop.start },
              ];
              break;
            }
          }
        }
        const last = identified.spans[identified.spans.length - 1];
        if (
          record === identified.record &&
          sourceFrame !== last.frame + at - last.at
        ) {
          // A native stream buffer can cross a loop boundary. Preserve that
          // splice instead of copying one contiguous piece past the loop end.
          let boundary = at;
          let restart = sourceFrame;
          for (const loop of loopRanges(record)) {
            if (!previous) continue;
            const candidate = previous.at + loop.end - previous.frame;
            if (
              candidate >= previous.at &&
              candidate <= at &&
              loop.start + at - candidate === sourceFrame
            ) {
              boundary = candidate;
              restart = loop.start;
              break;
            }
          }
          identified.spans.push({ at: boundary, frame: restart });
        }
        previous = { at, frame: sourceFrame };
      }
    }
    if (!identified) {
      // An unaligned eight-frame window still contains every marker field,
      // split between adjacent blocks. Undo the offset/carry in each field.
      for (let phase = 0; phase < 8 && length >= 8; phase++) {
        const word = (field) => heap[((field - phase + 8) % 8) * channels];
        const low = (word(4) - (4 < phase ? 8 : 0)) & 0xffff;
        const low5 = (low + (5 < phase ? 8 : 0)) & 0xffff;
        const high =
          ((word(5) ^ low5) - (5 < phase && low > 0xfff7 ? 1 : 0)) & 0xffff;
        const block = (field) => {
          const value = low + (field < phase ? 8 : 0);
          return [value & 0xffff, (high + (value > 0xffff ? 1 : 0)) & 0xffff];
        };
        const [low2] = block(2),
          [low3, high3] = block(3);
        const id = ((word(2) ^ low2) | ((word(3) ^ low3 ^ high3) << 16)) >>> 0;
        const record = byId.get(id);
        const frame = ((low | (high << 16)) >>> 0) + phase;
        if (!record || record.sampleRate !== frequency) continue;
        if (
          Array.from({ length: 8 }, (_, at) => at).every((at) =>
            matches(record, at, frame + at),
          )
        ) {
          identified = { record, spans: [{ at: 0, frame }] };
          break;
        }
      }
    }
    if (!identified) {
      // Short loops/fragments can lack a contiguous marker altogether. Check
      // known loop tails, and every possible start within a very short loop.
      for (const record of records.values()) {
        if (!record.virtualPath || record.sampleRate !== frequency) continue;
        for (const loop of loopRanges(record)) {
          const first = Math.max(loop.start, loop.end - 12);
          for (let start = first; start < loop.end; start++) {
            const spans = [{ at: 0, frame: start }];
            let frame = start,
              at = 0;
            for (; at < length; at++, frame++) {
              if (frame === loop.end) {
                frame = loop.start;
                spans.push({ at, frame });
              }
              if (!matches(record, at, frame)) break;
            }
            if (at === length) return { record, spans };
          }
        }
      }
    }
    if (identified) {
      // Copy only frames whose tags verify. This also leaves an ambiguous
      // fragment silent if a native splice cannot be recovered exactly.
      const { record, spans } = identified;
      const verified = [];
      for (let index = 0; index < spans.length; index++) {
        let { at, frame } = spans[index];
        const end = spans[index + 1]?.at ?? length;
        let run;
        for (; at < end; at++, frame++) {
          if (!matches(record, at, frame)) {
            const loop = loopRanges(record).find(
              (loop) => frame === loop.end && matches(record, at, loop.start),
            );
            if (loop) {
              frame = loop.start;
              run = undefined;
            }
          }
          if (matches(record, at, frame)) {
            if (!run) {
              run = { at, frame, end: at };
              verified.push(run);
            }
            run.end = at + 1;
          } else run = undefined;
        }
      }
      identified.spans = verified;
    }
    return identified;
  }

  function fill(buffer, info) {
    const { record, spans } = info;
    for (let channel = 0; channel < buffer.channels; channel++) {
      const target = buffer.audioBuf.getChannelData(channel);
      target.fill(0);
      if (record.audio) {
        const source = record.audio.getChannelData(
          Math.min(channel, record.channels - 1),
        );
        for (let index = 0; index < spans.length; index++) {
          const { at, frame } = spans[index];
          const end = spans[index].end ?? spans[index + 1]?.at ?? target.length;
          const count = Math.min(end - at, source.length - frame);
          if (count <= 0) continue;
          target.set(source.subarray(frame, frame + count), at);
          if (buffer.channels === 1 && record.channels === 2) {
            const right = record.audio.getChannelData(1);
            for (let i = 0; i < count; i++) {
              target[at + i] = (target[at + i] + right[frame + i]) / 2;
            }
          }
        }
      }
    }
  }

  function detach(buffer) {
    const info = buffers.get(buffer);
    if (info) info.record.buffers.delete(buffer);
    buffers.delete(buffer);
  }

  function wrapImports(imports) {
    const env = imports.env;
    if (!env?.alBufferData || !env.alDeleteBuffers) {
      throw new Error(
        "This Browser Woditor runtime does not expose the required audio hooks.",
      );
    }
    const originalData = env.alBufferData;
    env.alBufferData = function (id, format, pointer, size, frequency) {
      const info = identify(pointer, size, frequency, format);
      const result = originalData.apply(this, arguments);
      const buffer = AL.buffers[id];
      if (buffer) {
        detach(buffer);
        if (info && buffer.audioBuf && buffer.frequency === frequency) {
          buffers.set(buffer, info);
          info.record.buffers.add(buffer);
          // Markers are never played. Pending/error buffers contain silence.
          fill(buffer, info);
        } else if (buffer.audioBuf && size < 16 * buffer.channels) {
          // A fragment shorter than eight frames may remain ambiguous.
          for (let channel = 0; channel < buffer.channels; channel++) {
            buffer.audioBuf.getChannelData(channel).fill(0);
          }
        }
      }
      return result;
    };
    const originalDelete = env.alDeleteBuffers;
    env.alDeleteBuffers = function (count, pointer) {
      const ids = new Int32Array(Module.HEAP8.buffer, pointer, count);
      const removed = Array.from(ids, (id) => AL.buffers[id]);
      const result = originalDelete.apply(this, arguments);
      for (const buffer of removed) {
        if (buffer && AL.buffers[buffer.id] !== buffer) detach(buffer);
      }
      return result;
    };
  }

  if (records.size) {
    const originalInstantiate = Module.instantiateWasm;
    Module.instantiateWasm = function (imports, receiveInstance) {
      wrapImports(imports);
      if (originalInstantiate) {
        return originalInstantiate.call(this, imports, receiveInstance);
      }
      (async () => {
        let bytes = Module.wasmBinary;
        if (!bytes) {
          const url = Module.locateFile
            ? Module.locateFile("woditor.wasm", options.exportRoot)
            : new URL("woditor.wasm", options.exportRoot).href;
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(
              `Could not load Browser Woditor. HTTP ${response.status}`,
            );
          bytes = await response.arrayBuffer();
        }
        const result = await WebAssembly.instantiate(bytes, imports);
        receiveInstance(result.instance ?? result, result.module);
      })().catch((error) => {
        Module.printErr?.(String(error));
        if (typeof abort === "function") abort(error);
        else throw error;
      });
      return {};
    };
  }

  function pending(source) {
    return (
      source.state === 4114 &&
      source.bufQueue.some(
        (buffer) => buffers.get(buffer)?.record.state === "pending",
      )
    );
  }

  async function download(record) {
    record.state = "pending";
    options.onPending(record.path, true);
    try {
      const response = await fetch(options.assetUrl(record.path));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      options.onLoad(record.path, bytes.byteLength);
      const Context =
        globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
      const decoder = new Context(record.channels, 1, record.sampleRate);
      record.audio = await decoder.decodeAudioData(bytes);
      if (
        record.audio.numberOfChannels !== record.channels ||
        record.audio.sampleRate !== record.sampleRate
      ) {
        throw new Error(
          "Decoded audio does not match its exported channel/sample-rate metadata.",
        );
      }
      record.state = "ready";
    } catch (error) {
      record.audio = null;
      record.state = "error";
      options.onError(record.path, String(error));
    } finally {
      for (const buffer of record.buffers) {
        if (AL.buffers[buffer.id] === buffer) fill(buffer, buffers.get(buffer));
      }
      options.onPending(record.path, false);
    }
  }

  function virtualFile(record) {
    if (record.virtualPath) return record.virtualPath;
    const header = new Uint8Array(record.loop ? 112 : 44);
    const view = new DataView(header.buffer);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++)
        header[offset + i] = value.charCodeAt(i);
    };
    const size = record.frames * record.channels * 2;
    text(0, "RIFF");
    view.setUint32(4, size + header.length - 8, true);
    text(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, record.channels, true);
    view.setUint32(24, record.sampleRate, true);
    view.setUint32(28, record.sampleRate * record.channels * 2, true);
    view.setUint16(32, record.channels * 2, true);
    view.setUint16(34, 16, true);
    if (record.loop) {
      text(36, "smpl");
      view.setUint32(40, 60, true);
      view.setUint32(52, Math.round(1e9 / record.sampleRate), true);
      view.setUint32(56, 60, true);
      view.setUint32(72, 1, true);
      view.setUint32(88, record.loop.start, true);
      view.setUint32(92, record.loop.end - 1, true);
    }
    text(header.length - 8, "data");
    view.setUint32(header.length - 4, size, true);
    const path = `/.wolftools-audio/${record.id}.wav`;
    FS.writeFile(path, header);
    const node = FS.lookupPath(path).node;
    // Only the header is stored. Generate tagged PCM on reads, so a long BGM
    // does not allocate a second full WAV or persist fake data in IDBFS.
    node.usedBytes = header.length + size;
    node.stream_ops = {
      ...node.stream_ops,
      read(stream, buffer, offset, length, position) {
        const count = Math.max(0, Math.min(length, node.usedBytes - position));
        for (let i = 0; i < count; i++) {
          const at = position + i;
          if (at < header.length) buffer[offset + i] = header[at];
          else {
            const pcm = at - header.length;
            const value = marker(record, Math.floor(pcm / 2));
            buffer[offset + i] = (value >>> ((pcm % 2) * 8)) & 255;
          }
        }
        return count;
      },
    };
    record.virtualPath = path;
    return path;
  }

  return {
    initialize(filesystem) {
      FS = filesystem;
      if (!records.size) return;
      AL = Module.AL;
      if (
        !AL?.scheduleSourceAudio ||
        !AL.updateSourceTime ||
        !AL.setSourceState
      ) {
        throw new Error(
          "This Browser Woditor runtime does not expose the required audio scheduler.",
        );
      }
      FS.mkdirTree("/.wolftools-audio");
      const originalSchedule = AL.scheduleSourceAudio;
      AL.scheduleSourceAudio = function (source) {
        if (pending(source)) {
          waiting.add(source);
          return;
        }
        return originalSchedule.apply(this, arguments);
      };
      const originalUpdate = AL.updateSourceTime;
      AL.updateSourceTime = function (source) {
        if (pending(source)) {
          waiting.add(source);
          return source.context.audioCtx.currentTime;
        }
        if (waiting.delete(source) && source.state === 4114) {
          // Preserve the requested seek offset, excluding time spent loading.
          source.bufStartTime = Number.NEGATIVE_INFINITY;
        }
        return originalUpdate.apply(this, arguments);
      };
      const originalState = AL.setSourceState;
      AL.setSourceState = function (source, state) {
        const result = originalState.apply(this, arguments);
        if (state !== 4114) waiting.delete(source);
        return result;
      };
    },

    resolve(requested, stored) {
      const record = records.get(stored);
      if (record) {
        const path = virtualFile(record);
        if (record.state === "idle") void download(record);
        return path;
      }
      // DxLib supports _loop.txt for all audio types. Preserve embedded Ogg
      // loop comments even though the native decoder now sees a WAV stream.
      if (!stored) {
        const loop = options
          .pathKeys(requested)
          .map((key) => loops.get(key))
          .find(Boolean);
        if (loop) {
          const path = `/.wolftools-audio/${loop.id}_loop.txt`;
          if (!FS.analyzePath(path).exists) {
            FS.writeFile(
              path,
              `LOOPSTART=${loop.loop.start}\r\nLOOPLENGTH=${loop.loop.end - loop.loop.start}\r\n`,
            );
          }
          return path;
        }
      }
    },
  };
}
