// Runs the whole app in a real browser with made-up data. Usage: npm run test:browser
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { start } = require('../scripts/serve-dist.cjs');

const PORT = 4182;
const URL = `http://localhost:${PORT}/`;
const DIST_ROOT = path.join(__dirname, '..', 'dist', 'money-manager', 'browser');
const OUT = path.join(__dirname, '..', 'test-output');
fs.mkdirSync(OUT, { recursive: true });
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

const EXTRA = file('Chase1234_December.csv', `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
12/02/2026,12/03/2026,SPLIT STORE,Shopping,Sale,-100.00,
12/03/2026,12/04/2026,AMOUNT FIX,Shopping,Sale,-20.00,
`);

const rowFor = (page, text) => page.locator('.tx', { hasText: text }).first();

(async () => {
  assert.ok(fs.existsSync(path.join(DIST_ROOT, 'ngsw-worker.js')), 'ngsw-worker.js missing from dist');
  assert.ok(fs.existsSync(path.join(DIST_ROOT, 'ngsw.json')), 'ngsw.json missing from dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(DIST_ROOT, icon.src)), `${icon.src} missing from dist`);
  }

  const server = await start(PORT);
  const browser = await chromium.launch()
    .catch(() => chromium.launch({ channel: 'chrome' }))
    .catch(() => chromium.launch({ channel: 'msedge' }));
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (!/^(http:\/\/localhost|blob:|data:)/.test(r.url())) external.push(r.url()); });
  const NAV_LABELS = { dashboard: 'Dashboard', tx: 'Transactions', import: 'Import', data: 'Data' };
  const nav = v => page.locator('nav button', { hasText: NAV_LABELS[v] }).click();
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
  await shoe.getByLabel('Category', { exact: true }).selectOption('Household');
  await rowFor(page, 'SHOE SHOP').getByLabel('Subcategory').selectOption('Furniture');
  await page.getByRole('button', { name: 'Apply to 1 other' }).click();
  const shoes = page.locator('.tx', { hasText: 'SHOE SHOP' });
  await page.waitForFunction(() => [...document.querySelectorAll('.tx')].filter(el => el.textContent.includes('SHOE SHOP')).every(el => el.querySelector('select[aria-label="Category"]')?.value === 'Household'));
  for (let i = 0; i < 2; i++) assert.equal(await shoes.nth(i).getByLabel('Category', { exact: true }).inputValue(), 'Household');
  step('category and subcategory can be changed before saving, and applied to the same merchant');

  const renamed = page.locator('.tx', { hasText: 'SHOE SHOP' }).nth(1);
  await renamed.getByRole('button', { name: 'Edit description' }).click();
  const descInput = page.getByLabel('New description');
  const descSave = page.locator('.desc-edit').getByRole('button', { name: 'Save', exact: true });
  await descInput.fill('Returned school shoes');
  await descSave.click();
  await page.waitForSelector('.tx strong:has-text("Returned school shoes")');
  assert.match(await rowFor(page, 'Returned school shoes').textContent(), /originally: SHOE SHOP DOWNTOWN/);
  step('a description can be edited during import, and the original is kept');

  await rowFor(page, 'CORNER RENT').getByLabel('Type').selectOption('transfer');
  await rowFor(page, 'CORNER RENT').getByLabel('Type').selectOption('expense');
  await rowFor(page, 'CORNER RENT').getByLabel('Category', { exact: true }).selectOption('Housing');
  await rowFor(page, 'CORNER RENT').getByLabel('Subcategory').selectOption('Rent');
  const del = text => rowFor(page, text).getByRole('button', { name: /^Delete/ }).click();
  await del('DELETE ME STORE');
  await page.locator('.tx', { hasText: 'DELETE ME STORE' }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForSelector('.tx:has-text("DELETE ME STORE")');
  await page.click('[data-tab=all]');
  await page.waitForSelector('.tx:has-text("DELETE ME STORE")');
  await del('DELETE ME STORE');
  await page.locator('.tx', { hasText: 'DELETE ME STORE' }).waitFor({ state: 'detached' });
  step('a row can be deleted during import, and the delete undone');

  assert.equal(await page.locator('#save-import').isDisabled(), true);
  await rowFor(page, '<img').getByLabel('Category', { exact: true }).selectOption('Household');
  await rowFor(page, '<img').getByText('Choose a subcategory to save').waitFor();
  assert.equal(await page.locator('#save-import').isDisabled(), true);
  assert.match(await rowFor(page, '<img').textContent(), /Choose a subcategory to save/);
  await rowFor(page, '<img').getByLabel('Subcategory').selectOption('Furniture');
  await page.locator('#save-import:not([disabled])').waitFor();
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

  await page.waitForSelector('.dash .chart-plot svg');
  assert.equal(await page.locator('nav button').count(), 4);
  assert.equal(await page.locator('.dash .chart').count(), 4);
  for (const title of ['Income and expense, last 12 months', 'Share of income, last 12 months', 'Where the money went over time', 'Spending pace through the month', 'By category', 'By account', 'Top merchants', 'Top subcategories']) {
    assert.equal(await page.getByRole('heading', { name: title }).count(), 1, title);
  }
  await page.locator('.dash .chart-plot svg rect[fill=transparent]').nth(11).hover();
  await page.waitForSelector('.chart-tip:not([hidden])');
  assert.match(await page.locator('.chart-tip:not([hidden])').textContent(), /October 2026.*Income \$3,000\.00.*Expense \$1,219\.43.*Saved \$1,780\.57/);
  step('the dashboard is the landing page, with charts and hover details');

  await page.click('.seg [data-scope=year]');
  await page.waitForSelector('#year');
  await page.waitForSelector('.matrix .link');
  await page.waitForSelector('.dash .chart-plot svg');
  assert.equal(await kpi('spent'), '$1,219.43');
  assert.equal(await page.getByRole('heading', { name: 'Saved each month' }).count(), 1);
  await page.locator('.matrix thead').getByRole('button', { name: 'Oct', exact: true }).click();
  await page.waitForSelector('#month');
  assert.equal(await page.inputValue('#month'), '2026-10');
  step('Year view is a switch on the dashboard, and a month in its table opens that month');

  await page.locator('.bar-row', { hasText: 'Household' }).click();
  await page.getByRole('button', { name: /See or change these/ }).click();
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await page.getByLabel('Month', { exact: true }).inputValue(), '2026-10');
  assert.equal(await page.getByLabel('Category', { exact: true }).first().inputValue(), 'Household');
  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');
  step('a category on the dashboard drills into its transactions');

  assert.equal(await page.locator('#kpi-budget').count(), 0);
  await page.click('#edit-budgets');
  const budgetInput = name => page.getByLabel(`Budget for ${name}`, { exact: true });
  await budgetInput('Household').fill('-5');
  await page.locator('#budgets-save[disabled]').waitFor();
  await budgetInput('Household').fill('50');
  await budgetInput('Housing').fill('1000');
  await page.locator('#budget-total', { hasText: 'Total $1,050.00 a month' }).waitFor();
  await page.click('#budgets-save');
  await page.waitForSelector('#kpi-budget');
  assert.match(await page.locator('#kpi-budget').textContent(), /Over budget\$169\.43of \$1,050\.00 · 1 over/);
  assert.match(await page.locator('.bar-row', { hasText: 'Housing' }).textContent(), /\$200\.25 over \$1,000\.00 budget/);
  assert.match(await page.locator('.bar-row', { hasText: 'Household' }).textContent(), /\$30\.82 left of \$50\.00/);
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#kpi-budget');
  await page.click('.seg [data-scope=year]');
  await page.waitForSelector('#year');
  assert.match(await page.locator('#kpi-budget').textContent(), /of \$1,050\.00 for 1 month/);
  await page.click('.seg [data-scope=month]');
  await page.waitForSelector('#month');
  await page.click('#edit-budgets');
  assert.equal(await budgetInput('Household').inputValue(), '50');
  await page.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
  step('budgets can be set, show spent against target, and survive a reload');

  await nav('tx');
  await page.waitForSelector('#tx-list .tx');
  await rowFor(page, 'CORNER RENT').getByLabel('Subcategory').selectOption('Internet');
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await rowFor(page, 'CORNER RENT').getByLabel('Subcategory').inputValue(), 'Internet');
  step('saved transactions can be recategorized later');

  assert.equal(await page.locator('.tx strong:has-text("Returned school shoes")').count(), 1);

  const corner = () => rowFor(page, 'CORNER RENT');
  await corner().getByRole('button', { name: 'Edit description' }).click();
  await descInput.fill('Cancelled wording');
  await page.keyboard.press('Escape');
  await page.locator('.desc-edit').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.tx strong:has-text("Cancelled wording")').count(), 0);
  await corner().getByRole('button', { name: 'Edit description' }).click();
  await descInput.fill('   ');
  await descSave.click();
  await page.waitForTimeout(50);
  assert.equal(await descInput.count(), 1);
  await descInput.fill('Apartment rent');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tx strong:has-text("Apartment rent")');
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await page.locator('.tx strong:has-text("Apartment rent")').count(), 1);
  await page.getByLabel('Search transactions').fill('corner rent');
  await page.waitForSelector('.tx strong:has-text("Apartment rent")');
  await page.getByLabel('Search transactions').fill('');
  step('a saved description can be edited, cancelled, can\'t be blank, and search finds the original');

  await rowFor(page, 'CORNER RENT').getByLabel('Category', { exact: true }).selectOption('Food');
  await rowFor(page, 'CORNER RENT').getByText('Choose a subcategory to save').waitFor();
  assert.match(await rowFor(page, 'CORNER RENT').textContent(), /Choose a subcategory to save/);
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await rowFor(page, 'CORNER RENT').getByLabel('Category', { exact: true }).inputValue(), 'Housing');
  step('a category with no subcategory is not saved on the Transactions screen');

  await rowFor(page, '<img').getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForSelector('.tx:has-text("<img")');
  await rowFor(page, '<img').getByRole('button', { name: /^Delete/ }).click();
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#tx-list');
  await nav('dashboard');
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
  assert.equal(await learned.getByLabel('Category', { exact: true }).inputValue(), 'Household');
  assert.equal(await learned.getByLabel('Subcategory').inputValue(), 'Furniture');
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
  await page.locator('dialog h3', { hasText: 'Encrypt backup' }).waitFor();
  await page.locator('dialog input').fill('correct horse');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('dialog h3', { hasText: 'Confirm passphrase' }).waitFor();
  await page.locator('dialog input').fill('correct horse');
  await page.getByRole('button', { name: 'Save backup' }).last().click();
  const download = await downloadP;
  const backupPath = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'me-')), 'test.backup');
  await download.saveAs(backupPath);
  const backupText = fs.readFileSync(backupPath, 'utf8');
  assert.ok(!backupText.includes('SHOE') && !backupText.includes('Household'));
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
  await page.waitForFunction(() => document.querySelector('#kpi-spent b')?.textContent === '$1,218.43');
  assert.equal(await kpi('spent'), '$1,218.43');
  assert.match(await page.locator('#kpi-budget').textContent(), /\$168\.43/);
  step('backup restores, and a wrong passphrase is refused');

  await nav('data');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.locator('dialog').getByRole('button', { name: 'Undo import' }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Import removed'));
  step('an import can be undone');

  await nav('tx');
  await page.getByLabel('Month', { exact: true }).selectOption('2026-07');
  await page.click('#add-tx');
  const box = page.locator('dialog');
  assert.equal(await box.getByLabel('Date').inputValue(), '2026-07-01');
  const addButton = page.locator('#add-confirm');
  assert.equal(await addButton.isDisabled(), true);
  await box.getByLabel('Date').fill('2026-07-15');
  await box.getByLabel('Description').fill('Cash at farmers market');
  await box.getByLabel('Amount').fill('23.40');
  await box.getByLabel('Category', { exact: true }).selectOption('Food');
  await page.waitForTimeout(50);
  assert.equal(await addButton.isDisabled(), true);
  await box.getByLabel('Subcategory').selectOption('Snacks & Ice Cream');
  await page.locator('#add-confirm:not([disabled])').waitFor();
  await addButton.click();
  await page.waitForSelector('#tx-list .tx:has-text("Cash at farmers market")');
  assert.equal(await page.getByLabel('Month', { exact: true }).inputValue(), '2026-07');
  step('a transaction can be added to a month with no data, and needs a category and subcategory');

  await page.click('#add-tx');
  await box.getByLabel('Type').selectOption('income');
  await box.getByLabel('Description').fill('Side job');
  await box.getByLabel('Amount').fill('-5');
  await page.waitForTimeout(50);
  assert.equal(await addButton.isDisabled(), true);
  await box.getByLabel('Amount').fill('100');
  await page.locator('#add-confirm:not([disabled])').waitFor();
  await addButton.click();
  await page.waitForSelector('#tx-list .tx:has-text("Side job")');
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector('#tx-list');
  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');
  await page.selectOption('#month', '2026-07');
  assert.equal(await kpi('spent'), '$23.40');
  assert.equal(await kpi('income'), '$100.00');
  step('added expenses and income appear in that month and survive a reload');

  await nav('tx');
  await page.waitForSelector('#tx-list .tx');
  await rowFor(page, 'Cash at farmers market').getByLabel('Type').selectOption('savings');
  await rowFor(page, 'Cash at farmers market').getByLabel('Savings subcategory').waitFor();
  assert.equal(await rowFor(page, 'Cash at farmers market').getByLabel('Savings subcategory').inputValue(), 'India Remittance');
  await page.waitForTimeout(150);
  await nav('dashboard');
  await page.waitForSelector('#month');
  await page.selectOption('#month', '2026-07');
  await page.waitForFunction(() => document.querySelector('#kpi-spent b')?.textContent === '$0.00');
  assert.equal(await kpi('spent'), '$0.00');
  assert.equal(await kpi('saved'), '$100.00');
  assert.match(await page.locator('#kpi-saved').textContent(), /includes \$23\.40 in Savings/);
  step('moving a transaction to Savings takes it out of spending and keeps it in saved');

  await page.waitForSelector('.savings-card .chart-plot svg');
  assert.match(await page.locator('.savings-total').textContent(), /\$23\.40 set aside in July 2026/);
  assert.match(await page.locator('.savings-card').textContent(), /India Remittance\$23\.40/);
  assert.equal(await page.locator('.savings-card .legend').count(), 0);
  assert.equal(await page.locator('.legend', { hasText: 'Income' }).filter({ hasText: 'Expense' }).filter({ hasText: 'Savings' }).count(), 1);
  assert.match(await page.locator('.share-chart .legend').textContent(), /Expense.*Savings.*Left over/);
  await page.waitForSelector('.share-chart svg');
  assert.match(await page.locator('.share-chart .seg-label').first().textContent(), /^\d+%?$/);
  await page.click('.seg [data-scope=year]');
  await page.waitForSelector('#year');
  await page.waitForSelector('.savings-card .chart-plot svg');
  assert.match(await page.locator('.savings-total').textContent(), /\$23\.40 set aside in 2026/);
  await page.click('.seg [data-scope=month]');
  await page.waitForSelector('#month');
  await page.getByRole('button', { name: 'See this transaction', exact: true }).waitFor();
  await page.getByRole('button', { name: 'See this transaction', exact: true }).click();
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await page.locator('#tx-count').textContent(), '1 shown · $23.40 savings');
  assert.equal(await page.getByLabel('Show', { exact: true }).inputValue(), 'savings');
  step('the Savings card shows the total, each month and each subcategory, and links to the rows');

  await nav('import');
  await page.setInputFiles('#file-input', [EXTRA]);
  await page.waitForSelector('#review-list .tx');
  await page.click('[data-tab=all]');
  await page.waitForSelector('.tx:has-text("AMOUNT FIX")');
  const amountInput = page.getByLabel('New amount');
  const amountSave = page.locator('.amt-edit').getByRole('button', { name: 'Save', exact: true });
  await rowFor(page, 'AMOUNT FIX').getByRole('button', { name: 'Edit amount' }).click();
  await amountInput.fill('0');
  await amountSave.click();
  await page.waitForTimeout(50);
  assert.equal(await amountInput.count(), 1);
  await amountInput.fill('25');
  await amountSave.click();
  await rowFor(page, 'AMOUNT FIX').getByText('original amount: $20.00').waitFor();
  assert.match(await rowFor(page, 'AMOUNT FIX').textContent(), /\$25\.00.*original amount: \$20\.00|original amount: \$20\.00.*\$25\.00/);
  await rowFor(page, 'AMOUNT FIX').getByLabel('Category', { exact: true }).selectOption('Household');
  await rowFor(page, 'AMOUNT FIX').getByLabel('Subcategory').selectOption('Furniture');
  step('an amount can be edited during import, zero is refused, and the original is kept');

  await rowFor(page, 'SPLIT STORE').getByRole('button', { name: 'Split', exact: true }).click();
  const splitSave = page.locator('#split-save');
  const splitSummary = () => page.locator('#split-summary').textContent();
  const part = (n, what) => page.getByLabel(`Part ${n} ${what}`, { exact: true });
  await part(1, 'amount').fill('60');
  await part(1, 'category').selectOption('Food');
  await part(1, 'subcategory').selectOption('Snacks & Ice Cream');
  await part(2, 'amount').fill('30');
  await page.locator('#split-summary', { hasText: '$10.00 left' }).waitFor();
  assert.match(await splitSummary(), /\$10\.00 left/);
  await part(2, 'category').selectOption('Household');
  await part(2, 'subcategory').selectOption('Furniture');
  assert.equal(await splitSave.isDisabled(), true);
  await part(2, 'amount').fill('50');
  await page.locator('#split-summary', { hasText: '$10.00 too much' }).waitFor();
  assert.match(await splitSummary(), /\$10\.00 too much/);
  assert.equal(await splitSave.isDisabled(), true);
  await part(2, 'amount').fill('');
  await page.getByRole('button', { name: 'Put the rest in the last part' }).click();
  await page.locator('#split-summary', { hasText: 'fully assigned' }).waitFor();
  assert.equal(await part(2, 'amount').inputValue(), '40.00');
  assert.match(await splitSummary(), /fully assigned/);
  await part(2, 'description').fill('Household part');
  await page.locator('#split-save:not([disabled])').waitFor();
  await splitSave.click();
  await page.waitForSelector('.tx strong:has-text("Household part")');
  assert.match(await rowFor(page, 'Household part').textContent(), /originally: SPLIT STORE.*part 2 of a \$100\.00 transaction/);
  assert.match(await page.locator('.savebar').textContent(), /\$125\.00 spending/);
  await page.locator('#save-import:not([disabled])').waitFor();
  await page.click('#save-import');
  await page.waitForSelector('#kpi-spent');
  assert.equal(await kpi('spent'), '$125.00');
  step('a transaction can be split during import, and the parts must add up');

  await nav('tx');
  await page.waitForSelector('.tx:has-text("AMOUNT FIX")');
  await rowFor(page, 'AMOUNT FIX').getByRole('button', { name: 'Edit amount' }).click();
  await amountInput.fill('30');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Amount saved'));
  await page.reload();
  await page.waitForSelector('#tx-list');
  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');
  assert.equal(await kpi('spent'), '$130.00');
  step('a saved amount can be edited, and the totals follow');

  await nav('import');
  await page.setInputFiles('#file-input', [EXTRA]);
  await page.waitForSelector('.files .card');
  assert.match(await page.locator('.files .card').textContent(), /No new rows/);
  assert.match(await page.locator('.files .card').textContent(), /2 already imported/);
  await page.getByRole('button', { name: 'Discard' }).click();
  step('edited and split rows are still recognized when the same file is imported again');

  await nav('tx');
  await page.waitForSelector('.tx:has-text("Household part")');
  await rowFor(page, 'Household part').getByRole('button', { name: 'Edit split' }).click();
  assert.equal(await part(2, 'description').inputValue(), 'Household part');
  await part(1, 'amount').fill('70');
  await part(2, 'amount').fill('30');
  await splitSave.click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Split saved'));
  assert.match(await rowFor(page, 'Household part').textContent(), /\$30\.00/);
  await rowFor(page, 'Household part').getByRole('button', { name: 'Undo split' }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Split undone'));
  await page.locator('.tx strong:has-text("Household part")').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.tx strong:has-text("Household part")').count(), 0);
  assert.match(await rowFor(page, 'SPLIT STORE').textContent(), /\$100\.00/);
  await rowFor(page, 'SPLIT STORE').getByRole('button', { name: 'Split', exact: true }).click();
  await part(1, 'amount').fill('90');
  await page.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');
  assert.equal(await kpi('spent'), '$130.00');
  step('a saved split can be edited and undone, and the total stays the same');

  await nav('data');
  await page.getByRole('button', { name: 'Remove Vacation & Travel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Removed Vacation'));
  assert.equal(await page.getByRole('button', { name: 'Remove Vacation & Travel', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Remove Housing', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Remove Savings', exact: true }).count(), 0);
  await page.reload();
  await page.waitForSelector('#lock-card');
  await nav('tx');
  await page.waitForSelector('#tx-list .tx');
  assert.equal(await page.locator('option', { hasText: /^Vacation & Travel$/ }).count(), 0);
  step('an unused category can be removed, and categories in use cannot');

  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('nav');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#kpi-spent', { timeout: 15000 });
  await context.setOffline(false);
  step('works with no internet');

  await page.screenshot({ path: path.join(OUT, 'dashboard.png'), fullPage: true });
  await nav('tx');
  await page.waitForSelector('#tx-list');
  await page.screenshot({ path: path.join(OUT, 'transactions.png'), fullPage: true });
  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');

  await page.setViewportSize({ width: 360, height: 740 });
  for (const v of ['dashboard', 'tx', 'import', 'data']) {
    await nav(v);
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `${v} overflows by ${overflow}px on a phone`);
  }
  await nav('dashboard');
  await page.waitForSelector('.seg [data-scope=year]');
  await page.click('.seg [data-scope=year]');
  await page.waitForSelector('#year');
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'year view overflows on a phone');

  await page.setViewportSize({ width: 1900, height: 900 });
  await page.waitForSelector('mm-dashboard-page');
  const mainWidth = () => page.evaluate(() => document.querySelector('main').getBoundingClientRect().width);
  assert.equal(await mainWidth(), 1900);
  await nav('tx');
  await page.waitForSelector('#tx-list');
  assert.equal(await mainWidth(), 1040);
  await nav('dashboard');
  await page.setViewportSize({ width: 360, height: 740 });
  step('the Dashboard uses the full width, and other pages stay at reading width');
  step('no sideways scrolling at phone width');

  // Theme switcher check
  await nav('data');
  await page.getByLabel('Color theme').selectOption('dark');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await nav('dashboard');
  await page.waitForSelector('#kpi-spent');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({ path: path.join(OUT, 'dashboard-dark.png'), fullPage: true });
  await nav('data');
  await page.getByLabel('Color theme').selectOption('system');
  step('DaisyUI theme switcher updates live and restores system');

  // A simulated passkey device stands in for Face ID, which a test browser doesn't have.
  const lockContext = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const lp = await lockContext.newPage();
  lp.on('pageerror', e => errors.push(e.message));
  lp.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const cdp = await lockContext.newCDPSession(lp);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const faceMatches = isUserVerified => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified });
  const idbPutTx = row => lp.evaluate(async r => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('monthly-expense', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tx')) db.createObjectStore('tx', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('tx', 'readwrite');
        tx.objectStore('tx').put(r);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, row);
  const idbGetKv = key => lp.evaluate(async k => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('monthly-expense', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readonly');
        const g = tx.objectStore('kv').get(k);
        g.onsuccess = () => { db.close(); resolve(g.result); };
        g.onerror = () => reject(g.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, key);
  const lpNav = v => lp.locator('nav button', { hasText: NAV_LABELS[v] }).click();
  const seedRow = { id: 'Manual|lock', account: 'Cash', accountType: 'cash', date: '2026-10-05', desc: 'PRIVATE ROW', cents: 1234, kind: 'expense', cat: 'Food', sub: 'Groceries', needsReview: false, edited: true };
  const awayFor = minutes => lp.evaluate(m => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const realNow = Date.now;
    Date.now = () => realNow() + m * 60000;
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Date.now = realNow;
  }, minutes);
  const appShowing = () => lp.locator('#main').isVisible();

  await lp.goto(URL);
  await idbPutTx(seedRow);
  await lp.reload();
  await lpNav('data');
  await lp.click('#lock-on');
  const code = await lp.locator('#recovery-code').textContent();
  assert.match(code, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  await lp.getByRole('button', { name: 'Cancel' }).click();
  await lp.waitForSelector('#lock-on');
  await lp.click('#lock-on');
  const savedCode = await lp.locator('#recovery-code').textContent();
  assert.notEqual(savedCode, code);
  await lp.click('#lock-confirm');
  await lp.waitForSelector('#lock-off');
  step('the lock turns on only after the recovery code is confirmed');

  // Verify encrypted backup does not leak credentialId / lock record.
  const dlP = lp.waitForEvent('download', { timeout: 30000 });
  await lp.getByRole('button', { name: 'Save backup' }).click();
  await lp.locator('dialog h3', { hasText: 'Encrypt backup' }).waitFor();
  await lp.locator('dialog input').fill('lock test pass');
  await lp.getByRole('button', { name: 'Continue' }).click();
  await lp.locator('dialog h3', { hasText: 'Confirm passphrase' }).waitFor();
  await lp.locator('dialog input').fill('lock test pass');
  await lp.getByRole('button', { name: 'Save backup' }).last().click();
  const lockBackupDl = await dlP;
  const lockBackupPath = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'me-lock-')), 'lock.backup');
  await lockBackupDl.saveAs(lockBackupPath);
  const lockBackupJson = fs.readFileSync(lockBackupPath, 'utf8');
  assert.ok(!lockBackupJson.includes('credentialId'));
  step('a backup leaves out this device\'s lock');

  await lp.reload();
  await lp.waitForSelector('#unlock');
  assert.equal(await appShowing(), false);
  assert.equal(await lp.locator('#main').textContent(), '');
  assert.equal(await lp.locator('header').isVisible(), false);
  await faceMatches(false);
  await lp.click('#unlock');
  await lp.locator('.lock-message', { hasText: 'try again' }).waitFor();
  assert.equal(await lp.locator('#main').textContent(), '');
  await faceMatches(true);
  await lp.click('#unlock');
  await lp.waitForSelector('#main .dash, #main h1');
  await lpNav('tx');
  await lp.locator('.tx', { hasText: 'PRIVATE ROW' }).waitFor();
  step('nothing is loaded until the person is confirmed');

  await awayFor(2);
  assert.equal(await lp.locator('#lock').count(), 0);
  await awayFor(4);
  await lp.waitForSelector('#unlock');
  assert.equal(await appShowing(), false);
  await lp.click('#unlock');
  await lp.waitForSelector('#lock', { state: 'detached' });
  assert.equal(await appShowing(), true);
  await lp.locator('.tx', { hasText: 'PRIVATE ROW' }).waitFor();
  step('the app locks again after 3 minutes away and keeps its place');

  await lp.reload();
  await lp.getByRole('button', { name: 'Use recovery code' }).click();
  await lp.getByLabel('Recovery code').fill('AAAA-BBBB-CCCC-DDDD-EEEE');
  await lp.getByRole('button', { name: 'Unlock with code' }).click();
  await lp.locator('.lock-message', { hasText: 'doesn’t match' }).waitFor();
  await lp.getByLabel('Recovery code').fill(savedCode.toLowerCase().replaceAll('-', ''));
  await lp.getByRole('button', { name: 'Unlock with code' }).click();
  await lp.waitForSelector('#lock', { state: 'detached' });
  step('the recovery code gets in, typed in any case, and a wrong one doesn\'t');

  await lpNav('data');
  await lp.getByRole('button', { name: 'Erase all data on this device' }).click();
  await lp.locator('dialog').getByRole('button', { name: 'Erase' }).click();
  await lp.waitForSelector('#drop');
  assert.ok((await idbGetKv('lock')).credentialId);
  step('erasing data leaves the lock on');

  await lp.reload();
  await lp.click('#unlock');
  await lp.waitForSelector('#lock', { state: 'detached' });
  await lpNav('data');
  await faceMatches(false);
  await lp.click('#lock-off');
  await lp.locator('#toast', { hasText: 'still on' }).waitFor();
  await faceMatches(true);
  await lp.click('#lock-off');
  await lp.waitForSelector('#lock-on');
  await lp.reload();
  await lp.waitForSelector('#main h1');
  assert.equal(await lp.locator('#lock').count(), 0);
  step('turning the lock off needs the same check');
  await lockContext.close();

  // Legacy v1 IndexedDB + Pre-v3 Taxonomy + Encrypted Backup Compatibility Test
  const v1Ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const v1Page = await v1Ctx.newPage();
  v1Page.on('pageerror', e => errors.push(e.message));
  v1Page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await v1Page.goto(URL);
  await v1Page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('monthly-expense', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tx')) db.createObjectStore('tx', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['tx', 'kv'], 'readwrite');
        const txStore = tx.objectStore('tx');
        txStore.clear();
        txStore.put({
          id: 'v1-fam-1',
          account: 'Chase Credit Card',
          accountType: 'card',
          date: '2026-09-14',
          desc: 'TARGET SUPPLIES',
          cents: 4520,
          bankCategory: 'Shopping',
          bankType: 'Sale',
          kind: 'expense',
          cat: 'Family',
          sub: 'Consumables',
          needsReview: false,
          edited: true,
        });
        txStore.put({
          id: 'v1-din-1',
          account: 'Chase Credit Card',
          accountType: 'card',
          date: '2026-09-18',
          desc: 'APARTMENT CO',
          cents: 6000,
          bankCategory: 'Bills',
          bankType: 'Sale',
          kind: 'expense',
          cat: 'HousingUtilities',
          sub: 'HomeRent',
          needsReview: false,
          edited: true,
        });
        txStore.put({
          id: 'v1-inc-1',
          account: 'PNC Checking',
          accountType: 'checking',
          date: '2026-09-01',
          desc: 'EMPLOYER PAYROLL',
          cents: -400000,
          bankCategory: 'Income',
          bankType: 'Credit',
          kind: 'income',
          cat: '',
          sub: 'Salary',
          needsReview: false,
          edited: false,
        });
        const kv = tx.objectStore('kv');
        kv.clear();
        kv.put(1, 'taxonomy');
        kv.put({ Family: ['Consumables'], HousingUtilities: ['HomeRent'] }, 'categories');
        kv.put({ Family: 30000, HousingUtilities: 20000 }, 'budgets');
        kv.put({
          'TARGET SUPPLIES': {
            key: 'TARGET SUPPLIES',
            votes: {},
            manual: { kind: 'expense', cat: 'Family', sub: 'Consumables', rowId: 'v1-fam-1' },
          },
        }, 'rules');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await v1Page.reload();
  await v1Page.waitForSelector('#kpi-spent');
  assert.equal(await v1Page.locator('#kpi-spent b').textContent(), '$105.20');
  assert.equal(await v1Page.locator('#kpi-income b').textContent(), '$4,000.00');
  const upgraded = await v1Page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('monthly-expense', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['tx', 'kv'], 'readonly');
        const out = {};
        tx.objectStore('tx').getAll().onsuccess = e => { out.tx = e.target.result; };
        tx.objectStore('kv').get('taxonomy').onsuccess = e => { out.taxonomy = e.target.result; };
        tx.objectStore('kv').get('beforeTaxonomy2').onsuccess = e => { out.snapshot = e.target.result; };
        tx.objectStore('kv').get('budgets').onsuccess = e => { out.budgets = e.target.result; };
        tx.objectStore('kv').get('rules').onsuccess = e => { out.rules = e.target.result; };
        tx.oncomplete = () => { db.close(); resolve(out); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  assert.equal(upgraded.taxonomy, 3);
  assert.ok(upgraded.snapshot && upgraded.snapshot.tx.length === 3, 'beforeTaxonomy2 rollback snapshot kept');
  const famRow = upgraded.tx.find(r => r.id === 'v1-fam-1');
  const houseRow = upgraded.tx.find(r => r.id === 'v1-din-1');
  assert.equal(famRow.cat, 'Household');
  assert.equal(famRow.sub, 'Supplies');
  assert.equal(houseRow.cat, 'Housing');
  assert.equal(houseRow.sub, 'Rent');
  assert.equal(upgraded.budgets.Household, 30000);
  assert.equal(upgraded.budgets.Housing, 20000);
  assert.equal(upgraded.rules['TARGET SUPPLIES'].manual.cat, 'Household');

  // Verify encrypted backup created cleanly restores in migrated app too.
  await v1Page.locator('nav button', { hasText: 'Data' }).click();
  await v1Page.locator('input[type=file]').setInputFiles(backupPath);
  await v1Page.locator('dialog input').fill('correct horse');
  await v1Page.getByRole('button', { name: 'Continue' }).click();
  await v1Page.locator('dialog').getByRole('button', { name: 'Replace' }).click();
  await v1Page.waitForSelector('#kpi-spent');
  await v1Page.selectOption('#month', '2026-10');
  await v1Page.waitForFunction(() => document.querySelector('#kpi-spent b')?.textContent === '$1,218.43');
  assert.equal(await v1Page.locator('#kpi-spent b').textContent(), '$1,218.43');
  step('legacy v1 IndexedDB data, pre-v3 taxonomy, budgets, rules, and encrypted backups migrate seamlessly');
  await v1Ctx.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  step('no console errors and no requests to any other site');

  await browser.close();
  server.close();
  console.log('All browser checks passed.');
})().catch(err => { console.error(err); process.exit(1); });
