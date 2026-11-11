import { embed as embedLegacy, extract as extractLegacy } from './codec.js';
import { embedLsb, extractLsb } from './lsb-codec.js';
import { embedDct, extractDct } from './dct-codec.js';
export function embed(image, packet, method = 'subtle') {
  if (method === 'subtle') return embedLsb(image, packet);
  if (method === 'jpeg') return embedDct(image, packet);
  if (method === 'legacy') return embedLegacy(image, packet);
  throw new Error('Unknown image encoding method.');
}
export function extract(image) {
  const failures = [];
  for (const read of [extractLsb, extractDct, extractLegacy])
    try {
      return read(image);
    } catch (error) {
      failures.push(error);
    }
  throw (
    failures.find((error) => /damaged|incomplete|unsupported/.test(error.message)) ||
    new Error('No hidden contact or paper message found. Try the original image file.')
  );
}
