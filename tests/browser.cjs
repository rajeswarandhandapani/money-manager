// Runs the whole app in a real browser with made-up data. Usage: npm run test:browser
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { start } = require('../scripts/serve.cjs');

const PORT = 4182;
const URL = `http://localhost:${PORT}/`;
const file = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

const CHECKING = file('accountActivityExport.csv', `Transaction Date,Transaction Description,Amount,Category
2026-10-30,CHASE CREDIT CRD AUTOPAY ACH DEBIT xxxx0001,- $100.5,Credit Card Payments
2026-10-07,CORNER RENT LLC ACH WEB-RECUR 2FMPQG,- $1200.25,Services and Supplies
2026-10-05,PAYROLL DEPOSIT ACH CREDIT 9931,+ $3000,Income
`);
const CHASE = file('Chase1234_Activity.csv', `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
10/28/2026,10/28/2026,AUTOMATIC PAYMENT - THANK,,Payment,100.50,
10/26/2026,10/28/2026,SHOE SHOP  DOWNTOWN,Shopping,Return,18.18,
10/16/2026,10/18/2026,SHOE SHOP  DOWNTOWN,Shopping,Sale,-36.36,
10/13/2026,10/14/2026,<img src=x onerror=window.__xss=1>,Shopping,Sale,-1.00,
10/12/2026,10/13/2026,DELETE ME STORE,Shopping,Sale,-5.00,
`);
const NEXT_MONTH = file('Chase1234_November.csv', `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
11/02/2026,11/03/2026,SHOE SHOP  DOWNTOWN,Shopping,Sale,-10.00,
`);
const UNKNOWN = file('card-export.csv', `Status,Date,Description,Debit,Credit
Cleared,10/02/2026,MYSTERY MART,12.50,
Cleared,10/03/2026,MYSTERY REFUND,,-5.00
`);

const rowFor = (page, text) => page.locator('.tx', { hasText: text }).first();

