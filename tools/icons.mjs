// Draws the app icons from the Game Night Madness mark (the purple bracket with a game piece).
// Run: node tools/icons.mjs   (needs sharp: npm i sharp, or a global install)
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
function loadSharp() {
  for (const p of ['sharp', process.env.SHARP_MODULE, '/home/claude/.npm-global/lib/node_modules/sharp'].filter(Boolean)) {
    try { return require(p); } catch (e) {}
  }
  throw new Error('sharp not found: npm install sharp (or set SHARP_MODULE)');
}
const sharp = loadSharp();
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'icons');
fs.mkdirSync(OUT, {recursive: true});

const PURPLE = '#5B3FD0';
// The mark on a 32-unit grid, centred on (16, 16): a bracket line feeding into a game piece.
const GLYPH = '<path d="M6.5 9.5h6.5v13H6.5M13 16h6.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23.6" cy="16" r="3.4" fill="#fff"/>';

/* rounded: rounded square on a clear background (browsers' install dialogs, desktop)
   full: edge-to-edge square, for phones that cut their own icon shape (iPhone, Android "maskable")
   scale: glyph size; maskable icons keep it inside the central 80% circle that Android never crops */
function svg(px, {rounded, scale}) {
  const bg = rounded ? `<rect width="32" height="32" rx="8" fill="${PURPLE}"/>` : `<rect width="32" height="32" fill="${PURPLE}"/>`;
  const g = scale === 1 ? GLYPH : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${GLYPH}</g>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">${bg}${g}</svg>`);
}
const ICONS = [
  ['icon-192.png', 192, {rounded: true, scale: 1}],
  ['icon-512.png', 512, {rounded: true, scale: 1}],
  ['icon-maskable-512.png', 512, {rounded: false, scale: 0.8}],
  ['apple-touch-icon.png', 180, {rounded: false, scale: 0.86}]
];
for (const [name, px, opts] of ICONS) {
  let img = sharp(svg(px, opts));
  if (!opts.rounded) img = img.flatten({background: PURPLE}); // iPhone fills see-through corners with black
  await img.png({compressionLevel: 9}).toFile(path.join(OUT, name));
  const m = await sharp(path.join(OUT, name)).metadata();
  console.log(name, m.width + 'x' + m.height, m.hasAlpha ? 'with transparency' : 'opaque', fs.statSync(path.join(OUT, name)).size + ' bytes');
}
