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
  let browser;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch("http://127.0.0.1:4173/test-ai-code/")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({
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
        const c = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 1000 },
        });
        await c.addInitScript(
          (t) => localStorage.setItem("second-brain-theme", t),
          theme,
        );
        const p = await c.newPage();
        let errors = [],
          external = [];
        p.on("pageerror", (e) => errors.push(e.message));
        p.on("request", (r) => {
          if (
            !r.url().startsWith("http://127.0.0.1:4173/") &&
            !r.url().startsWith("blob:") &&
            !r.url().startsWith("data:")
          )
            external.push(r.url());
        });
        await p.goto("http://127.0.0.1:4173/test-ai-code/");
        await p.locator("#template-view>summary").click();
        assert.match(
          await p.locator(".template-sheet").innerText(),
          /尚無資料/,
        );
        await p.locator(".template-block summary").first().click();
        await p.locator("[data-template-add=journal]").first().click();
        await p.locator("[name=theme]").fill("合成示範主題");
        await p.locator("[name=highlight]").fill("合成測試亮點");
        await p.locator("[name=mood]").fill("平靜");
        await p.locator("[name=todo]").fill("合成待辦");
        await p.locator("#edit-form .save").click();
    await p.locator("#editor").waitFor({state:"hidden"});
        await p.locator("#template-new").click();
        for (const [mime, ext] of [
          ["image/png", "png"],
          ["image/jpeg", "jpg"],
          ["image/webp", "webp"],
        ]) {
          const raw = await p.evaluate((m) => {
            const c = document.createElement("canvas");
            c.width = 40;
            c.height = 40;
            const x = c.getContext("2d");
            x.fillStyle = "#8bc1d2";
            x.fillRect(0, 0, 40, 40);
            return c.toDataURL(m).split(",")[1];
          }, mime);
          await p.locator("#template-image").setInputFiles({
            name: "synthetic." + ext,
            mimeType: mime,
            buffer: Buffer.from(raw, "base64"),
          });
          await p.locator("#reference-preview").waitFor({ state: "visible" });
          await p.locator(".swatch").first().waitFor();
        }
        await p.locator("[name=name]").fill("合成樣式");
        await p.locator("[name=background]").fill("#e6eff0");
        await p.locator("[name=accent]").fill("#205465");
        await p.locator("[name=font]").selectOption("serif");
        await p.locator("[name=slot0]").selectOption("food");
        await p.locator("[name=slot3]").selectOption("overview");
        assert.match(
          await p.locator("#draft-preview").innerText(),
          /餐點、飲品、花費/,
        );
        await p.locator("#template-form button[type=submit]").click();
        await p.locator("#template-view[open]").waitFor();
        assert.equal(
          (await p.locator("#template-select").inputValue()) !== "default",
          true,
        );
        assert.match(
          await p.locator(".template-sheet").innerText(),
          /合成示範主題/,
        );
        assert.equal(
          await p
            .locator(".template-block summary")
            .first()
            .innerText()
            .then((s) => s.includes("餐點")),
          true,
        );
        for (const summary of await p.locator(".template-block summary").all())
          await summary.click();
        await p.screenshot({
          path: path.join(output, `template-${width}-${theme}.png`),
          fullPage: true,
        });
        await p.reload();
        await p.waitForFunction(
          () => document.querySelector("#template-select").value !== "default",
        );
        await p.locator("#template-view>summary").click();
        assert.match(
          await p.locator(".template-sheet").innerText(),
          /合成示範主題/,
        );
        const selectedId = await p.locator("#template-select").inputValue();
        await p.locator("#template-select").selectOption("default");
        assert.equal(
          await p.locator("#template-select").inputValue(),
          "default",
        );
        await p.locator("#template-select").selectOption(selectedId);
        await p.locator("#template-edit").click();
        assert.equal(await p.locator("[name=name]").inputValue(), "合成樣式");
        await p.locator("[name=name]").fill("臨時修改");
        await p.locator("#template-restore").click();
        assert.equal(await p.locator("[name=name]").inputValue(), "合成樣式");
        await p.locator("#template-close").click();
        const before = await p.evaluate(() =>
          localStorage.getItem("second-brain-lite-v2"),
        );
        await p.locator("#journal").click();
        await p.screenshot({
          path: path.join(output, `template-${width}-${theme}-png-preview.png`),
          fullPage: true,
        });
        const dl = p.waitForEvent("download");
        await p.locator("#journal-download").click();
        const img = fs.readFileSync(await (await dl).path());
        assert.equal(img.readUInt32BE(16), 1080);
        assert.equal(img.readUInt32BE(20), 1920);
        assert.equal(
          await p.evaluate(() => localStorage.getItem("second-brain-lite-v2")),
          before,
        );
        await p.locator("#journal-close").click();
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await p.locator("#template-edit").click();
        await p.locator("#template-delete").click();
        await p.locator("#yes").click();
    await p.locator("#confirm").waitFor({state:"hidden"});
        await p.waitForFunction(
          () => document.querySelector("#template-select").value === "default",
        );
        assert.equal(
          await p.evaluate(() => localStorage.getItem("second-brain-lite-v2")),
          before,
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        console.log(
          `PASS template ${width}px ${theme}: image formats, palette, mapping, save, reload, restore, real records, PNG and privacy`,
        );
        await c.close();
      }
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
