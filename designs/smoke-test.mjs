// Optional: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node smoke-test.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) errors.push(`Unexpected network request: ${request.url()}`);
  });
  const open = name => page.goto(new URL(`${name}.html`, import.meta.url).href);
  const files = ['index', '01-workbench', '02-mission-control', '03-channel-desk', '04-topology', '05-signal-board', '06-fleet-admin', '07-policy-admin'];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const file of files) {
      await open(file);
      await page.waitForSelector('h1');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${file} overflow at ${width}`);
    }
  }
  await open('01-workbench');
  await page.locator('[data-channel="testing"]').click();
  assert.equal(await page.locator('.message').count(), 1);
  await page.locator('textarea').fill('<img src=x onerror=alert(1)> sample');
  await page.locator('button[type=submit]').click();
  assert.equal(await page.locator('.message').count(), 2);
  assert.equal(await page.locator('.message img').count(), 0);
  await open('06-fleet-admin');
  await page.locator('#agent-search').fill('Haven');
  assert.equal(await page.locator('[data-agent-row]:visible').count(), 1);
  await page.locator('#agent-search').fill('missing');
  assert.ok(await page.locator('#no-agents').isVisible());
  await page.locator('#bulk-remove').click();
  assert.match(await page.locator('#dialog-body').textContent(), /Scout/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open('07-policy-admin');
  await page.locator('[data-project="mypi"]').click();
  await page.getByRole('button', { name: 'Confirm preview', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-project="mypi"]').textContent === 'Unblock project');
  await page.locator('#close-channel').selectOption('general');
  await page.locator('#archive-channel').click();
  assert.match(await page.locator('#toast').textContent(), /protected/);
  await page.locator('[data-toggle="global"]').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(await page.locator('[data-toggle="global"]').isChecked());
  await page.locator('[data-toggle="global"]').click();
  await page.getByRole('button', { name: 'Confirm preview', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-toggle="global"]').checked);
  await open('04-topology');
  await page.locator('[data-node="Haven"]').click();
  assert.match(await page.locator('#node-detail').textContent(), /Haven/);
  await open('05-signal-board');
  await page.locator('[data-address="Nova"]').click();
  assert.equal(await page.locator('[name=destination]').inputValue(), '@Nova');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-sample').click();
  assert.equal((await downloadPromise).suggestedFilename(), 'mesh-design-sample.jsonl');
  assert.deepEqual(errors, []);
  console.log('PASS: eight pages at desktop/mobile; offline, overflow, channel filtering, safe sample messages, search, empty state, confirmations, policy toggles, topology, addressing, and export.');
} finally {
  await browser.close();
}
