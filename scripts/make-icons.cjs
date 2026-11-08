// Draws the app icons with a headless browser. Usage: npm run icons
const { chromium } = require('playwright');
const path = require('path');

const art = ({ scale, dollar = true }) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -241)">
    <rect x="156" y="288" width="62" height="96" rx="14" fill="#ffffff"/>
    <rect x="240" y="234" width="62" height="150" rx="14" fill="#ffffff"/>
    <rect x="324" y="128" width="62" height="256" rx="14" fill="#ffffff"/>
    <circle cx="198" cy="170" r="72" fill="url(#coin)"/>
    <circle cx="198" cy="170" r="57" fill="none" stroke="#b9770e" stroke-opacity=".45" stroke-width="5"/>
    ${dollar ? '<text x="198" y="172" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="88" fill="#0b5347">$</text>' : ''}
  </g>`;

const svg = (size, { rounded, scale, dollar }) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" style="display:block">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15907b"/><stop offset="1" stop-color="#0a4f43"/></linearGradient>
    <linearGradient id="coin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd978"/><stop offset="1" stop-color="#f2a93b"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  ${art({ scale, dollar })}
</svg></body></html>`;

// Maskable icons are cropped by the phone, so the artwork stays inside the central safe circle.
const ICONS = [
  { name: 'icon-192', size: 192, rounded: true, scale: 1.12 },
  { name: 'icon-512', size: 512, rounded: true, scale: 1.12 },
  { name: 'icon-maskable-192', size: 192, rounded: false, scale: 0.92 },
  { name: 'icon-maskable-512', size: 512, rounded: false, scale: 0.92 },
  { name: 'apple-touch-icon', size: 180, rounded: false, scale: 1.02 },
  { name: 'favicon-32', size: 32, rounded: true, scale: 1.3, dollar: false },
];

(async () => {
  const browser = await chromium.launch();
  for (const icon of ICONS) {
    const p = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await p.setContent(svg(icon.size, { dollar: true, ...icon }));
    await p.screenshot({ path: path.join(__dirname, '..', 'icons', `${icon.name}.png`), omitBackground: icon.rounded });
    await p.close();
  }
  await browser.close();
})();
