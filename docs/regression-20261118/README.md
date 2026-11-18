# Second Brain Lite 回歸審查 · 2026-11-18

基準為 main 的 `269f0a74c968d70bb0026774d8cd350c6a52511e`（合併 PR #23），測試分支為 `qa/regression-20261118`。使用合成 JSON、獨立瀏覽器儲存區與本機 production preview。沒有連接使用者帳戶或操作正式站。

## 結果與證據

| 項目 | 判定 | 核對內容 |
| --- | --- | --- |
| 單元與整合測試 | 通過 | 基準 147 項。加入回歸案例後 21 個測試檔、152 項通過。涵蓋資料模型、DOM、匯入、備份、SQL 與唯讀服務的合成測試。 |
| 靜態檢查與建置 | 通過 | Node 24.22.1，`npm ci`、lint、Vite production build 完成。當次 production dependency audit 回報 0。 |
| 三欄小誌 | 通過 | Chromium 153 與 WebKit 27.2，在 390、430 px 觸控視窗輸出三頁，各 1080 × 1920。逐筆核對原始備註、起訖／紀錄時間及交易金額，檢查實際繪字位置、欄寬、頁序、檔名。每頁下載檔與對應預覽畫布的 PNG SHA-256 相同。 |
| 選日統計 | 通過 | 390 px 觸控下以同一份匯入檔核對七類 × 日／週／月共 21 個檢視，逐列比對 ID、狀態、備註、已填時間及金額。日檢視直接看原始明細，週／月點長條後保留圖表。另於 390、1440 px 驗證重複選日、空日、退費入帳日與返回趨勢。睡眠另驗總時數、四階段、分數與原始紀錄。 |
| AI 私人快照 | 通過 | 同份資料核對 11 筆購買、NT$638、7 筆待確認。另以跨日資料驗證 OCR／手動／量測來源、修改與補正時間、已付款但日期未知、未付款、未知金額、退款、回補及兌換。下載與模擬系統分享內容相同。具名隱私測試檢查預設與明示勾選、照片／模板／草稿排除；操作前後核對本機紀錄。 |
| 其他既有功能 | 通過 | 全套 13 支 Chromium 瀏覽器腳本含 CRUD、OCR 實際辨識、批次審核、模板、備份還原及模擬同步。另執行 4 支 WebKit 腳本，涵蓋備份、統計、AI 與小誌。 |
| WebKit 暫時性工作階段還原含圖備份 | 功能受限，回復測試通過 | 本環境的暫時性 IndexedDB 可寫字串及位元組，寫入 Blob 失敗。UI 顯示原始錯誤與回復結果，重匯出確認紀錄、照片及模板均保持原狀。相同引擎以兩個獨立的暫存磁碟 profile 測試一般模式，照片與模板圖片可完整往返。 |
| 實體 iPhone 與正式服務 | 未驗證 | iOS Safari、原生分享面板、逐頁存入「檔案」、真實 Drive／Supabase／OAuth 連線與正式部署。Linux WebKit 觸控測試與模擬分享的範圍止於瀏覽器。 |

[命令與輸出](commands.txt) · [基準瀏覽器紀錄](baseline-browser.txt) · [改前失敗案例](baseline-red.txt) · [僅有結束時間的案例](missing-start-red.txt)

## 可重算的數字

合成交易逐筆金額為 100、22、30、95、210、45、36、34、15、22、29，合計 NT$638。待確認的 6 筆餐點及 1 筆飲品另列於花費明細，因此選日顯示 18 筆，已付合計只取前 11 筆。當日咖啡 480 mL、其他已喝完飲品 600 mL，飲用中的水保留未知。餐點 6 筆中，本人攝取已確認 5 餐。步數 8,600、日照 65 分鐘。共用資料來源在 `tests/fixtures/journal-flow.js`，測試入口再加入可逐筆識別的合成備註及時間。

[三欄預覽](after-390.png) · [PNG 第 1 頁](multi-page-1.png) · [第 2 頁](multi-page-2.png) · [第 3 頁](multi-page-3.png) · [花費選日](selected-spending.png) · [AI 預覽](ai-preview.png) · [WebKit 小誌](webkit-journal.png) · [WebKit 回復畫面](webkit-private-rollback.png)

## 基準問題與分支修正

| 原本可觀察到的問題 | 修正與驗證 |
| --- | --- |
| 日誌文字輸出遺漏獨立紀錄時間。飲品只有結束時間時，小誌會把紀錄時間放到開始欄位。 | 各段保留原紀錄時間。起訖缺值明列未知，紀錄時間另列。新增原始資料對照案例，包含 11:22 補登、09:25 飲完、開始時間未知。 |
| 舊版花費明記未付款，小誌卻顯示付款未確認，且以紀錄日當付款日。 | 已付舊紀錄保留既有入帳日規則，未付舊紀錄顯示未付款、付款日未知，排除於已付合計。統計另標示已付但日期待核對。 |
| 餐點明細固定標「份」，不同單位會直接相加。 | 明細使用原單位，個人攝取量依單位分別加總。驗證 2 顆與 0.5 碗各自保留，已食用餐數仍為 2 餐。 |
| WebKit 的字寬稽核用另一組字型重新量測，與畫布實際字型不同。備份測試在圖檔寫入遭拒時只等到逾時。 | 稽核記錄繪字當下字寬與座標，和各欄內界比對。備份保留 IndexedDB 請求錯誤，分別測試一般工作階段完整還原與暫時性工作階段回復。 |
| README 仍記載單頁滿版會停用下載、多頁待開發。數份舊交付文件易被誤讀為現況。 | README 更新為目前的逐頁匯出、選日統計、快照及同步原型說明。歷史報告保留當時的基準與結果，另附本次審查入口。 |

## 合併後的測試缺口

基準 CI 在目標為 main 的 PR 與推送 work 時執行。合併後的 main 只觸發 Pages 流程，其測試範圍為單元測試與建置。這使合併提交缺少瀏覽器回歸結果，也缺乏 WebKit 證據。

本分支建議 main push 觸發 CI，執行 Chromium 全套與 WebKit 重點流程，截圖及稽核檔以提交 SHA 命名，測試失敗時亦嘗試保存。Pages 仍是獨立工作流程，部署不會等待這項 CI。本次未觸發 main push，合併後的觸發與執行結果需到該次提交才能核實。

## 重跑

使用 Node 24，在獨立 checkout 執行下列指令。所有腳本都使用合成紀錄。完整 Chromium 及四個 WebKit 命令正常結束才算通過。

```sh
npm ci
npm test
npm run lint
npm run build
npx playwright-core install --with-deps chromium webkit
CI=1 npm run test:browser
export BROWSER_ENGINE=webkit SCREENSHOT_DIR=test-results/webkit
node tests/v05-browser.cjs
node tests/stats-v2-browser.cjs
node tests/ai-bridge-browser.cjs
node tests/journal-flow-browser.cjs
```

本次 Linux 系統 Chromium 無法建立單例程序 socket，改以 `CHROME_PATH` 指定 Chromium 153 headless shell。WebKit 27.2 使用 Playwright 的 WPE 執行檔與暫存目錄內的 Debian 動態函式庫。補齊執行依賴後略過僅查系統安裝位置的主機檢查；應用程式的測試斷言照常執行。
