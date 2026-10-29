const { chromium } = require("playwright-core");
const assert = require("assert/strict"),
  fs = require("fs");
const { spawn } = require("child_process");
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
process.on("exit", () => server.kill());
(async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch("http://127.0.0.1:4173/test-ai-code/");
      if (response.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.env.CI
        ? {}
        : { channel: "chrome" }),
    headless: true,
  });
  let passed = 0;
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("http://127.0.0.1:4173/test-ai-code/");
    assert.equal(
      await page.locator(".metric").filter({ hasText: "尚無資料" }).count(),
      9,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("[data-add=water]").click();
    await page.locator("[name=volume]").fill("321");
    await page.locator("#edit-form .save").click();
    await page.locator("#editor").waitFor({state:"hidden"});
    await page.locator(".water summary").click();
    await page.locator(".water [data-edit]").click();
    await page.locator("[name=volume]").fill("456");
    await page.locator("#edit-form .save").click();
    await page.locator("#editor").waitFor({state:"hidden"});
    assert.match(await page.locator(".water .metric").innerText(), /456/);
    await page.reload();
    assert.match(await page.locator(".water .metric").innerText(), /456/);
    await page.locator("#prev").click();
    assert.equal(await page.locator(".water .metric").innerText(), "尚無資料");
    await page.locator("#next").click();
    { const prior = await page.locator("html").getAttribute("data-theme"); await page.locator("#theme").click(); await page.waitForFunction(p => document.documentElement.dataset.theme !== p, prior); }
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.reload();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.locator("[data-add=coffee]").click();
    await page.locator("[name=payment]").selectOption("voucher");
    await page.locator("[name=status]").selectOption("飲用中");
    await page.locator("[name=volume]").fill("123");
    await page.locator("#edit-form .save").click();
    await page.locator("#editor").waitFor({state:"hidden"});
    assert.equal(await page.locator(".coffee .metric").innerText(), "尚無資料");
    assert.equal(
      await page.locator(".spending .metric").innerText(),
      "尚無資料",
    );
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await downloadPromise;
    const backup = fs.readFileSync(await download.path());
    const parsed = JSON.parse(backup);
    assert.equal(parsed.records.length, 2);
    await page.locator(".water details").evaluate((e) => (e.open = true));
    await page.locator(".water [data-delete]").click();
    await page.locator("#no").click();
    assert.equal(await page.locator(".water [data-edit]").count(), 1);
    await page.locator(".water details").evaluate((e) => (e.open = true));
    await page.locator(".water [data-delete]").click();
    await page.locator("#yes").click();
    await page.locator("#confirm").waitFor({state:"hidden"});
    assert.equal(await page.locator(".water .metric").innerText(), "尚無資料");
    await page.locator("#import").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: backup,
    });
    await page.locator("#confirm").waitFor({ state: "visible" });
    await page.locator("#no").click();
    assert.equal(await page.locator(".water .metric").innerText(), "尚無資料");
    await page.locator("#import").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: backup,
    });
    await page.locator("#yes").click();
    await page.locator("#confirm").waitFor({state:"hidden"});
    assert.match(await page.locator(".water .metric").innerText(), /456/);
    await page.locator("#import").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: backup,
    });
    await page.locator("#yes").click();
    await page.locator("#confirm").waitFor({state:"hidden"});
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("second-brain-lite-v2")).records
            .length,
      ),
      2,
    );
    await page.locator("#import").setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{bad"),
    });
    await page.waitForFunction(() =>
      document.querySelector("#message").textContent.includes("匯入失敗"),
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("second-brain-lite-v2")).records
            .length,
      ),
      2,
    );
    { const prior = await page.locator("html").getAttribute("data-theme"); await page.locator("#theme").click(); await page.waitForFunction(p => document.documentElement.dataset.theme !== p, prior); }
    assert.equal(errors.length, 0, errors.join("\n"));
    assert(requests.every((u) => u.startsWith("http://127.0.0.1:4173/")));
    console.log(
      `PASS ${viewport.width}px: empty/CRUD/correction/date/theme/reload/export/import cancel-confirm-repeat-invalid/no outbound/errors/overflow`,
    );
    passed++;
    await context.close();
  }
  // Liquid-intake regression: total includes confirmed drinks, not pending water.
  const fluidsContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fluidsPage = await fluidsContext.newPage();
  await fluidsPage.goto("http://127.0.0.1:4173/test-ai-code/");
  const fluidDate = await fluidsPage.locator("#date").inputValue();
  const common = (id, type, status, volume) => ({
    id, type, status, volume, date: fluidDate, note: "", time: "",
  });
  const fluidRecords = [
    { ...common("coffee-a", "coffee", "已飲用", 480), amount: null, payment: "voucher" },
    { ...common("tea-a", "beverage", "已飲用", 700), name: "合成麥茶", amount: null, paid: null, paymentDate: null, startTime: "", endTime: "" },
    { ...common("cola-a", "beverage", "已飲用", 700), name: "合成可樂", amount: null, paid: null, paymentDate: null, startTime: "", endTime: "" },
    { ...common("water-a", "water", "飲用中", null), capacity: 800, startTime: "19:33", endTime: "" },
  ];
  await fluidsPage.locator("#import").setInputFiles({
    name: "synthetic-fluids.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 6, records: fluidRecords })),
  });
  await fluidsPage.locator("#yes").click();
    await fluidsPage.locator("#confirm").waitFor({state:"hidden"});
  assert.match(await fluidsPage.locator(".hydration .metric").innerText(), /1,880/);
  assert.match(await fluidsPage.locator(".beverage .metric").innerText(), /1,400/);
  assert.equal(await fluidsPage.locator(".water .metric").innerText(), "尚無資料");
  await fluidsPage.locator(".water details").evaluate((e) => (e.open = true));
  await fluidsPage.locator(".water [data-edit]").click();
  await fluidsPage.locator("[name=status]").selectOption("已飲用");
  await fluidsPage.locator("[name=volume]").fill("800");
  await fluidsPage.locator("[name=endTime]").fill("20:30");
  await fluidsPage.locator("#edit-form .save").click();
    await fluidsPage.locator("#editor").waitFor({state:"hidden"});
  assert.match(await fluidsPage.locator(".hydration .metric").innerText(), /2,680/);
  assert.match(await fluidsPage.locator(".water .metric").innerText(), /800/);
  const fluidBackup = await fluidsPage.evaluate(() => JSON.parse(localStorage.getItem("second-brain-lite-v2")));
  assert.equal(fluidBackup.version, 7);
  assert.equal(fluidBackup.records.length, 4);
  console.log("PASS synthetic liquid intake: pending excluded, confirmed counted once, editable water");
  await fluidsContext.close();
  const c = await browser.newContext();
  await c.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw Error("blocked");
    };
  });
  const p = await c.newPage();
  await p.goto("http://127.0.0.1:4173/test-ai-code/");
  assert(await p.locator("[data-add=water]").isDisabled());
  assert.match(await p.locator("#message").innerText(), /停止寫入/);
  console.log("PASS Chromium localStorage read failure");
  await c.close();
  console.log(
    `Chromium ${browser.version()}: ${passed} viewport suites passed`,
  );
  await browser.close();
  server.kill();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
