// generate-icons.js — genera icon-192.png e icon-512.png sin dependencias externas
// Usa solo módulos built-in de Node.js (zlib, fs, path)

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 (requerido por el formato PNG) ───────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeB = Buffer.from(type, 'ascii');
  const lenB  = Buffer.allocUnsafe(4);
  lenB.writeUInt32BE(data.length);
  const crcB  = Buffer.allocUnsafe(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([lenB, typeB, data, crcB]);
}

// ── Bitmap letra "J" (7 × 10) ─────────────────────────────────────────────────
const J = [
  [0,1,1,1,1,1,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [0,0,0,1,0,0,0],
  [1,0,0,1,0,0,0],
  [1,0,0,1,0,0,0],
  [0,1,1,0,0,0,0],
  [0,0,0,0,0,0,0],
];

function generateIcon(size) {
  const W = size, H = size;

  // Fondo: #E63946 → rgb(230, 57, 70)
  const pixels = new Uint8Array(W * H * 3).fill(0);
  for (let i = 0; i < W * H; i++) {
    pixels[i * 3]     = 230;
    pixels[i * 3 + 1] = 57;
    pixels[i * 3 + 2] = 70;
  }

  // Escalar la J al 55% del ícono
  const scale  = Math.max(1, Math.floor(size * 0.55 / 10));
  const lW     = 7 * scale;
  const lH     = 10 * scale;
  const ox     = Math.floor((W - lW) / 2);
  const oy     = Math.floor((H - lH) / 2);

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 7; col++) {
      if (!J[row][col]) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = ox + col * scale + sx;
          const py = oy + row * scale + sy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const idx = (py * W + px) * 3;
          pixels[idx]     = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
        }
      }
    }
  }

  // Construir scanlines PNG (filtro None = 0x00 + RGB por fila)
  const scanlines = Buffer.allocUnsafe(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    scanlines[y * (1 + W * 3)] = 0; // filtro None
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 3;
      const d = y * (1 + W * 3) + 1 + x * 3;
      scanlines[d]     = pixels[s];
      scanlines[d + 1] = pixels[s + 1];
      scanlines[d + 2] = pixels[s + 2];
    }
  }

  const idat = zlib.deflateSync(scanlines, { level: 9 });

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // firma PNG
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const outPath = path.join(__dirname, '..', 'public', `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ icon-${size}.png generado (${Math.round(png.length / 1024)} KB)`);
}

generateIcon(192);
generateIcon(512);
