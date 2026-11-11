// Low-amplitude DCT quantization experiment. Packet framing/ECC stay unchanged.
import { hammingEncode, hammingDecode, inspectPacket, packetLength } from './codec.js';
const STEP = 18,
  REPEAT = 3;
const bases = [
  [1, 2],
  [2, 1],
].map(([u, v]) =>
  Float64Array.from(
    { length: 64 },
    (_, p) =>
      0.25 *
      Math.cos(((2 * (p % 8) + 1) * u * Math.PI) / 16) *
      Math.cos(((2 * Math.floor(p / 8) + 1) * v * Math.PI) / 16),
  ),
);
function slots(w, h) {
  const count = Math.floor(w / 8) * Math.floor(h / 8),
    order = Uint32Array.from({ length: count }, (_, i) => i);
  let seed = 0x44535431;
  for (let i = count - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
function coefficient(image, block, basis) {
  const cols = Math.floor(image.width / 8),
    bx = (block % cols) * 8,
    by = Math.floor(block / cols) * 8;
  let value = 0;
  for (let p = 0; p < 64; p++) {
    const index = ((by + Math.floor(p / 8)) * image.width + bx + (p % 8)) * 4;
    value +=
      (0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2]) *
      basis[p];
  }
  return value;
}
export function embedDct(image, packet, step = STEP) {
  const order = slots(image.width, image.height),
    bits = hammingEncode(packet),
    cols = Math.floor(image.width / 8);
  if (bits.length * REPEAT > order.length) throw new Error('Image too small for this codec.');
  for (let bit = 0; bit < bits.length; bit++)
    for (let r = 0; r < REPEAT; r++) {
      const block = order[bit * REPEAT + r],
        basis = bases[block % 2],
        original = coefficient(image, block, basis);
      let index = Math.round(original / step);
      if (((index % 2) + 2) % 2 !== bits[bit]) index += original / step >= index ? 1 : -1;
      const target = index * step,
        bx = (block % cols) * 8,
        by = Math.floor(block / cols) * 8;
      for (let pass = 0; pass < 6; pass++) {
        const delta = target - coefficient(image, block, basis);
        if (Math.abs(delta) < 0.8) break;
        for (let p = 0; p < 64; p++) {
          const index = ((by + Math.floor(p / 8)) * image.width + bx + (p % 8)) * 4;
          for (let c = 0; c < 3; c++)
            image.data[index + c] = Math.max(
              0,
              Math.min(255, Math.round(image.data[index + c] + delta * basis[p])),
            );
        }
      }
    }
  return image;
}
export function extractDct(image, step = STEP) {
  const order = slots(image.width, image.height),
    bits = [];
  function read(bytes) {
    const n = bytes * 14;
    if (n * REPEAT > order.length) throw new Error('Image too small.');
    for (let i = bits.length; i < n; i++) {
      let votes = 0;
      for (let r = 0; r < REPEAT; r++) {
        const block = order[i * REPEAT + r],
          q = Math.round(coefficient(image, block, bases[block % 2]) / step);
        votes += ((q % 2) + 2) % 2;
      }
      bits.push(votes >= 2 ? 1 : 0);
    }
    return hammingDecode(bits);
  }
  const head = read(8).data;
  if (![82, 83, 83, 84].every((b, i) => head[i] === b)) throw new Error('No DCT packet.');
  const length = packetLength(head);
  const result = read(length);
  return { ...inspectPacket(result.data), corrected: result.corrected, codec: 'dct' };
}
