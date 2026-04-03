// Minimal PNG icon generator — pure Node.js, no dependencies
// Generates GramVault icons at 16x16, 48x48, 128x128

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// --- Minimal PNG writer ---
function writePNG(width, height, pixels) {
  // pixels: Uint8Array of RGBA values, row by row
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcData = Buffer.concat([t, data]);
    const crc = crc32(crcData);
    const crcBuf = Buffer.alloc(4); crcBuf.writeInt32BE(crc);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  function crc32(buf) {
    let crc = -1;
    const table = crc32.table || (crc32.table = (() => {
      const t = new Int32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })());
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }
  // Fix: make crc return signed int for PNG
  function crc32signed(buf) {
    const v = crc32(buf);
    return v > 0x7fffffff ? v - 0x100000000 : v;
  }
  function chunk2(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcData = Buffer.concat([t, data]);
    const v = crc32(Buffer.concat([t, data]));
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(v);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB (no alpha for simplicity... actually use 6 = RGBA)
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data: filter byte + row data
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter type None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]);
    }
  }
  const rawBuf = Buffer.from(raw);
  const compressed = zlib.deflateSync(rawBuf);

  return Buffer.concat([
    PNG_SIG,
    chunk2('IHDR', ihdr),
    chunk2('IDAT', compressed),
    chunk2('IEND', Buffer.alloc(0)),
  ]);
}

