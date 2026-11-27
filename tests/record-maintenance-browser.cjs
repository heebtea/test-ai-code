const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium, webkit, devices } = require("playwright-core");

const stateKey = "second-brain-lite-v2";
const engine = process.env.BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const output = process.env.SCREENSHOT_DIR || `test-results/record-maintenance-${engine}`;

async function start(root, port, command) {
  const vite = path.resolve("node_modules/vite/bin/vite.js");
  const url = `http://127.0.0.1:${port}/test-ai-code/`;
  const server = spawn(process.execPath, [vite, ...(command === "preview" ? [command] : []), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(url).then((response) => response.ok, () => false)) return { server, url };
    if (server.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.kill();
  throw Error(`Vite server unavailable at ${url}`);
}

const selectFile = async (page, input, data) => {
  await input.setInputFiles({
    name: "synthetic-records.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.locator("#confirm").waitFor({ state: "visible" });
};
const selectDay = async (page, day) => {
  await page.locator("#date").fill(day);
  await page.locator("#date").dispatchEvent("change");
};
const closeWait = (page, selector = "#confirm") => page.locator(selector).waitFor({ state: "hidden" });
const state = (page) => page.evaluate((key) => localStorage.getItem(key), stateKey);
const snap = (page, name, scope) => (scope ? page.locator(scope) : page).screenshot({ path: path.join(output, name + ".png") });

async function baseline(page, day, initial, corrections) {
  const input = page.locator("#import");
  await selectFile(page, input, initial);
  await page.locator("#yes").click();
  await closeWait(page);
  await selectDay(page, day);
  assert.match(await page.locator(".sleep .metric").innerText(), /511 分鐘/);
  assert.match(await page.locator(".water .metric").innerText(), /尚無資料/);
  await snap(page, "before-summary", ".dashboard");
  await selectFile(page, input, corrections);
  assert.match(await page.locator("#confirm").innerText(), /衝突 2 筆/);
  await snap(page, "before-import");
  await page.locator("#yes").click();
  await closeWait(page);
  assert.match(await page.locator(".coffee .metric").innerText(), /480/);
  assert.match(await page.locator(".water .metric").innerText(), /尚無資料/);
  console.log("PASS baseline: same-ID corrections ignored, water displayed as missing");
}

async function verify(page, day, initial, corrections) {
  const input = page.locator("#import");
  await selectFile(page, input, initial);
  assert.match(await page.locator("#import-counts").innerText(), /新增 14 筆/);
  await page.locator("#yes").tap();
  await closeWait(page);
  await selectDay(page, day);
  const before = await state(page);
  assert.match(await page.locator(".sleep .metric").innerText(), /8 小時 31 分鐘（511 分鐘）[\s\S]*80 分/);
  assert.match(await page.locator(".coffee .metric").innerText(), /已完飲 2 杯[\s\S]*480 mL[\s\S]*1 杯容量未知/);
  assert.match(await page.locator(".water .metric").innerText(), /900 mL 飲用中[\s\S]*實際攝取量待確認/);
  assert.match(await page.locator(".activity .metric").innerText(), /7,172/);
  assert.match(await page.locator(".sunlight .metric").innerText(), /127/);
  assert.match(await page.locator(".spending .metric").innerText(), /741/);
  await snap(page, "after-before-correction", ".dashboard");

  await selectFile(page, input, corrections);
  await page.locator("#import-mode").selectOption("incoming");
  assert.match(await page.locator("#import-counts").innerText(), /更新 2 筆/);
  await page.locator("#no").tap();
  assert.equal(await state(page), before);
  await selectFile(page, input, corrections);
  assert.match(await page.locator("#import-counts").innerText(), /更新 0 筆.*衝突 2 筆.*略過 2 筆/);
  await page.locator("#import-mode").selectOption("review");
  assert.equal(await page.locator("#yes").isDisabled(), true);
  assert.match(await page.locator(".record-review-table").first().innerText(), /最後補正時間/);
  assert.match(await page.locator(".record-review-table").first().innerText(), /591/);
  const compare = page.locator("[data-review-row]");
  for (const row of await compare.all()) {
    await row.locator("[data-import-choice]").selectOption("incoming");
  }
  assert.match(await page.locator("#import-counts").innerText(), /更新 2 筆/);
  assert.equal(await page.locator("#confirm").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true);
  await page.locator("#confirm").evaluate((dialog) => { dialog.scrollTop = 0; });
  await snap(page, "after-import");

  // A failed single atomic write contains both corrections and a prospective new row.
  const mixed = { version: 8, records: [...corrections.records, { ...initial.records.at(-1), id: "new-uncommitted" }] };
  await page.locator("#no").tap();
  await selectFile(page, input, mixed);
  await page.locator("#import-mode").selectOption("incoming");
  await page.evaluate((key) => {
    const setter = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        Storage.prototype.setItem = setter;
        throw new DOMException("synthetic full disk", "QuotaExceededError");
      }
      return setter.call(this, name, value);
    };
  }, stateKey);
  await page.locator("#yes").tap();
  await page.locator("#confirm .error").filter({ hasText: "synthetic full disk" }).waitFor();
  assert.equal(await state(page), before);
  await page.locator("#no").tap();

  await selectFile(page, input, corrections);
  await page.locator("#import-mode").selectOption("incoming");
  await page.locator("#yes").tap();
  await closeWait(page);
  const after = await state(page);
  assert.deepEqual(JSON.parse(after).records.map(({ id }) => id), initial.records.map(({ id }) => id));
  assert.match(await page.locator(".coffee .metric").innerText(), /已完飲 2 杯，共 1,071 mL/);
  assert.match(await page.locator(".water .metric").innerText(), /900 mL 已飲用/);
  assert.match(await page.locator(".hydration .metric").innerText(), /1,971 mL 已飲用/);
  assert.match(await page.locator(".spending .metric").innerText(), /741/);
  await snap(page, "after-summary", ".dashboard");
  await selectFile(page, input, corrections);
  assert.match(await page.locator("#import-counts").innerText(), /完全相同 2 筆/);
  await page.locator("#yes").tap();
  await closeWait(page);
  assert.equal(await state(page), after);

  for (const [type, value] of [["coffee", "1,071"], ["water", "900"], ["spending", "741"]]) {
    await page.locator(`[data-metric-view="${type}"]`).tap();
    const metric = page.locator("#metric-dialog");
    for (const tab of ["day", "week", "month"]) {
      await metric.locator(`[data-focus="tab-${tab}"]`).tap();
      if (tab !== "day") await metric.locator(`[data-day="${day}"]`).tap();
      const summary = tab === "day" ? metric.locator(".metric-detail-overview > strong") : metric.locator(`[data-day="${day}"]`);
      const number = (await summary.innerText()).replaceAll(",", "");
      assert.ok(number.includes(value.replaceAll(",", "")), `${type} ${tab}: ${number}`);
    }
    await metric.locator(".metric-detail-close").tap();
  }
  await page.locator("#journal").tap();
  await page.locator("#journal-download").waitFor();
  const text = (await page.locator(".journal-page-text").allTextContents()).join("").replace(/\s+/g, " ");
  for (const value of ["1971 mL", "591 mL", "900 mL", "741 NT$"]) assert.ok(text.includes(value), text);
  await snap(page, "after-journal");
  await page.locator("#journal-close").tap();

  const management = page.locator(".day-management");
  await management.locator("summary").tap();
  await page.locator("#day-delete").tap();
  const confirm = page.locator("#day-dialog");
  assert.match(await confirm.innerText(), /2026-11-27.*13 筆/);
  assert.match(await confirm.innerText(), /咖啡 2 筆/);
  await confirm.locator("[data-day-next]").tap();
  await confirm.locator("[data-day-download]").waitFor();
  assert.equal(await state(page), after);
  await snap(page, "after-delete-preview");
  await confirm.locator("[data-day-cancel]").tap();
  assert.equal(await state(page), after);
  await page.locator("#day-delete").tap();
  await confirm.locator("[data-day-next]").tap();
  await confirm.locator("[data-day-download]").waitFor();
  const pendingDownload = page.waitForEvent("download");
  await confirm.locator("[data-day-download]").tap();
  const download = await pendingDownload;
  assert.match(download.suggestedFilename(), /2026-11-27/);
  const backup = JSON.parse(fs.readFileSync(await download.path()));
  assert.equal(backup.records.records.length, 13);
  assert.ok(backup.records.records.every((record) => record.date === day));
  await confirm.locator("[data-day-next]").tap();
  await closeWait(page, "#day-dialog");
  assert.deepEqual(JSON.parse(await state(page)).records.map(({ id }) => id), ["neighbor"]);
  assert.equal(await page.locator(".coffee .metric").innerText(), "尚無資料");
  await page.locator('[data-metric-view="coffee"]').tap();
  assert.match(await page.locator("#metric-dialog .metric-detail-overview").innerText(), /本機沒有紀錄/);
  await page.locator(".metric-detail-close").tap();
  await page.locator("#journal").tap();
  await page.locator("#journal-download").waitFor();
  const emptyJournal = (await page.locator(".journal-page-text").allTextContents()).join("");
  assert.doesNotMatch(emptyJournal, /合成小誌|741 NT\$/);
  await page.locator("#journal-close").tap();

  await selectFile(page, input, initial);
  assert.match(await page.locator("#import-counts").innerText(), /略過 13 筆/);
  await page.locator("#yes").tap();
  await closeWait(page);
  assert.equal(JSON.parse(await state(page)).records.length, 1);
  await page.reload();
  await selectDay(page, day);
  await management.locator("summary").tap();
  await page.locator("#day-restore").tap();
  await page.locator("#yes").tap();
  await closeWait(page);
  assert.equal(JSON.parse(await state(page)).records.length, initial.records.length);
  assert.match(await page.locator(".hydration .metric").innerText(), /1,971/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log(`PASS ${engine} iPhone 13 profile: correction, cancellation, atomic failure, day/week/month, journal, backup, deletion and durable undo`);
}

(async () => {
  const root = process.env.BASELINE_ROOT || process.cwd();
  const { server, url } = await start(root, process.env.BASELINE_ROOT ? 4199 : engine === "webkit" ? 4200 : 4198, process.env.BASELINE_ROOT ? "dev" : "preview");
  let browser;
  try {
    fs.mkdirSync(output, { recursive: true });
    const { day, recordMaintenanceFixture } = await import("./fixtures/record-maintenance.js");
    const { initial, corrections } = recordMaintenanceFixture();
    browser = engine === "webkit"
      ? await webkit.launch()
      : await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ["--disable-gpu"] } : process.env.CI ? {} : { channel: "chrome" });
    const page = await browser.newPage({ ...devices["iPhone 13"], deviceScaleFactor: 1, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    await page.goto(url);
    if (process.env.BASELINE_ROOT) await baseline(page, day, initial, corrections);
    else await verify(page, day, initial, corrections);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
