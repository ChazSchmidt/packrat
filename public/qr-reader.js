// Some exported Ratspeak QRs use rounded modules separated by small gaps.
// Close those gaps for the scanner, then retry at smaller sizes. This changes
// only temporary browser pixels, never the selected file.
function closeGaps(pixels, radius) {
  const { width, height, data } = pixels,
    n = width * height;
  let a = new Uint8Array(n),
    b = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    a[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  for (const minimum of [true, false])
    for (const horizontal of [true, false]) {
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          let best = minimum ? 255 : 0;
          for (let d = -radius; d <= radius; d++) {
            const xx = horizontal ? x + d : x,
              yy = horizontal ? y : y + d;
            if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
            const value = a[yy * width + xx];
            best = minimum ? Math.min(best, value) : Math.max(best, value);
          }
          b[y * width + x] = best;
        }
      [a, b] = [b, a];
    }
  const result = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    result[i * 4] = result[i * 4 + 1] = result[i * 4 + 2] = a[i];
    result[i * 4 + 3] = 255;
  }
  return result;
}
export async function readContactQr(source) {
  let canvas = document.createElement('canvas'),
    scale = Math.min(1, 1200 / Math.max(source.width, source.height));
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  for (let level = 0; level < 4; level++) {
    const pixels = canvas
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
    const direct = jsQR(pixels.data, pixels.width, pixels.height);
    if (direct) return direct.data;
    for (const radius of [1, 2]) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const found = jsQR(closeGaps(pixels, radius), pixels.width, pixels.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (found) return found.data;
    }
    if (Math.max(canvas.width, canvas.height) <= 300) break;
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.floor(canvas.width / 2));
    smaller.height = Math.max(1, Math.floor(canvas.height / 2));
    smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
  }
  return null;
}
