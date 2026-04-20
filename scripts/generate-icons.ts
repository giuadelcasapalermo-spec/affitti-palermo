/**
 * Genera icon-192.png e icon-512.png con il logo GiuAdel su sfondo blu.
 * Esegui con: npx tsx scripts/generate-icons.ts
 */

import sharp from 'sharp';
import path from 'path';

const BLUE = '#1d4ed8';

const logoShapes = `
  <polyline points="2,72 2,60 8,60 8,54 14,54 14,60 20,60 20,68"/>
  <rect x="30" y="52" width="60" height="28"/>
  <line x1="37" y1="52" x2="37" y2="80"/>
  <line x1="45" y1="52" x2="45" y2="80"/>
  <line x1="53" y1="52" x2="53" y2="80"/>
  <line x1="61" y1="52" x2="61" y2="80"/>
  <line x1="69" y1="52" x2="69" y2="80"/>
  <line x1="77" y1="52" x2="77" y2="80"/>
  <line x1="83" y1="52" x2="83" y2="80"/>
  <polyline points="26,52 60,32 94,52"/>
  <line x1="26" y1="80" x2="94" y2="80"/>
  <line x1="24" y1="83" x2="96" y2="83"/>
  <polyline points="100,72 100,60 106,60 106,54 112,54 112,60 118,60 118,72"/>
  <path d="M 104,60 Q 109,52 114,60"/>
`;

const logoText = `
  <text x="60" y="97" font-family="serif" font-size="9.5" text-anchor="middle"
        stroke="none" fill="white" font-style="italic">GiuAdel casa Palermo</text>
`;

function makeSvg(size: number): string {
  // Scala il logo (viewBox 120×100) per occupare ~70% dell'icona
  const targetW = size * 0.72;
  const scale   = targetW / 120;
  const logoH   = 100 * scale;
  const tx      = (size - targetW) / 2;
  const ty      = (size - logoH)   / 2;
  const radius  = size * 0.18;          // angoli arrotondati
  const sw      = Math.max(1.4, size * 0.004); // stroke-width proporzionale

  return `<svg xmlns="http://www.w3.org/2000/svg"
  width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BLUE}" rx="${radius}"/>
  <g transform="translate(${tx.toFixed(1)}, ${ty.toFixed(1)}) scale(${scale.toFixed(4)})"
     stroke="white" fill="none"
     stroke-width="${sw.toFixed(2)}"
     stroke-linecap="round" stroke-linejoin="round">
    ${logoShapes}
    ${logoText}
  </g>
</svg>`;
}

async function main() {
  const pub = path.join(process.cwd(), 'public');

  for (const size of [192, 512]) {
    const svg = makeSvg(size);
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path.join(pub, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png`);
  }

  // Genera anche favicon 32×32
  await sharp(Buffer.from(makeSvg(32)))
    .png()
    .toFile(path.join(pub, 'favicon-32.png'));
  console.log('✓ favicon-32.png');

  console.log('\nFatto!');
}

main().catch((e) => { console.error(e); process.exit(1); });
