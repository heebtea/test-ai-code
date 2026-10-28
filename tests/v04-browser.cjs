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
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : process.env.CI
          ? {}
          : { channel: "chrome" }),
      headless: true,
    });
    const output = process.env.SCREENSHOT_DIR || "test-results";
    fs.mkdirSync(output, { recursive: true });
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 1000 },
        });
        await ctx.addInitScript(
          (theme) => localStorage.setItem("second-brain-theme", theme),
          theme,
        );
        const page = await ctx.newPage();
        let errs = [];
        page.on("pageerror", (e) => errs.push(e.message));
        await page.goto("http://127.0.0.1:4173/test-ai-code/");
        assert.equal(await page.locator("#ocr-open, #ocr-drafts, #ocr-dialog").count(), 0, "OCR must not appear in the application");
        const date = await page.locator("#date").inputValue();
        const v2 = {
          version: 2,
          records: [
            {
              id: "synthetic-water",
              type: "water",
              date,
              status: "已飲用",
              note: "合成紀錄",
              time: "09:00",
              volume: 350,
            },
          ],
        };
        await page.locator("#import").setInputFiles({
          name: "old-v2.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(v2)),
        });
        await page.locator("#yes").click();
        await page.locator(".water .card-toggle").click();
        assert.equal(
          await page.locator(".water details").getAttribute("open"),
          "",
        );
        await page.locator(".water .card-toggle").click();
        assert.equal(
          await page.locator(".water details").getAttribute("open"),
          null,
        );
        const v3 = {
          version: 3,
          records: [
            {
              id: "old-sun",
              type: "sunlight",
              date,
              status: "已記錄",
              note: "",
              time: "",
              minutes: 12,
              source: "合成",
            },
          ],
        };
        await page.locator("#import").setInputFiles({
          name: "old-v3.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(v3)),
        });
        await page.locator("#yes").click();
        await page.locator("[data-add=coffee]").click();
        await page.locator("[name=payment]").selectOption("voucher");
        await page.locator("[name=volume]").fill("400");
        await page.locator("[name=status]").selectOption("飲用中");
        await page.locator("[name=startTime]").fill("10:00");
        await page.locator("[name=endTime]").fill("10:30");
        await page.locator("#edit-form .save").click();
        assert.equal(
          await page.locator(".coffee .metric").innerText(),
          "尚無資料",
        );
        await page.locator("[data-add=meal]").click();
        await page.locator("[name=name]").fill("合成餐點");
        await page.locator("[name=status]").selectOption("部分");
        await page.locator("[name=startTime]").fill("12:00");
        await page.locator("[name=endTime]").fill("12:30");
        await page.locator("#edit-form .save").click();
        await page.locator(".timeline > summary").click();
        await page.locator("[data-add=event]").click();
        await page.locator("[name=name]").fill("合成重要事件");
        await page.locator("[name=time]").fill("08:30");
        await page.locator("#edit-form .save").click();
        await page.locator(".timeline > summary").click();
        let times = await page.locator(".timeline time").allTextContents();
        assert.deepEqual(times, [
          "08:30",
          "09:00",
          "10:00",
          "10:30",
          "12:00",
          "12:30",
        ]);
        await page.locator(".timeline-event").first().click();
        assert.match(
          await page.locator("#event-detail").innerText(),
          /合成重要事件/,
        );
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        );
        await page.locator("#photo-input").setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: png,
        });
        await page
          .locator("#event-detail .error")
          .getByText("照片已存於此瀏覽器。")
          .waitFor();
        await page.locator("#detail-close").click();
        await page.reload();
        await page.locator(".timeline > summary").click();
        await page
          .locator(".timeline-event img:not([hidden])")
          .first()
          .waitFor();
        await page.screenshot({
          path: path.join(output, `v04-${width}-${theme}.png`),
          fullPage: true,
        });
        const before = await page.evaluate(() =>
          localStorage.getItem("second-brain-lite-v2"),
        );
        await page.locator("#journal").click();
        assert.equal(
          await page
            .locator("#journal-canvas")
            .evaluate((e) => e.width / e.height),
          9 / 16,
        );
        await page.screenshot({
          path: path.join(output, `v04-${width}-${theme}-journal.png`),
          fullPage: true,
        });
        const downloading = page.waitForEvent("download");
        await page.locator("#journal-download").click();
        const download = await downloading;
        const buffer = fs.readFileSync(await download.path());
        assert.equal(buffer.readUInt32BE(16), 1080);
        assert.equal(buffer.readUInt32BE(20), 1920);
        assert.equal(
          await page.evaluate(() =>
            localStorage.getItem("second-brain-lite-v2"),
          ),
          before,
        );
        await page.locator("#journal-close").click();
        const jsonDownload = page.waitForEvent("download");
        await page.locator("#export").click();
        const backup = JSON.parse(
          fs.readFileSync(await (await jsonDownload).path(), "utf8"),
        );
        assert.equal(backup.version, 5);
        assert.equal(backup.records.length, 5);
        const eventId = backup.records.find((r) => r.type === "event").id;
        assert.equal(JSON.stringify(backup).includes("image/png"), false);
        await page.locator(".timeline-event").first().click();
        await page.locator("#detail-delete").click();
        await page.locator("#yes").click();
        await page.waitForFunction(
          (id) =>
            !JSON.parse(
              localStorage.getItem("second-brain-lite-v2"),
            ).records.some((r) => r.id === id),
          eventId,
        );
        const photoLeft = await page.evaluate(
          (id) =>
            new Promise((resolve, reject) => {
              const q = indexedDB.open("second-brain-private-photos", 1);
              q.onerror = () => reject(q.error);
              q.onsuccess = () => {
                const db = q.result;
                const get = db
                  .transaction("photos")
                  .objectStore("photos")
                  .get(id);
                get.onsuccess = () => {
                  resolve(Boolean(get.result));
                  db.close();
                };
                get.onerror = () => reject(get.error);
              };
            }),
          eventId,
        );
        assert.equal(photoLeft, false);
        await page.locator("#prev").click();
        assert.equal(
          await page.locator(".water .metric").innerText(),
          "尚無資料",
        );
        await page.locator("#next").click();
        assert.match(await page.locator(".water .metric").innerText(), /350/);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert.deepEqual(errs, []);
        console.log(
          `PASS v0.4 ${width}px ${theme}: card, timeline, photo persistence, PNG, JSON, date, layout`,
        );
        await ctx.close();
      }
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
