const { chromium } = require("playwright-core"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { spawn } = require("node:child_process");
const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4192",
      "--strictPort",
    ],
    { stdio: "ignore" },
  ),
  url = "http://127.0.0.1:4192/test-ai-code/",
  day = "2026-11-02";
const coffee = {
  id: "synthetic-coffee",
  type: "coffee",
  date: day,
  status: "飲用中",
  time: "09:00",
  note: "合成資料",
  payment: "purchase",
  purchaseDate: day,
  amount: 60,
  volume: 480,
  startTime: "09:00",
  endTime: "",
};
const meal = {
  id: "synthetic-lunch",
  type: "meal",
  date: day,
  status: "吃完",
  time: "12:00",
  note: "合成長文字：".repeat(30),
  name: "合成便當，三份分給本人和家人",
  mealType: "lunch",
  orderStatus: "ordered",
  paid: true,
  paymentDate: day,
  orderDate: day,
  amount: 300,
  startTime: "12:00",
  endTime: "12:30",
  quantity: 3,
  consumedQuantity: 1,
  familyQuantity: 2,
  remainingQuantity: 0,
};
const seed = {
  version: 8,
  records: [
    coffee,
    meal,
    {
      ...coffee,
      id: "finished",
      date: "2026-11-03",
      status: "已飲用",
      payment: "voucher",
      purchaseDate: null,
      amount: null,
      volume: 480,
    },
    {
      id: "sun",
      type: "sunlight",
      date: day,
      status: "已記錄",
      time: "",
      note: "synthetic",
      source: "合成",
      minutes: 0,
    },
    {
      id: "refund",
      type: "spending",
      date: day,
      status: "已付款",
      time: "13:00",
      note: "合成退費",
      transactionKind: "refund",
      paymentDate: "2026-11-04",
      amount: 20,
    },
  ],
};
let browser;
async function snapshot(page, name) {
  await page.locator("#metric-dialog").evaluate((d) => (d.scrollTop = 0));
  await page.screenshot({ path: "test-results/" + name + ".png" });
}
(async () => {
  try {
    for (let i = 0; i < 70; i++) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : process.env.CI
          ? {}
          : { channel: "chrome" }),
    });
    fs.mkdirSync("test-results", { recursive: true });
    for (const width of [390, 1440]) {
      const context = await browser.newContext({
          viewport: { width, height: 900 },
          ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
          timezoneId: "America/Los_Angeles",
        }),
        page = await context.newPage(),
        errors = [],
        requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requests.push(r.url()));
      await page.goto(url);
      await page.locator(".dashboard").waitFor();
      await page.evaluate((d) => {
        localStorage.setItem("second-brain-lite-v2", JSON.stringify(d));
        localStorage.setItem("second-brain-theme", "dark");
      }, seed);
      await page.reload();
      await page.locator("#date").fill(day);
      await page.locator("#date").dispatchEvent("change");
      const before = await page.evaluate(() =>
        localStorage.getItem("second-brain-lite-v2"),
      );
      await page.locator("[data-metric-view=meal]").click();
      assert.match(
        await page.locator("#metric-dialog").innerText(),
        /本人已食用餐數/,
      );
      assert.match(
        await page.locator("#metric-dialog").innerText(),
        /本人 1 份.*他人 2 份/,
      );
      await snapshot(page, "stats-v2-" + width + "-day");
      const tabs = page.locator(".metric-period-tabs button");
      await tabs.nth(1).click();
      assert.match(
        await page.locator("#metric-dialog").innerText(),
        /2026-11-02 ～ 2026-11-08/,
      );
      assert.equal(await page.locator("[data-day]").count(), 7);
      await snapshot(page, "stats-v2-" + width + "-week");
      await page.locator(".metric-chart").scrollIntoViewIfNeeded();
      await page.screenshot({path: "test-results/stats-v2-"+width+"-week-trend.png"});
      await page.locator('[data-day="2026-11-02"]').click();
      assert.match(
        await page.locator(".metric-record-list").innerText(),
        /2026-11-02.*已確認合計/,
      );
      assert.equal(await page.locator("#metric-dialog").isVisible(), true);
      await tabs.nth(2).click();
      assert.equal(await page.locator("[data-day]").count(), 30);
      assert.match(
        await page.locator("#metric-dialog").innerText(),
        /每週比較/,
      );
      assert.match(await page.locator(".metric-week-compare").innerText(), /本機無紀錄 · 有效 0 天/);
      await snapshot(page, "stats-v2-" + width + "-month");
      await page.locator(".metric-week-compare").scrollIntoViewIfNeeded();
      await page.screenshot({path: "test-results/stats-v2-"+width+"-month-comparison.png"});
      await page.getByRole("button", { name: "上一月", exact: true }).click();
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /2026-10-01 ～ 2026-10-31/,
      );
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /本機沒有紀錄/,
      );
      await snapshot(page, "stats-v2-" + width + "-empty");
      await page.getByRole("button", { name: "下一月", exact: true }).click();
      assert.equal(await page.locator("[data-day]").count(), 30);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("second-brain-lite-v2")),
        before,
      );
      await page.locator(".metric-detail-close").click();
      await page.locator("[data-metric-view=coffee]").click();
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /有紀錄但尚未完成/,
      );
      // Update the same local ID, then refresh the open statistics dialog; no write by statistics.
      await page.evaluate(() => {
        const key = "second-brain-lite-v2",
          d = JSON.parse(localStorage.getItem(key));
        const r = d.records.find((r) => r.id === "synthetic-coffee");
        r.status = "已飲用";
        r.volume = 350;
        localStorage.setItem(key, JSON.stringify(d));
      });
      await page.getByRole("button", { name: "重新讀取本機資料" }).click();
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /350 mL/,
      );
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /共 1 筆/,
      );
      await page.locator(".metric-detail-close").click();
      await page.reload();
      await page.locator("#date").fill(day);
      await page.locator("#date").dispatchEvent("change");
      await page.locator("[data-metric-view=spending]").click();
      await tabs.nth(2).click();
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /340 NT\$/,
      );
      assert.match(
        await page.locator(".metric-detail-overview").innerText(),
        /20 NT\$/,
      );
      await page.locator('[data-day="2026-11-04"]').click();
      assert.match(
        await page.locator(".metric-record-list").innerText(),
        /-20 NT\$/,
      );
      assert.equal(
        await page
          .locator("#metric-dialog")
          .evaluate((d) => d.scrollWidth > d.clientWidth),
        false,
      );
      await page.locator(".metric-detail-close").click();
      await page.locator("[data-sleep-view]").click();
      assert.equal(await page.locator("#sleep-dialog").isVisible(), true);
      assert.match(
        await page.locator("#sleep-dialog").innerText(),
        /6.*月|六個月/,
      );
      await page.locator("#sleep-dialog").evaluate((d) => d.close());
      // Default applies only on an explicit voucher selection and never overwrites a correction.
      await page.locator("[data-add=coffee]").click();
      await page.locator("[name=payment]").selectOption("voucher");
      assert.equal(await page.locator("[name=volume]").inputValue(), "480");
      await page.locator("[name=volume]").fill("320");
      await page.locator("[name=payment]").selectOption("purchase");
      await page.locator("[name=payment]").selectOption("voucher");
      assert.equal(await page.locator("[name=volume]").inputValue(), "320");
      await page.locator("#cancel").click();
      await page.locator("[data-metric-view=meal]").click();
      await page.evaluate(() =>
        localStorage.setItem("second-brain-lite-v2", "{broken"),
      );
      await page.getByRole("button", { name: "重新讀取本機資料" }).click();
      assert.match(
        await page.locator("[role=alert].metric-load-error").innerText(),
        /資料載入或解析失敗/,
      );
      assert.equal(await page.locator(".metric-detail-overview").count(), 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("second-brain-lite-v2")),
        "{broken",
      );
      await snapshot(page, "stats-v2-" + width + "-error");
      assert.deepEqual(errors, []);
      assert.ok(
        requests.every(
          (r) =>
            r.startsWith(url) || r.startsWith("data:") || r.startsWith("blob:"),
        ),
      );
      await context.close();
      console.log(
        `PASS Statistics V2 ${width}px: day/week/month/empty/error screenshots, meal self-vs-family, chart drilldown, previous/next month, read-only refresh, same-ID update, refund date, voucher default override, sleep preserved, no outbound or overflow`,
      );
    }
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
