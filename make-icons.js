// Minimal PNG icon generator — pure Node.js, no dependencies
// Generates GramVault icons at 16x16, 48x48, 128x128

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// --- Minimal PNG writer ---
function writePNG(width, height, pixels) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    const table = crc32.table || (crc32.table = (() => {
      const t = new Int32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })());
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const v = crc32(Buffer.concat([t, data]));
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(v);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(raw));

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Draw GramVault vault door icon ---
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const P = v => v * size / 128;

  function setPixel(x, y, r, g, b, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const aa = a / 255, ra = 1 - aa;
    px[i]   = Math.round(r * aa + px[i]   * ra);
    px[i+1] = Math.round(g * aa + px[i+1] * ra);
    px[i+2] = Math.round(b * aa + px[i+2] * ra);
    px[i+3] = Math.min(255, Math.round(px[i+3] + a * (1 - px[i+3]/255)));
  }

  function fillCircle(cx, cy, radius, r, g, b, a = 255) {
    for (let y = Math.floor(cy - radius - 1); y <= Math.ceil(cy + radius + 1); y++)
      for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x++) {
        const alpha = Math.max(0, Math.min(1, radius - Math.sqrt((x-cx)**2 + (y-cy)**2) + 0.5));
        if (alpha > 0) setPixel(x, y, r, g, b, Math.round(a * alpha));
      }
  }

  function strokeLine(x0, y0, x1, y1, lw, r, g, b, a = 255) {
    const dx = x1-x0, dy = y1-y0;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx*dx+dy*dy) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      fillCircle(x0 + dx*t, y0 + dy*t, lw/2, r, g, b, a);
    }
  }

  function strokeArc(cx, cy, radius, startAngle, sweepAngle, lw, r, g, b, a = 255) {
    const steps = Math.max(8, Math.ceil(Math.abs(sweepAngle) * radius * 3));
    for (let i = 0; i < steps; i++) {
      const a1 = startAngle + sweepAngle * (i / steps);
      const a2 = startAngle + sweepAngle * ((i+1) / steps);
      strokeLine(
        cx + Math.cos(a1)*radius, cy + Math.sin(a1)*radius,
        cx + Math.cos(a2)*radius, cy + Math.sin(a2)*radius,
        lw, r, g, b, a
      );
    }
  }

  function strokeRoundRect(x, y, w, h, rx, lw, r, g, b, a = 255) {
    // 4 sides
    strokeLine(x+rx, y,     x+w-rx, y,      lw, r, g, b, a);
    strokeLine(x+rx, y+h,   x+w-rx, y+h,    lw, r, g, b, a);
    strokeLine(x,    y+rx,  x,      y+h-rx, lw, r, g, b, a);
    strokeLine(x+w,  y+rx,  x+w,    y+h-rx, lw, r, g, b, a);
    // 4 corners — sweep +π/2 (clockwise in screen coords = correct inward corner)
    strokeArc(x+rx,   y+rx,   rx, Math.PI,    Math.PI/2, lw, r, g, b, a); // top-left
    strokeArc(x+w-rx, y+rx,   rx, -Math.PI/2, Math.PI/2, lw, r, g, b, a); // top-right
    strokeArc(x+w-rx, y+h-rx, rx, 0,          Math.PI/2, lw, r, g, b, a); // bottom-right
    strokeArc(x+rx,   y+h-rx, rx, Math.PI/2,  Math.PI/2, lw, r, g, b, a); // bottom-left
  }

  function fillRect(x0, y0, w, h, r, g, b, a = 255) {
    for (let y = Math.floor(y0); y < Math.ceil(y0+h); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0+w); x++)
        setPixel(x, y, r, g, b, a);
  }

  // ── Background gradient #3730a3 → #1e1b4b clipped to rounded square ──
  const bgRad = P(22);
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const br = Math.round(55*(1-t) + 30*t);
    const bg = Math.round(48*(1-t) + 27*t);
    const bb = Math.round(163*(1-t) + 75*t);
    for (let x = 0; x < size; x++) {
      const ddx = Math.max(bgRad - x, 0, x - (size - bgRad));
      const ddy = Math.max(bgRad - y, 0, y - (size - bgRad));
      const alpha = Math.max(0, Math.min(1, bgRad - Math.sqrt(ddx*ddx+ddy*ddy) + 0.5));
      const i = (y * size + x) * 4;
      px[i] = br; px[i+1] = bg; px[i+2] = bb; px[i+3] = Math.round(255 * alpha);
    }
  }

  const lw = P(5); // main stroke width

  // ── Vault door outer frame (all sizes) ──
  {
    const fX = P(10), fY = P(10), fW = P(108), fH = P(108), fR = P(10);
    strokeRoundRect(fX, fY, fW, fH, fR, lw, 255, 255, 255, 190);
  }

  if (size >= 32) {
    // ── Inner inset panel ──
    const iX = P(17), iY = P(17), iW = P(94), iH = P(94), iR = P(7);
    strokeRoundRect(iX, iY, iW, iH, iR, P(2), 255, 255, 255, 64);

    // ── Bolt handles ──
    const boltW = P(8), boltH = P(10);
    const boltAlpha = 200;
    fillRect(P(5),   P(42), boltW, boltH, 255, 255, 255, boltAlpha);
    fillRect(P(5),   P(76), boltW, boltH, 255, 255, 255, boltAlpha);
    fillRect(P(115), P(42), boltW, boltH, 255, 255, 255, boltAlpha);
    fillRect(P(115), P(76), boltW, boltH, 255, 255, 255, boltAlpha);
  }

  // ── Large G letterform — center (64,54), radius 22 ──
  // SVG: M 77 38 A 22 22 0 1 0 86 54 L 66 54
  // Start: (77,38) = center + 22*cos(-52°), center + 22*sin(-52°)
  // End: (86,54) = center + 22, center (rightmost point)
  // large-arc=1, sweep=0 → counter-clockwise long arc
  const gCx = P(64), gCy = P(54), gR = P(22);
  const glw = P(size <= 16 ? 10 : 8);

  // Start angle: atan2(38-54, 77-64) = atan2(-16, 13) ≈ -0.888 rad ≈ -50.9°
  const gStart = Math.atan2(P(38)-gCy, P(77)-gCx);  // ~-0.888 * (size/128 scaling cancels)
  // Actually compute in 128-space then use directly since P scales uniformly
  const gStartAngle = Math.atan2(38-54, 77-64);  // ≈ -0.888 rad
  // Counter-clockwise (negative sweep) long arc: from gStart going CCW all the way around to 0°
  const gSweepAngle = -(2*Math.PI - (0 - gStartAngle)); // CCW from gStart to 0°
  strokeArc(gCx, gCy, gR, gStartAngle, gSweepAngle, glw, 255, 255, 255, 255);

  // Crossbar: from rightmost point (gCx+gR, gCy) leftward to center
  strokeLine(gCx + gR, gCy, gCx, gCy, glw, 255, 255, 255, 255);

  // ── Red squiggly line ──
  {
    const wY = P(95);
    const wX0 = P(30), wX1 = P(100);
    const wAmp = P(7);
    const wLw = P(size <= 16 ? 6 : size <= 48 ? 5 : 3.5);
    const wSteps = 80;
    for (let i = 0; i < wSteps; i++) {
      const t1 = i/wSteps, t2 = (i+1)/wSteps;
      strokeLine(
        wX0 + (wX1-wX0)*t1, wY + Math.sin(t1*Math.PI*4)*wAmp,
        wX0 + (wX1-wX0)*t2, wY + Math.sin(t2*Math.PI*4)*wAmp,
        wLw, 248, 113, 113, 230
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