// --- Draw GramVault icon ---
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blend over existing
    const aa = a / 255;
    const ra = 1 - aa;
    px[i]   = Math.round(r * aa + px[i]   * ra);
    px[i+1] = Math.round(g * aa + px[i+1] * ra);
    px[i+2] = Math.round(b * aa + px[i+2] * ra);
    px[i+3] = Math.min(255, px[i+3] + a);
  }

  function fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        setPixel(x, y, r, g, b, a);
  }

  // Anti-aliased circle draw (filled)
  function fillCircle(cx, cy, radius, r, g, b, a = 255) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++) {
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const alpha = Math.max(0, Math.min(1, radius - dist + 0.5));
        if (alpha > 0) setPixel(x, y, r, g, b, Math.round(a * alpha));
      }
    }
  }

  // Anti-aliased circle stroke
  function strokeCircle(cx, cy, radius, lw, r, g, b, a = 255) {
    const outer = radius + lw / 2;
    const inner = radius - lw / 2;
    for (let y = Math.floor(cy - outer - 1); y <= Math.ceil(cy + outer + 1); y++) {
      for (let x = Math.floor(cx - outer - 1); x <= Math.ceil(cx + outer + 1); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const alpha = Math.max(0, Math.min(1, outer - dist + 0.5)) * Math.max(0, Math.min(1, dist - inner + 0.5));
        if (alpha > 0) setPixel(x, y, r, g, b, Math.round(a * alpha));
      }
    }
  }

  // Anti-aliased line
  function strokeLine(x0, y0, x1, y1, lw, r, g, b, a = 255) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px2 = x0 + dx * t, py2 = y0 + dy * t;
      fillCircle(px2, py2, lw / 2, r, g, b, a);
    }
  }

  // Rounded rectangle background
  function fillRoundedRect(x0, y0, w, h, radius, r, g, b, a = 255) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        // Check corners
        let inCorner = false;
        const corners = [
          [x0 + radius, y0 + radius],
          [x0 + w - radius, y0 + radius],
          [x0 + radius, y0 + h - radius],
          [x0 + w - radius, y0 + h - radius],
        ];
        let inAnyCornerRegion = false;
        for (const [cx, cy] of corners) {
          if (Math.abs(x - cx) > radius || Math.abs(y - cy) > radius) continue;
          inAnyCornerRegion = true;
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          const alpha = Math.max(0, Math.min(1, radius - dist + 0.5));
          if (alpha > 0) setPixel(x, y, r, g, b, Math.round(a * alpha));
          inCorner = true;
          break;
        }
        if (!inCorner) setPixel(x, y, r, g, b, a);
      }
    }
  }

  const s = size;
  const rad = Math.round(s * 0.18);

  // Draw gradient background (approximated as two-tone)
  for (let y = 0; y < s; y++) {
    const t = y / s;
    const r = Math.round(49 * (1 - t) + 30 * t);
    const g = Math.round(46 * (1 - t) + 27 * t);
    const bl = Math.round(129 * (1 - t) + 75 * t);
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      px[i] = r; px[i+1] = g; px[i+2] = bl; px[i+3] = 0;
    }
  }

  // Clip to rounded rect (set alpha)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const inR = (() => {
        if (x >= rad && x < s - rad) return true;
        if (y >= rad && y < s - rad) return true;
        const corners = [[rad, rad], [s - rad, rad], [rad, s - rad], [s - rad, s - rad]];
        for (const [cx, cy] of corners) {
          if (x < rad && y < rad && !(x === corners[0][0] && y === corners[0][1])) {
            // handled below
          }
        }
        const dx = Math.max(rad - x, 0, x - (s - rad));
        const dy = Math.max(rad - y, 0, y - (s - rad));
        return Math.sqrt(dx * dx + dy * dy) <= rad;
      })();
      const dist = (() => {
        const dx = Math.max(rad - x, 0, x - (s - rad));
        const dy = Math.max(rad - y, 0, y - (s - rad));
        return Math.sqrt(dx * dx + dy * dy);
      })();
      const alpha = Math.max(0, Math.min(1, rad - dist + 0.5));
      const i = (y * s + x) * 4;
      px[i + 3] = Math.round(255 * alpha);
    }
  }

  // ── New design: vault ring + bold G + squiggle ──
  const cx = s * 0.5;
  const cy = s * 0.47;
  const vaultR = s * 0.36;   // vault ring radius
  const lw = s * 0.07;        // vault ring stroke width

  // Gradient: approximate #4338ca → #1e1b4b top-to-bottom
  for (let y = 0; y < s; y++) {
    const t = y / s;
    const r2 = Math.round(67 * (1 - t) + 30 * t);
    const g2 = Math.round(56 * (1 - t) + 27 * t);
    const b2 = Math.round(202 * (1 - t) + 75 * t);
    for (let x = 0; x < s; x++) {
      const i2 = (y * s + x) * 4;
      px[i2] = r2; px[i2 + 1] = g2; px[i2 + 2] = b2;
      // alpha already set by rounded-rect clip above
    }
  }

  // Vault ring (low opacity)
  strokeCircle(cx, cy, vaultR, lw, 255, 255, 255, 50);

  // 4 cardinal spokes (outside ring edge, short lines)
  const spokeInner = vaultR + lw * 0.6;
  const spokeOuter = vaultR + lw * 1.8;
  if (size >= 32) {
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 - Math.PI / 2;
      strokeLine(
        cx + Math.cos(angle) * spokeInner, cy + Math.sin(angle) * spokeInner,
        cx + Math.cos(angle) * spokeOuter, cy + Math.sin(angle) * spokeOuter,
        lw * 0.55, 255, 255, 255, 130
      );
    }
    // Handle knob right side
    strokeCircle(cx + vaultR + lw * 2.8, cy, lw * 0.9, lw * 0.5, 255, 255, 255, 165);
  }

  // Bold "G" letterform — drawn as arc + crossbar
  // The G arc: a circle from ~top-right, sweeping ~300° counter-clockwise
  const gCx = cx + s * 0.04;   // slightly right of centre
  const gCy = cy;
  const gR = s * 0.22;
  const glw = s * (size <= 16 ? 0.09 : 0.075);

  // Draw arc by sampling points (300° sweep, starting from 11 o'clock going clockwise)
  const startAngle = -Math.PI * 0.72;   // ~top-right
  const endAngle   = Math.PI * 0.72;    // ~bottom-right (same X, mirrored)
  const arcSteps = Math.ceil(gR * 6);
  for (let i = 0; i < arcSteps; i++) {
    const t = i / arcSteps;
    const a1 = startAngle + (endAngle - startAngle) * t;
    const a2 = startAngle + (endAngle - startAngle) * (i + 1) / arcSteps;
    strokeLine(
      gCx + Math.cos(a1) * gR, gCy + Math.sin(a1) * gR,
      gCx + Math.cos(a2) * gR, gCy + Math.sin(a2) * gR,
      glw, 255, 255, 255, 255
    );
  }

  // G crossbar: horizontal line from centre-right of G inward
  if (size >= 24) {
    const crossY = gCy;
    const crossX0 = gCx + gR * 0.08;
    const crossX1 = gCx + gR * 0.95;
    strokeLine(crossX0, crossY, crossX1, crossY, glw, 255, 255, 255, 255);
  }

  // Squiggly grammar underline — cyan (#67e8f9 = 103,232,249)
  if (size >= 32) {
    const waveY  = cy + s * 0.38;
    const waveX0 = cx - s * 0.32;
    const waveX1 = cx + s * 0.32;
    const waveAmp = s * 0.055;
    const waveSteps = 120;
    const waveLw = s * (size <= 32 ? 0.06 : 0.04);
    for (let i = 0; i < waveSteps; i++) {
      const t1 = i / waveSteps;
      const t2 = (i + 1) / waveSteps;
      const x1 = waveX0 + (waveX1 - waveX0) * t1;
      const x2 = waveX0 + (waveX1 - waveX0) * t2;
      const y1 = waveY + Math.sin(t1 * Math.PI * 4) * waveAmp;
      const y2 = waveY + Math.sin(t2 * Math.PI * 4) * waveAmp;
      strokeLine(x1, y1, x2, y2, waveLw, 103, 232, 249, 220);
    }
  }

  return writePNG(size, size, px);
}

const outDir = path.join(__dirname, 'icons');
[16, 48, 128].forEach(size => {
  const png = drawIcon(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
});
console.log('Done!');
