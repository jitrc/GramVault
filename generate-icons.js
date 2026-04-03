// Run with: node generate-icons.js
// Requires: npm install canvas
// Or use the icons/gramvault.svg in a tool like Inkscape/Figma to export PNGs

const fs = require('fs');
const path = require('path');

let canvas, createCanvas;
try {
  ({ createCanvas } = require('canvas'));
} catch (e) {
  console.log('canvas module not found. Generating SVG only.');
  generateSVG();
  process.exit(0);
}

function drawIcon(ctx, size) {
  const s = size;
  const r = s * 0.18; // corner radius

  // Background: rounded square, dark indigo
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(s - r, 0);
  ctx.quadraticCurveTo(s, 0, s, r);
  ctx.lineTo(s, s - r);
  ctx.quadraticCurveTo(s, s, s - r, s);
  ctx.lineTo(r, s);
  ctx.quadraticCurveTo(0, s, 0, s - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#312e81');
  grad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = grad;
  ctx.fill();

  // Vault circle (outer ring)
  const cx = s * 0.5;
  const cy = s * 0.47;
  const or = s * 0.28;
  const ir = s * 0.19;

  ctx.beginPath();
  ctx.arc(cx, cy, or, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, or, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s * 0.045;
  ctx.stroke();

  // Vault spokes (4 bolts at 45° angles)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s * 0.032;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const x1 = cx + Math.cos(angle) * ir;
    const y1 = cy + Math.sin(angle) * ir;
    const x2 = cx + Math.cos(angle) * or * 0.82;
    const y2 = cy + Math.sin(angle) * or * 0.82;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Handle (right side)
  ctx.beginPath();
  ctx.arc(cx + or * 0.78, cy, s * 0.055, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s * 0.04;
  ctx.stroke();

  // "GV" text below vault
  if (size >= 48) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold ${s * 0.17}px -apple-system, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GV', cx, s * 0.84);
  }
}

function generateSVG() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#312e81"/>
      <stop offset="100%" style="stop-color:#1e1b4b"/>
    </linearGradient>
    <clipPath id="rounded">
      <rect width="128" height="128" rx="23" ry="23"/>
    </clipPath>
  </defs>
  <!-- Background -->
  <rect width="128" height="128" rx="23" ry="23" fill="url(#bg)"/>
  <!-- Vault outer ring -->
  <circle cx="64" cy="60" r="36" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="5.5"/>
  <!-- Vault spokes -->
  <line x1="64" y1="36" x2="64" y2="44" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <line x1="64" y1="76" x2="64" y2="84" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <line x1="40" y1="60" x2="48" y2="60" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <line x1="80" y1="60" x2="88" y2="60" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <!-- Diagonal spokes -->
  <line x1="47" y1="43" x2="52" y2="48" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <line x1="76" y1="72" x2="81" y2="77" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <line x1="81" y1="43" x2="76" y2="48" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <line x1="52" y1="72" x2="47" y2="77" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <!-- Center dot -->
  <circle cx="64" cy="60" r="6" fill="white"/>
  <!-- Handle -->
  <circle cx="95" cy="60" r="7" fill="none" stroke="white" stroke-width="5"/>
  <!-- GV text -->
  <text x="64" y="108" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.9)" font-family="-apple-system, Arial, sans-serif" font-weight="bold" font-size="22">GV</text>
</svg>`;

  fs.writeFileSync(path.join(__dirname, 'icons', 'gramvault.svg'), svg);
  console.log('Generated icons/gramvault.svg');
  console.log('Convert to PNG with: rsvg-convert, Inkscape, or open in browser and screenshot');
}

generateSVG();

if (createCanvas) {
  [16, 48, 128].forEach(size => {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    drawIcon(ctx, size);
    const buf = c.toBuffer('image/png');
    fs.writeFileSync(path.join(__dirname, 'icons', `icon${size}.png`), buf);
    console.log(`Generated icons/icon${size}.png`);
  });
}
