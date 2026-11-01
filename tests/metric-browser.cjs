const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const server = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1",
  "--port", "4173", "--strictPort",
], { stdio: "ignore" });
process.on("exit", () => server.kill());
(async () => {
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch("http://127.0.0.1:4173/test-ai-code/")).ok) break; }
      catch { /* preview is starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
        : process.env.CI ? {} : { channel: "chrome" }),
      headless: true,
    });
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("http://127.0.0.1:4173/test-ai-code/");
      for (const type of ["coffee", "water", "beverage", "activity", "sunlight", "spending"]) {
        const button = page.locator(".card." + type + " [data-metric-view]");
        assert.equal(await button.count(), 1, type + ": missing period button");
        await button.click();
        assert.equal(await page.locator("#metric-dialog").isVisible(), true);
        const tabs = page.locator("#metric-dialog .metric-period-tabs button");
        assert.equal(await tabs.count(), 3);
        assert.match(await page.locator("#metric-dialog").innerText(), /有紀錄 0/);
        for (const i of [1, 2, 0]) {
          await tabs.nth(i).click();
          assert.equal(await tabs.nth(i).getAttribute("aria-pressed"), "true");
          assert.equal(await page.locator("#metric-dialog").isVisible(), true);
        }
        await page.locator("#metric-dialog .metric-detail-close").click();
        assert.equal(await page.locator("#metric-dialog").isVisible(), false);
      }
      assert.deepEqual(errors, [], "no browser errors");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await context.close();
    }
    console.log("Six-category daily/weekly/monthly browser smoke passed");
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
