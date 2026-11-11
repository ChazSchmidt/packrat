import { hammingEncode, hammingDecode, inspectPacket, packetLength } from './codec.js';
const REPEAT = 3;
function parameters(image) {
  const capacity = image.width * image.height * 3;
  const gcd = (a, b) => {
    while (b) {
      [a, b] = [b, a % b];
    }
    return a;
  };
  let stride = Math.floor(capacity / 2) | 1;
  while (gcd(stride, capacity) !== 1) stride += 2;
  const start =
    ((Math.imul(image.width, 73856093) ^ Math.imul(image.height, 19349663) ^ 0x4c534231) >>> 0) %
    capacity;
  return { capacity, stride, start };
}
function rgba(slot) {
  return Math.floor(slot / 3) * 4 + (slot % 3);
}
export function embedLsb(image, packet) {
  const { capacity, stride, start } = parameters(image),
    bits = hammingEncode(packet);
  if (bits.length * REPEAT > capacity)
    throw new Error('Choose a larger image to fit this data without changing its dimensions.');
  for (let i = 0; i < bits.length; i++)
    for (let r = 0; r < REPEAT; r++) {
      const p = rgba((start + (i * REPEAT + r) * stride) % capacity);
      image.data[p] = (image.data[p] & 254) | bits[i];
    }
  return image;
}
export function extractLsb(image) {
  const { capacity, stride, start } = parameters(image),
    bits = [];
  function read(bytes) {
    const count = bytes * 14;
    if (count * REPEAT > capacity) throw new Error('Image too small.');
    for (let i = bits.length; i < count; i++) {
      let votes = 0;
      for (let r = 0; r < REPEAT; r++)
        votes += image.data[rgba((start + (i * REPEAT + r) * stride) % capacity)] & 1;
      bits.push(votes >= 2 ? 1 : 0);
    }
    return hammingDecode(bits);
  }
  const header = read(8).data;
  if (![82, 83, 83, 84].every((b, i) => header[i] === b)) throw new Error('No subtle packet.');
  const result = read(packetLength(header));
  return { ...inspectPacket(result.data), corrected: result.corrected, codec: 'subtle' };
}
