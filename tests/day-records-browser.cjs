const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, devices } = require("playwright-core");

const origin = "http://127.0.0.1:4202";
const url = origin + "/test-ai-code/";
const key = "second-brain-lite-v2";

async function selectDate(page, day) {
  await page.locator("#date").fill(day);
  await page.locator("#date").dispatchEvent("change");
}

async function readRecords(page) {
  return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
}

async function upload(page, input, contents) {
  await page.locator(input).setInputFiles({
    name: "synthetic-day-records.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(contents)),
  });
}

async function prepareDeletion(page) {
  await page.locator("#day-delete").tap();
  await page.locator("[data-day-next]").tap();
  await page.locator("[data-day-download]").waitFor();
}

async function run() {
  const vite = path.resolve("node_modules/vite/bin/vite.js");
  const server = spawn(process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", "4202", "--strictPort"], { stdio: "ignore" });
  let browser;
  try {
    let ready = false;
    for (let i = 0; !ready && i < 100; i++) {
      ready = await fetch(url).then((response) => response.ok, () => false);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "built site did not start");
    const { day, dayRecordsFixture } = await import("./fixtures/day-records.js");
    const original = dayRecordsFixture();
    const launch = process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.env.CI ? {} : { channel: "chrome" };
    browser = await chromium.launch(launch);
    const page = await browser.newPage({ ...devices["iPhone 13"], deviceScaleFactor: 1, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(url);
    await upload(page, "#import", original);
    await page.locator("#yes").tap();
    await page.locator("#confirm").waitFor({ state: "hidden" });
    await selectDate(page, day);
    assert.equal(await page.locator(".sleep .metric").innerText(), "511 分鐘");
    assert.match(await page.locator(".coffee .metric").innerText(), /480 mL/);
    const initial = await readRecords(page);

    await page.locator(".day-management summary").tap();
    await page.locator("#day-delete").tap();
    assert.match(await page.locator("#day-dialog").innerText(), /2026-11-27.*13 筆/);
    assert.match(await page.locator("#day-dialog").innerText(), /咖啡 2 筆/);
    assert.equal(await page.locator("[data-day-download]").isVisible(), false);
    await page.locator("[data-day-cancel]").tap();
    assert.deepEqual(await readRecords(page), initial);
    await prepareDeletion(page);
    assert.deepEqual(await readRecords(page), initial);
    const downloaded = page.waitForEvent("download");
    await page.locator("[data-day-download]").tap();
    const download = await downloaded;
    assert.match(download.suggestedFilename(), /second-brain-day-2026-11-27/);
    const backup = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    assert.equal(backup.day, day);
    assert.equal(backup.records.records.length, 13);
    assert(backup.records.records.every((row) => row.date === day));
    assert.deepEqual(backup.settings, {});
    const output = "test-results/day-deletion";
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: output + "/confirm.png" });
    await page.locator("[data-day-cancel]").tap();
    assert.deepEqual(await readRecords(page), initial);

    await prepareDeletion(page);
    await page.locator("[data-day-next]").tap();
    await page.locator("#day-dialog").waitFor({ state: "hidden" });
    assert.deepEqual((await readRecords(page)).records.map(({ id }) => id), ["neighbor"]);
    assert.equal(await page.locator(".coffee .metric").innerText(), "尚無資料");
    assert.equal(await page.locator("#day-delete").isDisabled(), true);
    await page.locator('[data-metric-view="coffee"]').tap();
    assert.match(await page.locator("#metric-dialog .metric-detail-overview").innerText(), /本機沒有紀錄/);
    await page.locator(".metric-detail-close").tap();
    await page.locator("#journal").tap();
    await page.locator("#journal-download").waitFor();
    assert.doesNotMatch((await page.locator(".journal-page-text").allTextContents()).join(""), /合成小誌|741 NT\$/);
    await page.locator("#journal-close").tap();

    await upload(page, "#import", original);
    await page.locator("#confirm").waitFor({ state: "visible" });
    assert.match(await page.locator("#confirm").innerText(), /略過 13 筆已刪除/);
    await page.locator("#yes").tap();
    await page.locator("#confirm").waitFor({ state: "hidden" });
    assert.equal((await readRecords(page)).records.length, 1);

    await page.reload();
    await selectDate(page, day);
    await page.locator(".day-management summary").tap();
    await page.locator("#day-restore").tap();
    await page.locator("#yes").tap();
    await page.locator("#confirm").waitFor({ state: "hidden" });
    assert.deepEqual((await readRecords(page)).records.map(({ id }) => id).sort(), initial.records.map(({ id }) => id).sort());
    assert.equal(await page.locator(".sleep .metric").innerText(), "511 分鐘");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await prepareDeletion(page);
    await page.locator("[data-day-next]").tap();
    await page.locator("#day-dialog").waitFor({ state: "hidden" });
    await upload(page, "#complete-import", backup);
    await page.locator("#backup-apply").tap();
    await page.locator("#backup-dialog").waitFor({ state: "hidden" });
    assert.deepEqual((await readRecords(page)).records.map(({ id }) => id).sort(), initial.records.map(({ id }) => id).sort());
    assert.deepEqual(errors, []);
    console.log("PASS day records: two confirmations, date scope, portable backup, stale import, statistics, journal and recovery after reload");
  } finally {
    await browser?.close();
    server.kill();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
