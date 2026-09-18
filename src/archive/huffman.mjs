class HeaderBitReader {
  constructor(source) {
    this.source = source;
    this.byteOffset = 0;
    this.bitOffset = 0;
  }

  read(bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 0 || bitCount > 53) {
      throw new Error("The Huffman header contains an invalid bit count.");
    }
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      if (this.byteOffset >= this.source.length) {
        throw new Error("The Huffman header ended unexpectedly.");
      }
      value = value * 2 + ((this.source[this.byteOffset] >>> (7 - this.bitOffset)) & 1);
      this.bitOffset += 1;
      if (this.bitOffset === 8) {
        this.byteOffset += 1;
        this.bitOffset = 0;
      }
    }
    return value;
  }

  bytesRead() {
    return this.byteOffset + (this.bitOffset === 0 ? 0 : 1);
  }
}

function parseHeader(source) {
  const bits = new HeaderBitReader(source);
  const originalBits = bits.read(6) + 1;
  const originalSize = bits.read(originalBits);
  const compressedBits = bits.read(6) + 1;
  const compressedSize = bits.read(compressedBits);
  const weights = new Array(256);

  for (let index = 0; index < weights.length; index += 1) {
    const bitCount = (bits.read(3) + 1) * 2;
    const minus = bits.read(1) === 1;
    const delta = bits.read(bitCount);
    const previous = index === 0 ? 0 : weights[index - 1];
    weights[index] = (previous + (minus ? -delta : delta)) & 0xffff;
  }

  const headerSize = bits.bytesRead();
  if (!Number.isSafeInteger(originalSize) || !Number.isSafeInteger(compressedSize)) {
    throw new Error("The Huffman stream is too large.");
  }
  if (headerSize + compressedSize > source.length) {
    throw new Error("The Huffman stream ended before its declared size.");
  }
  return { originalSize, compressedSize, weights, headerSize };
}

function createTree(weights) {
  const nodes = Array.from({ length: 511 }, (_, index) => ({
    weight: index < 256 ? weights[index] : 0,
    parent: -1,
    children: [-1, -1],
  }));

  let activeCount = 256;
  let nextNode = 256;
  while (activeCount > 1) {
    let first = -1;
    let second = -1;
    let seen = 0;
    for (let nodeIndex = 0; seen < activeCount; nodeIndex += 1) {
      const node = nodes[nodeIndex];
      if (!node || node.parent !== -1) continue;
      seen += 1;
      if (first === -1 || nodes[first].weight > node.weight) {
        second = first;
        first = nodeIndex;
      } else if (second === -1 || nodes[second].weight > node.weight) {
        second = nodeIndex;
      }
    }
    if (first === -1 || second === -1 || nextNode >= nodes.length) {
      throw new Error("The Huffman tree is invalid.");
    }
    nodes[nextNode].weight = (nodes[first].weight + nodes[second].weight) >>> 0;
    nodes[nextNode].children = [first, second];
    nodes[first].parent = nextNode;
    nodes[second].parent = nextNode;
    nextNode += 1;
    activeCount -= 1;
  }
  return nodes;
}

export function inspectHuffman(source) {
  const { originalSize, compressedSize, headerSize } = parseHeader(source);
  return { originalSize, compressedSize, headerSize };
}

export function decodeHuffman(source, expectedSize) {
  const { originalSize, compressedSize, weights, headerSize } = parseHeader(source);
  if (expectedSize !== undefined && originalSize !== expectedSize) {
    throw new Error("The Huffman data size does not match its file header.");
  }
  const output = Buffer.alloc(originalSize);
  if (originalSize === 0) return output;

  const nodes = createTree(weights);
  const data = source.subarray(headerSize, headerSize + compressedSize);
  let bitPosition = 0;
  for (let outputOffset = 0; outputOffset < output.length; outputOffset += 1) {
    let nodeIndex = 510;
    while (nodeIndex > 255) {
      if (bitPosition >= data.length * 8) {
        throw new Error("The Huffman data ended before reaching its declared size.");
      }
      const branch = (data[bitPosition >>> 3] >>> (bitPosition & 7)) & 1;
      bitPosition += 1;
      nodeIndex = nodes[nodeIndex].children[branch];
      if (nodeIndex < 0 || nodeIndex >= nodes.length) {
        throw new Error("The Huffman data contains an invalid tree path.");
      }
    }
    output[outputOffset] = nodeIndex;
  }
  return output;
}
