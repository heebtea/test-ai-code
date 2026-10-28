const { chromium } = require("playwright-core"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
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
(async () => {
  let b;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch("http://127.0.0.1:4173/test-ai-code/")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    b = await chromium.launch({
      ...(process.env.CI
        ? {}
        : process.env.CHROME_PATH
          ? { executablePath: process.env.CHROME_PATH }
          : { channel: "chrome" }),
      headless: true,
    });
    const output = process.env.SCREENSHOT_DIR || "test-results";
    fs.mkdirSync(output, { recursive: true });
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        const c = await b.newContext({
          viewport: { width, height: width === 390 ? 844 : 1000 },
        });
        await c.addInitScript(
          (t) => localStorage.setItem("second-brain-theme", t),
          theme,
        );
        const p = await c.newPage();
        const errors = [];
        p.on("pageerror", (e) => errors.push(e.message));
        await p.goto("http://127.0.0.1:4173/test-ai-code/");
        await p.locator("#ocr-open").click();
        await p.locator("#ocr-add-manual").click();
        const row = p.locator(".ocr-row").first();
        await row.locator("summary").click();
        await row.locator("[data-field=type]").selectOption("sleep");
        await row.locator("[data-field=date]").fill("2026-01-02");
        await row.locator("[data-field=minutes]").fill("380");
        await row.locator("[data-field=status]").selectOption("已完成");
        await row.locator("[data-verified]").check();
        await row.locator("[data-select]").check();
        await p.locator("#ocr-add-manual").click();
        assert.equal(await p.locator("[data-select]:checked").count(), 1);
        const second = p.locator(".ocr-row").last();
        await second.locator("summary").click();
        await second.locator("[data-field=type]").selectOption("spending");
        await second.locator("[data-field=date]").fill("2026-01-02");
        await second.locator("[data-field=amount]").fill("55");
        assert.equal(
          await second.locator(".ocr-caption strong").innerText(),
          "花費",
        );
        assert.match(
          await second.locator(".ocr-caption small").innerText(),
          /55/,
        );
        await second.locator("summary").click();
        await p.screenshot({
          path: path.join(output, `batch-${width}-${theme}.png`),
          fullPage: true,
        });
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await p.locator("#ocr-commit").click();
        assert.match(await p.locator("#confirm").innerText(), /成功 1 筆/);
        assert.match(await p.locator("#confirm").innerText(), /待處理 1 筆/);
        await p.locator("#no").click();
        assert.equal(
          await p.evaluate(() => localStorage.getItem("second-brain-lite-v2")),
          null,
        );
        await p.locator("#ocr-commit").click();
        await p.locator("#yes").click();
        await p
          .locator("#ocr-result")
          .getByText(/成功 1 筆/)
          .waitFor();
        const rec = await p.evaluate(
          () =>
            JSON.parse(localStorage.getItem("second-brain-lite-v2")).records,
        );
        assert.equal(rec.length, 1);
        assert.equal(rec[0].type, "sleep");
        assert.equal(rec[0].minutes, 380);
        assert.equal(await p.locator(".ocr-row").count(), 1);
        assert.deepEqual(errors, []);
        await c.close();
        console.log(
          `PASS batch ${width} ${theme}: compact review, preserve edits, one confirmation, pending payment, cancel, local write`,
        );
      }
  } finally {
    await b?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

