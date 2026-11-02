# 圖表觸控明細（未部署）

基於 PR #19 head b2305e7b602e1b1fe6a062f77a67d1efbe14b715，獨立分支 feat/statistics-chart-touch。main 仍為 0fcedcd0e33673d47b9e1a381f6968a06a01ef1f。本次只新增圖表互動與明細，沒有修改統計公式、schema、同步或使用者紀錄。

## 使用

七項統計的週／月長條（包含零或空白日期）可直接觸控選日，原圖與期間保留，下方顯示當日數值與完整逐筆時間線。「返回整體趨勢／顯示整段期間」還原期間明細。月圖橫向位置保留，選取有外框及 aria-pressed。飲品顯示開始／結束時間，未知明示；餐點仍區分開吃、完食與本人份量。花費列當日已確認淨支出、已付款購買、退費、回補及每筆付款／入帳金額。

睡眠週／月長條改為至少44px按鈕，選日後下方顯示當日總時數、原公式分數、各睡眠階段、完整逐筆明細與原始分段時間。核心睡眠如由既有公式推算，仍標示推算；缺值不補零。「返回整體趨勢」清除選取並回到圖表；可反覆查看同日或不同日期。六個月月平均圖保留原行為，不將月平均冒充某一天。

睡眠期間公式未改：週為往回7日、月為往回30日；其他七類維持週一至週日與自然月。此處沿用使用者要求的現有公式，未統一日期口徑。

## 測試與限制

- 56項單元測試、lint、build 通過，見 verification/chart-touch。
- 全套6組 Chromium 瀏覽器回歸以 browser.txt 為證。390px 使用 hasTouch/isMobile 與真正 Playwright tap；1440px 使用 click。七類統計及睡眠皆測試週/月、反覆選日、返回趨勢與 localStorage 前後完全相同。
- 合成資料：睡眠450分鐘、分數85、深睡60/REM90/核心300/清醒20；咖啡同ID更新、餐點本人/家人、跨日退費，無真人資料。
- 初輪花費選日發現日彙總子欄位讀取錯誤，已改用既有 extra，聚焦回歸及完整回歸重新執行。
- WebKit下載完成，但 install-deps 因環境 setgroups/setegid 權限失敗，未執行 WebKit。**實體 iPhone Safari 未驗證**，Chromium觸控模擬不等於實機驗收。
- Safari待驗收：在隔離測試環境使用合成資料，觸控週/月各日期、橫滑月底、再次選同日、返回趨勢、睡眠階段、空白日、長明細及關閉視窗；確認資料不變。不得以正式私人資料測試。
- 本分支承接PR #19，仍有其schema v8與同步分支整合限制；本次沒有進一步變更schema，不代表ChatGPT已能寫入Lite。

## 截圖

[390px睡眠單日明細](screenshots/chart-touch/chart-touch-390-sleep-week.png)

[1440px睡眠月圖選日](screenshots/chart-touch/chart-touch-1440-sleep-month.png)

主要修改：src/metric-detail.js、src/sleep-detail.js、src/style.css、tests/sleep-detail.test.js、tests/stats-v2-browser.cjs。
