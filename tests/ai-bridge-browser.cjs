const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { chromium, webkit, devices } = require('playwright-core');

const url = 'http://127.0.0.1:4193/test-ai-code/';
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4193', '--strictPort',
], { stdio: 'ignore' });

(async () => {
  const { data, from, to, correctedAt } = await import('./fixtures/ai-bridge.js');
  for (let attempts = 0; ; attempts++) {
    if (await fetch(url).then(response => response.ok, () => false)) break;
    if (attempts === 59) throw Error('Preview server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const isWebkit = process.env.BROWSER_ENGINE === 'webkit';
  const executablePath = isWebkit ? undefined : process.env.CHROME_PATH;
  const browser = await (isWebkit ? webkit : chromium).launch({ executablePath });
  try {
    const page = await browser.newPage({
      ...devices['iPhone 13'], timezoneId: 'Asia/Taipei', acceptDownloads: true,
    });
    const external = [];
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    const storageKey = 'second-brain-lite-v2';
    await page.evaluate(({ storageKey, data }) => localStorage.setItem(storageKey, JSON.stringify(data)), { storageKey, data });
    await page.reload();
    await page.locator('#date').fill(from);
    await page.locator('#date').dispatchEvent('change');
    await page.locator('#ai-share').tap();
    await page.locator('#ai-range').selectOption('custom');
    await page.locator('#ai-to').fill(to);
    await page.locator('#ai-to').dispatchEvent('change');
    const meal = page.locator('.ai-share-types input[value=meal]');
    await meal.uncheck();
    assert.ok(!(await page.locator('#ai-share-preview').inputValue()).includes('"mealType"'));
    await meal.check();

    await page.evaluate(() => {
      window.syntheticFileShare = null;
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw Error('Unsupported'); } });
    });
    await page.locator('[data-share-action=native]').tap();
    assert.match(await page.locator('.ai-share-status').textContent(), /下載 JSON/);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => files[0].type === 'application/json' });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
        window.syntheticFileShare = { name: files[0].name, text: await files[0].text() };
      } });
    });
    await page.locator('[data-share-action=native]').tap();
    await page.waitForFunction(() => window.syntheticFileShare);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-share-action=download]').tap();
    const download = await downloadEvent;
    const bytes = await fs.readFile(await download.path(), 'utf8');
    const shared = await page.evaluate(() => window.syntheticFileShare);
    assert.deepEqual(shared, { name: download.suggestedFilename(), text: bytes });
    assert.ok(!bytes.includes('PRIVATE_TEST_'));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), JSON.stringify(data));
    assert.deepEqual(external, []);
    const snap = JSON.parse(bytes);
    assert.deepEqual(snap.range, { from, to });
    assert.equal(snap.latestRecordUpdatedAt, correctedAt);
    assert.equal(snap.records.length, 8);
    assert.equal(snap.pendingTransactions.length, 2);
    assert.equal(snap.transactions.length, 4);
    if (process.env.BRIDGE_TEST_SNAPSHOT) await fs.writeFile(process.env.BRIDGE_TEST_SNAPSHOT, bytes, { mode: 0o600 });
    console.log(`PASS ${isWebkit ? 'WebKit' : 'Chromium'}: iPhone viewport touch, custom range/categories, privacy, unavailable-share fallback, identical share/download and unchanged local data`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.kill());
