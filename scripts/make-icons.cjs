// Draws the app icons once with a headless browser. Usage: npm run icons
const { chromium } = require('playwright');
const path = require('path');

const page = size => `<!doctype html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0f6b5c"/>
<rect x="136" y="280" width="56" height="96" rx="10" fill="#ffffff"/>
<rect x="228" y="208" width="56" height="168" rx="10" fill="#ffffff"/>
<rect x="320" y="136" width="56" height="240" rx="10" fill="#ffffff"/>
</svg></body>`;

(async () => {
  const browser = await chromium.launch();
  for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(page(size));
    await p.screenshot({ path: path.join(__dirname, '..', 'icons', `${name}.png`) });
    await p.close();
  }
  await browser.close();
})();
