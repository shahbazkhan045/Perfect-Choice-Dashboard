/*
 * Both brand PNGs ship with an opaque white plate. On a dark top bar that
 * reads as a white rectangle, and — more importantly — a CSS drop-shadow
 * glow follows the alpha channel, so a fully opaque image glows as a
 * rectangle instead of as the logo's own silhouette.
 *
 * The two logos need different treatment, because white means different
 * things in each:
 *
 *   - The Justlife droplet is a single cyan shape with a counter punched
 *     through it. Every white pixel, inside or out, is background. So alpha
 *     comes straight from how far the pixel is from white ("luminance").
 *
 *   - The Perfect Choice cloud has white DRAWN ON IT — the "pc" letters and
 *     the sparkles. Those have to stay white and opaque, or they turn into
 *     dark holes on a dark top bar and the logo stops matching the brand.
 *     So only white that is reachable from the edge of the canvas is
 *     cleared ("flood"), found by a flood fill from the border.
 *
 * Both modes feather the boundary rather than hard-cutting it: an edge pixel
 * is brand-mixed-with-white, so its alpha is set to its coverage AND its
 * colour is un-mixed back toward the solid brand colour. Skipping that
 * second step leaves a pale fringe around every curve once alpha drops.
 *
 * Idempotent: it always re-reads the pristine source from assets/, so it can
 * be re-run safely. Run: node scripts/make-logo-alpha.mjs
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCES = [
  {
    from: 'assets/justlife-mark-src.png',
    to: 'public/justlife-mark.png',
    brand: [0, 195, 255],
    mode: 'luminance',
  },
  {
    from: 'assets/perfect-choice-mark-src.png',
    to: 'public/perfect-choice-mark.png',
    brand: [0, 148, 218],
    mode: 'flood',
  },
];

/** Pixels that are near-white AND reachable from the canvas edge. */
function findExterior(data, width, height) {
  const outside = new Uint8Array(width * height);
  const isNearWhite = (p) =>
    data[p * 4] > 228 && data[p * 4 + 1] > 228 && data[p * 4 + 2] > 228;

  const stack = [];
  for (let x = 0; x < width; x++) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }

  while (stack.length) {
    const p = stack.pop();
    if (outside[p] || !isNearWhite(p)) continue;
    outside[p] = 1;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }
  return outside;
}

for (const { from, to, brand, mode } of SOURCES) {
  const { data, info } = await sharp(await readFile(from))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const span = 765 - (brand[0] + brand[1] + brand[2]);
  // In flood mode, only pixels adjacent to the exterior are allowed to
  // feather — that is the real boundary of the shape.
  const outside = mode === 'flood' ? findExterior(data, width, height) : null;
  const touchesOutside = (p) => {
    const x = p % width;
    const y = (p - x) / width;
    return (
      (x > 0 && outside[p - 1]) ||
      (x < width - 1 && outside[p + 1]) ||
      (y > 0 && outside[p - width]) ||
      (y < height - 1 && outside[p + width])
    );
  };

  let cleared = 0;
  let feathered = 0;

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const distance = 765 - (data[i] + data[i + 1] + data[i + 2]);
    const coverage = Math.min(1, Math.max(0, distance / span));

    const eligible = mode === 'luminance' || outside[p] || touchesOutside(p);
    if (!eligible) continue; // interior white — the "pc" and the sparkles

    const alpha = Math.round(coverage * 255);
    if (alpha === 0) {
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = 0;
      cleared++;
      continue;
    }
    if (alpha < 250) feathered++;

    for (let c = 0; c < 3; c++) {
      const unmixed = (data[i + c] - 255 * (1 - coverage)) / coverage;
      data[i + c] = Math.max(0, Math.min(255, Math.round(unmixed)));
    }
    data[i + 3] = alpha;
  }

  const out = await sharp(data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(to, out);
  console.log(
    `${to}: ${width}x${height} ${mode} — ${cleared} px cleared ` +
      `(${((cleared / (width * height)) * 100).toFixed(1)}%), ${feathered} feathered, ` +
      `${Math.round(out.length / 1024)}KB`,
  );
}