(async () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'js'))) assert.ok(sw.includes(`./js/${f}`), `${f} missing from sw.js`);

  const server = await start(PORT);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (!/^(http:\/\/localhost|blob:|data:)/.test(r.url())) external.push(r.url()); });
  const nav = v => page.click(`nav [data-view=${v}]`);
  const kpi = id => page.locator(`#kpi-${id} b`).textContent();
  const step = name => console.log(`  ok  ${name}`);

  await page.goto(URL);
  await page.setInputFiles('#file-input', [CHECKING, CHASE]);
  await page.waitForSelector('#review-list .tx');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('.tx strong', { hasText: '<img' }).count(), 1);
  step('bank text is shown as text, never run');

  await page.click('[data-tab=all]');
  const shoe = rowFor(page, 'SHOE SHOP');
  await shoe.getByLabel('Category', { exact: true }).selectOption('Family');
  await rowFor(page, 'SHOE SHOP').getByLabel('Subcategory').selectOption('Storage');
  await page.getByRole('button', { name: 'Apply to 1 other' }).click();
  const shoes = page.locator('.tx', { hasText: 'SHOE SHOP' });
  for (let i = 0; i < 2; i++) assert.equal(await shoes.nth(i).getByLabel('Category', { exact: true }).inputValue(), 'Family');
  step('category and subcategory can be changed before saving, and applied to the same merchant');

  await rowFor(page, 'CORNER RENT').getByLabel('Type').selectOption('transfer');
  await rowFor(page, 'CORNER RENT').getByLabel('Type').selectOption('expense');
  await rowFor(page, 'CORNER RENT').getByLabel('Category', { exact: true }).selectOption('HousingUtilities');
  await rowFor(page, 'CORNER RENT').getByLabel('Subcategory').selectOption('HomeRent');
  const del = text => rowFor(page, text).getByRole('button', { name: /^Delete/ }).click();
  await del('DELETE ME STORE');
  assert.equal(await page.locator('.tx', { hasText: 'DELETE ME STORE' }).count(), 0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForSelector('.tx:has-text("DELETE ME STORE")');
  await page.click('[data-tab=all]');
  await page.waitForSelector('.tx:has-text("DELETE ME STORE")');
  await del('DELETE ME STORE');
  assert.equal(await page.locator('.tx', { hasText: 'DELETE ME STORE' }).count(), 0);
  step('a row can be deleted during import, and the delete undone');

  assert.equal(await page.locator('#save-import').isDisabled(), true);
  await rowFor(page, '<img').getByLabel('Category', { exact: true }).selectOption('Family');
  assert.equal(await page.locator('#save-import').isDisabled(), true);
  assert.match(await rowFor(page, '<img').textContent(), /Choose a subcategory to save/);
  await rowFor(page, '<img').getByLabel('Subcategory').selectOption('Storage');
  assert.equal(await page.locator('#save-import').isDisabled(), false);
  step('saving is blocked until every expense has a category and subcategory');

  await page.click('#save-import');
  await page.waitForSelector('#kpi-spent');
  assert.equal(await kpi('spent'), '$1,219.43');
  assert.equal(await kpi('income'), '$0.00'.replace('0.00', '3,000.00'));
  step('totals leave out card payments and net the return');

  await page.reload();
  await page.waitForSelector('#kpi-spent');
  assert.equal(await kpi('spent'), '$1,219.43');
  step('data survives a reload');

  await nav('tx');
  await page.waitForSelector('#tx-list .tx');
  await rowFor(page, 'CORNER RENT').getByLabel('Subcategory').selectOption('Internet');
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#kpi-spent');
  await nav('tx');
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await rowFor(page, 'CORNER RENT').getByLabel('Subcategory').inputValue(), 'Internet');
  step('saved transactions can be recategorized later');

  await rowFor(page, 'CORNER RENT').getByLabel('Category', { exact: true }).selectOption('Food');
  assert.match(await rowFor(page, 'CORNER RENT').textContent(), /Choose a subcategory to save/);
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#kpi-spent');
  await nav('tx');
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await rowFor(page, 'CORNER RENT').getByLabel('Category', { exact: true }).inputValue(), 'HousingUtilities');
  step('a category with no subcategory is not saved on the Transactions screen');

  await rowFor(page, '<img').getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForSelector('.tx:has-text("<img")');
  await rowFor(page, '<img').getByRole('button', { name: /^Delete/ }).click();
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#kpi-spent');
  assert.equal(await kpi('spent'), '$1,218.43');
  step('a saved transaction can be deleted, and the delete undone');

  await nav('import');
  await page.setInputFiles('#file-input', [CHASE]);
  await page.waitForSelector('.files .card');
  const card = () => page.locator('.files .card').textContent();
  assert.match(await card(), /No new rows/);
  assert.match(await card(), /3 already imported/);
  assert.match(await card(), /2 you deleted earlier/);
  step('importing the same file twice adds nothing, and deleted rows stay deleted');

  await page.getByRole('button', { name: 'Bring back' }).click();
  await page.waitForSelector('.tx:has-text("DELETE ME STORE")');
  await page.getByRole('button', { name: 'Discard' }).click();
  step('deleted rows can be brought back from the file');

  await page.setInputFiles('#file-input', [NEXT_MONTH]);
  await page.waitForSelector('#review-list .tx');
  const learned = rowFor(page, 'SHOE SHOP');
  assert.equal(await learned.getByLabel('Category', { exact: true }).inputValue(), 'Family');
  assert.equal(await learned.getByLabel('Subcategory').inputValue(), 'Storage');
  assert.equal(await page.locator('.tx.review').count(), 0);
  await page.click('#save-import');
  await page.waitForSelector('#kpi-spent');
  step('next month, a corrected merchant is categorized automatically');

  await nav('import');
  await page.setInputFiles('#file-input', [UNKNOWN]);
  await page.waitForSelector('dialog .mapper');
  assert.match(await page.locator('.map-preview').textContent(), /spent \$12\.50/);
  assert.match(await page.locator('.map-preview').textContent(), /received \$5\.00/);
  await page.getByLabel('Account name').fill('Citi Card');
  await page.getByRole('button', { name: 'Use this format' }).click();
  await page.waitForSelector('#review-list .tx');
  assert.match(await page.locator('.files .card').textContent(), /Citi Card/);
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.setInputFiles('#file-input', [UNKNOWN]);
  await page.waitForSelector('#review-list .tx');
  assert.equal(await page.locator('dialog .mapper').count(), 0);
  await page.getByRole('button', { name: 'Discard' }).click();
  step('a new bank format is set up once and remembered');

  await nav('data');
  const downloadP = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Save backup' }).click();
  await page.locator('dialog input').fill('correct horse');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('dialog input').fill('correct horse');
  await page.getByRole('button', { name: 'Save backup' }).last().click();
  const download = await downloadP;
  const backupPath = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'me-')), 'test.backup');
  await download.saveAs(backupPath);
  const backupText = fs.readFileSync(backupPath, 'utf8');
  assert.ok(!backupText.includes('SHOE') && !backupText.includes('Family'));
  step('backup file is encrypted');

  await page.getByRole('button', { name: 'Erase all data on this device' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Erase' }).click();
  await page.waitForSelector('#drop');
  await nav('data');
  const restoreInput = page.locator('input[type=file]');
  await restoreInput.setInputFiles(backupPath);
  await page.locator('dialog input').fill('wrong words');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Wrong passphrase'));
  await restoreInput.setInputFiles(backupPath);
  await page.locator('dialog input').fill('correct horse');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Replace' }).click();
  await page.waitForSelector('#kpi-spent');
  await page.selectOption('#month', '2026-10');
  assert.equal(await kpi('spent'), '$1,218.43');
  step('backup restores, and a wrong passphrase is refused');

  await nav('data');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.locator('dialog').getByRole('button', { name: 'Undo import' }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Import removed'));
  step('an import can be undone');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('nav');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#kpi-spent', { timeout: 15000 });
  await context.setOffline(false);
  step('works with no internet');

  await page.setViewportSize({ width: 360, height: 740 });
  for (const v of ['report', 'year', 'tx', 'import', 'data']) {
    await nav(v);
    await page.waitForTimeout(80);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `${v} overflows by ${overflow}px on a phone`);
  }
  step('no sideways scrolling at phone width');

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  step('no console errors and no requests to any other site');

  await browser.close();
  server.close();
  console.log('All browser checks passed.');
})().catch(err => { console.error(err); process.exit(1); });
