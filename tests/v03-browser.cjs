const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
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
const output = process.env.SCREENSHOT_DIR || "test-results";
fs.mkdirSync(output, { recursive: true });
(async () => {
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch("http://127.0.0.1:4173/test-ai-code/")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : process.env.CI
          ? {}
          : { channel: "chrome" }),
      headless: true,
    });
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 1000 },
          colorScheme: theme,
        });
        await context.addInitScript(
          (theme) => localStorage.setItem("second-brain-theme", theme),
          theme,
        );
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto("http://127.0.0.1:4173/test-ai-code/");
        const date = await page.locator("#date").inputValue();
        const legacy = {
          version: 2,
          records: [
            {
              id: "synthetic-water",
              date,
              type: "water",
              status: "已飲用",
              note: "合成驗證紀錄",
              time: "09:00",
              volume: 350,
            },
          ],
        };
        await page
          .locator("#import")
          .setInputFiles({
            name: "synthetic-v02.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(legacy)),
          });
        await page.locator("#yes").click();
        assert.match(await page.locator(".water .metric").innerText(), /350/);
        await page.locator("[data-add=meal]").click();
        await page.locator("[name=name]").fill("合成餐點 · 排版驗證");
        await page.locator("[name=orderDate]").fill(date);
        await page.locator("[name=amount]").fill("120");
        await page.locator("[name=paid]").selectOption("yes");
        await page.locator("[name=paymentDate]").fill(date);
        await page.locator("[name=startTime]").fill("12:00");
        await page.locator("[name=endTime]").fill("12:30");
        await page.locator("[name=status]").selectOption("部分");
        await page.locator("#edit-form .save").click();
        assert.match(
          await page.locator(".meal .metric").innerText(),
          /完整食用尚無資料/,
        );
        assert.match(
          await page.locator(".spending .metric").innerText(),
          /120/,
        );
        await page.locator(".meal summary").click();
        await page.locator(".meal [data-edit]").click();
        await page.locator("[name=status]").selectOption("吃完");
        await page.locator("#edit-form .save").click();
        assert.match(
          await page.locator(".meal .metric").innerText(),
          /1 筆吃完/,
        );
        await page.locator("[data-add=sunlight]").click();
        await page.locator("[name=source]").fill("Apple Watch（合成）");
        await page.locator("[name=note]").fill("數值未知測試");
        await page.locator("#edit-form .save").click();
        assert.match(
          await page.locator(".sunlight .metric").innerText(),
          /^尚無資料/,
        );
        await page.locator(".sunlight summary").click();
        await page.locator(".sunlight [data-edit]").click();
        await page.locator("[name=minutes]").fill("15");
        await page.locator("#edit-form .save").click();
        assert.match(await page.locator(".sunlight .metric").innerText(), /15/);
        await page.reload();
        assert.match(
          await page.locator(".meal .metric").innerText(),
          /1 筆吃完/,
        );
        assert.equal(await page.locator(".record-details[open]").count(), 0);
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert(
          (await page
            .locator(".spending")
            .evaluate((e) => e.getBoundingClientRect().bottom)) <
            (width === 390 ? 1100 : 1000),
          "compact summary height",
        );
        await page.screenshot({
          path: path.join(output, `v03-${width}-${theme}.png`),
          fullPage: true,
        });
        await page.locator("[data-add=meal]").click();
        assert.equal(
          await page
            .locator("#editor")
            .evaluate((e) => e.scrollWidth > e.clientWidth),
          false,
        );
        await page.screenshot({
          path: path.join(output, `v03-${width}-${theme}-editor.png`),
          fullPage: true,
        });
        await page.locator("#cancel").click();
        for (const type of ["meal", "sunlight"]) {
          await page.locator(`.${type} summary`).click();
          await page.locator(`.${type} [data-delete]`).click();
          await page.locator("#yes").click();
          assert.equal(
            await page.locator(`.${type} .metric`).innerText(),
            "尚無資料",
          );
        }
        // Import same ID with conflicting fields: local water must remain 350.
        legacy.records[0].volume = 999;
        await page
          .locator("#import")
          .setInputFiles({
            name: "conflict.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(legacy)),
          });
        await page.locator("#confirm").waitFor({ state: "visible" });
        assert.match(await page.locator("#confirm").innerText(), /衝突 1/);
        await page.locator("#yes").click();
        assert.match(await page.locator(".water .metric").innerText(), /350/);
        assert.equal(errors.length, 0, errors.join("\n"));
        console.log(
          `PASS v0.3 ${width}px ${theme}: legacy import, meal/sunlight CRUD, null, paid/partial separation, conflict, reload, layout, screenshots`,
        );
        await context.close();
      }
    console.log(`Chrome ${browser.version()}`);
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
