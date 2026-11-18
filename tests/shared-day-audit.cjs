const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// The expected ledger is derived from the imported fixture, independently of the app models.
async function checkSharedDay(page, data, day, output) {
  const records = data.records;
  const purchases = records.filter(r => r.type === 'spending');
  const pending = records.filter(r => ['meal', 'beverage'].includes(r.type) && r.paid == null);
  const expected = {
    coffee: [480, '480 mL'], water: [null, '有紀錄但尚未完成'], beverage: [600, '600 mL'],
    meal: [5, '5 餐'], activity: [8600, '8,600 步'], sunlight: [65, '65 分鐘'],
    spending: [638, '638 NT$'],
  };
  for (const [type, [amount, label]] of Object.entries(expected)) {
    const matching = type === 'spending' ? [...purchases, ...pending] : records.filter(r => r.type === type);
    await page.locator(`[data-metric-view="${type}"]`).tap();
    for (const [index, period] of ['day', 'week', 'month'].entries()) {
      const list = page.locator('.metric-record-list');
      if (period === 'day') {
        assert.equal(await page.locator('.metric-detail-overview > strong').first().innerText(), label);
      } else {
        await page.locator('.metric-period-tabs button').nth(index).tap();
        const bar = page.locator(`[data-day="${day}"]`);
        await bar.tap();
        assert.equal(await bar.locator('.metric-bar-value').innerText(), String(amount ?? '—'));
        assert.ok((await list.locator('h3').first().innerText()).includes(label));
      }
      const rows = await list.locator('li').allTextContents();
      assert.deepEqual(rows.map(row => row.split(' · ID ').at(-1)).sort(), matching.map(r => r.id).sort());
      for (const record of matching) {
        const row = rows.find(line => line.endsWith(' · ID ' + record.id));
        for (const fact of [record.note, record.status, record.time, record.startTime, record.endTime].filter(Boolean)) {
          assert.ok(row.includes(fact), `${period} ${type} ${record.id} missing ${fact}`);
        }
        if (record.amount != null) assert.ok(row.includes(record.amount + ' NT$'));
      }
      if (period === 'month' && type === 'spending') {
        await list.locator('h3').first().scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(output, 'selected-spending.png')});
      }
    }
    await page.locator('.metric-detail-close').tap();
  }
  await page.locator('#ai-share').tap();
  const download = page.waitForEvent('download');
  await page.locator('[data-share-action=download]').tap();
  const snapshot = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
  assert.deepEqual(snapshot.transactions.map(r => [r.id, r.amount, r.transactionDate]),
    purchases.map(r => [r.id, r.amount, day]));
  assert.deepEqual(snapshot.pendingTransactions.map(r => r.id).sort(), pending.map(r => r.id).sort());
  const serialized = JSON.stringify(snapshot);
  for (const record of records) assert.ok(!serialized.includes(record.note));
  await page.screenshot({path: path.join(output, 'ai-preview.png')});
  await page.locator('.ai-share-close').tap();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('second-brain-lite-v2'))), data);
  console.log('PASS same imported day: 21 day/week/month views, exact IDs, times, source notes, 11 charges/638 and 7 pending rows reconciled with downloaded AI JSON.');
}
module.exports = { checkSharedDay };
