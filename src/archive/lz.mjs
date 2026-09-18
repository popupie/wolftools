const MIN_COMPRESS = 4;

export function decodeLz(source, expectedSize) {
  if (source.length < 9) throw new Error("The compressed DX data is too short.");
  const destinationSize = source.readUInt32LE(0);
  const encodedSize = source.readUInt32LE(4);
  if (encodedSize < 9 || encodedSize > source.length) {
    throw new Error("The compressed DX data length is invalid.");
  }
  if (expectedSize !== undefined && destinationSize !== expectedSize) {
    throw new Error("The compressed DX data size does not match its file header.");
  }

  const keyCode = source[8];
  const output = Buffer.alloc(destinationSize);
  let sourceOffset = 9;
  let outputOffset = 0;

  while (sourceOffset < encodedSize) {
    const first = source[sourceOffset];
    if (first !== keyCode) {
      if (outputOffset >= output.length) throw new Error("DX data expands beyond its declared size.");
      output[outputOffset] = first;
      outputOffset += 1;
      sourceOffset += 1;
      continue;
    }

    if (sourceOffset + 1 >= encodedSize) throw new Error("DX data ends inside a copy code.");
    if (source[sourceOffset + 1] === keyCode) {
      if (outputOffset >= output.length) throw new Error("DX data expands beyond its declared size.");
      output[outputOffset] = keyCode;
      outputOffset += 1;
      sourceOffset += 2;
      continue;
    }

    let code = source[sourceOffset + 1];
    if (code > keyCode) code -= 1;
    sourceOffset += 2;

    let copyLength = code >>> 3;
    if ((code & 4) !== 0) {
      if (sourceOffset >= encodedSize) throw new Error("DX data ends inside a copy length.");
      copyLength |= source[sourceOffset] << 5;
      sourceOffset += 1;
    }
    copyLength += MIN_COMPRESS;

    const indexSize = code & 3;
    if (indexSize === 3 || sourceOffset + indexSize >= encodedSize) {
      throw new Error("DX data contains an invalid copy distance.");
    }
    let distance = source[sourceOffset];
    if (indexSize >= 1) distance |= source[sourceOffset + 1] << 8;
    if (indexSize === 2) distance |= source[sourceOffset + 2] << 16;
    sourceOffset += indexSize + 1;
    distance += 1;

    if (distance > outputOffset || outputOffset + copyLength > output.length) {
      throw new Error("DX data contains an out of range copy.");
    }
    for (let index = 0; index < copyLength; index += 1) {
      output[outputOffset] = output[outputOffset - distance];
      outputOffset += 1;
    }
  }

  if (outputOffset !== output.length) throw new Error("DX data ended before reaching its declared size.");
  return output;
}
