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

// --- Draw GramVault icon (padlock + G + squiggle) ---
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

  // Anti-aliased partial arc
  function strokeArc(cx, cy, radius, startAngle, sweepAngle, lw, r, g, b, a = 255) {
    const steps = Math.max(8, Math.ceil(Math.abs(sweepAngle) * radius * 2));
    for (let i = 0; i < steps; i++) {
      const a1 = startAngle + sweepAngle * (i / steps);
      const a2 = startAngle + sweepAngle * ((i + 1) / steps);
      strokeLine(
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius,
        cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius,
        lw, r, g, b, a
      );
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
  const bgRad = Math.round(s * 0.1875); // 24/128

  // Background gradient: #4338ca → #1e1b4b (indigo → deep navy)
  for (let y = 0; y < s; y++) {
    const t = y / s;
    const br = Math.round(67 * (1 - t) + 30 * t);
    const bg = Math.round(56 * (1 - t) + 27 * t);
    const bb = Math.round(202 * (1 - t) + 75 * t);
    for (let x = 0; x < s; x++) {
      const idx = (y * s + x) * 4;
      px[idx] = br; px[idx+1] = bg; px[idx+2] = bb; px[idx+3] = 0;
    }
  }

  // Clip background to rounded rect (set alpha)
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = Math.max(bgRad - x, 0, x - (s - bgRad));
      const dy = Math.max(bgRad - y, 0, y - (s - bgRad));
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, bgRad - dist + 0.5));
      px[(y * s + x) * 4 + 3] = Math.round(255 * alpha);
    }
  }

  // ── Padlock design ──
  // All coordinates in SVG space (128×128), scaled by s/128

  const P = v => v * s / 128; // scale from 128-space
  const slw = P(size <= 16 ? 9 : 6.5); // stroke line width

  // --- Shackle (U-arch at top) ---
  const shX1 = P(42), shX2 = P(86);
  const shTop = P(40), shBot = P(60);
  const shCx = (shX1 + shX2) / 2;
  const shR  = (shX2 - shX1) / 2;

  strokeLine(shX1, shBot, shX1, shTop, slw, 255, 255, 255, 230);
  strokeLine(shX2, shBot, shX2, shTop, slw, 255, 255, 255, 230);
  // Arc from left (π) sweeping -π (counterclockwise) to right (0)
  strokeArc(shCx, shTop, shR, Math.PI, -Math.PI, slw, 255, 255, 255, 230);

  // --- Padlock body fill (low opacity) ---
  const bx = P(22), by = P(54), bw = P(84), bh = P(62), br = P(13);
  for (let y = Math.floor(by); y < Math.ceil(by + bh); y++) {
    for (let x = Math.floor(bx); x < Math.ceil(bx + bw); x++) {
      const dx = Math.max(bx + br - x, 0, x - (bx + bw - br));
      const dy = Math.max(by + br - y, 0, y - (by + bh - br));
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, br - dist + 0.5));
      if (alpha > 0) setPixel(x, y, 255, 255, 255, Math.round(33 * alpha));
    }
  }

  // --- Padlock body stroke ---
  if (size >= 24) {
    // 4 straight sides
    strokeLine(bx + br, by,      bx + bw - br, by,      slw, 255, 255, 255, 230); // top
    strokeLine(bx + br, by + bh, bx + bw - br, by + bh, slw, 255, 255, 255, 230); // bottom
    strokeLine(bx,      by + br, bx,      by + bh - br,  slw, 255, 255, 255, 230); // left
    strokeLine(bx + bw, by + br, bx + bw, by + bh - br,  slw, 255, 255, 255, 230); // right
    // 4 corner arcs (each sweeps -π/2 counterclockwise)
    strokeArc(bx + br,      by + br,      br, Math.PI,       -Math.PI / 2, slw, 255, 255, 255, 230);
    strokeArc(bx + bw - br, by + br,      br, -Math.PI / 2,  -Math.PI / 2, slw, 255, 255, 255, 230);
    strokeArc(bx + bw - br, by + bh - br, br, 0,             -Math.PI / 2, slw, 255, 255, 255, 230);
    strokeArc(bx + br,      by + bh - br, br, Math.PI / 2,   -Math.PI / 2, slw, 255, 255, 255, 230);
  } else {
    // Small sizes: just stroke circle as approximation
    strokeCircle(bx + bw / 2, by + bh / 2, bw * 0.42, slw, 255, 255, 255, 180);
  }

  // --- Bold G letterform ---
  // Center (60,83)/128, radius 17/128, arc from ~-52° counterclockwise (long way) to 0°
  const gCx = P(60), gCy = P(83), gR = P(17);
  const glw = P(size <= 16 ? 10 : 8);

  const gStart = -0.291 * Math.PI;                        // upper-right ~-52°
  const gSweep = -(2 * Math.PI - 0.291 * Math.PI);        // long CCW arc → ends at 0° (right)
  strokeArc(gCx, gCy, gR, gStart, gSweep, glw, 255, 255, 255, 255);

  // G crossbar: from right of arc (gCx+gR) leftward to center
  if (size >= 20) {
    strokeLine(gCx + gR, gCy, gCx + gR * 0.18, gCy, glw, 255, 255, 255, 255);
  }

  // --- Cyan squiggly grammar line ---
  if (size >= 32) {
    const wY  = P(100);
    const wX0 = P(32), wX1 = P(96);
    const wAmp = P(8);
    const wLw = P(size <= 48 ? 5 : 4);
    const wSteps = 80;
    for (let i = 0; i < wSteps; i++) {
      const t1 = i / wSteps, t2 = (i + 1) / wSteps;
      strokeLine(
        wX0 + (wX1 - wX0) * t1, wY + Math.sin(t1 * Math.PI * 4) * wAmp,
        wX0 + (wX1 - wX0) * t2, wY + Math.sin(t2 * Math.PI * 4) * wAmp,
        wLw, 103, 232, 249, 215
      );
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
