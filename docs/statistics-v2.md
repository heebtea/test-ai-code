# 日／週／月統計 V2：交付與驗證

2026-11-02（Asia/Taipei）。獨立分支 `feat/statistics-v2`，基於重新 fetch 的 main `0fcedcd0e33673d47b9e1a381f6968a06a01ef1f`（PR #18）。沒有合併／修改 main、部署網站、修改 OAuth/MCP/Supabase 檔案或使用真實私人紀錄。

## 完成項目與前後差異

| 項目 | main 原狀 | V2 |
|---|---|---|
| 類別 | 六項，不含餐點 | 咖啡、飲水、其他飲品、活動、日照、花費、餐點共七項 |
| 日 | 合計與簡單明細 | 時間排序、品項、數量、狀態、適用金額與穩定 ID；未知明示 |
| 週 | 週一到週日，靜態圖 | 七日可點選圖、合計、平均、記錄天數、有效數值天數、當日下鑽 |
| 月 | 自然月靜態圖 | 全月每日圖、每週比較（裁切至本月）、前月／次月切換、明細與異常提醒 |
| 平均 | 無 | 已確認總量 ÷ 有有效數值天數；缺日不補零，明確零納入；標示可能僅部分已確認 |
| 餐點 | 只有未確認／部分／吃完與付款資料 | 餐別、選定／訂購、付款、開吃、完食分開顯示；購買／本人／他人／剩餘份量可分別輸入 |
| 活動 | 加總已完成紀錄，靠文字提醒不重疊 | 依明確開始／結束區間偵測；重疊、矛盾或多筆未標區間的活動不冒然加總 |
| 花費 | 統計 UI 有退款欄，但 validator/editor 無 transactionKind | 可實際填購買／退費／回補，依實際付款／入帳日期計算；未知金額不補零 |
| 咖啡券 | 沒有輸入預設值 | 明確選擇兌換券時，僅空白容量預填480；保留手動修正與未知舊值，不在統計時補值 |
| 資料來源 | 開啟時傳入的記憶體快照 | 開啟、期間／日期切換與重新讀取按鈕取本機現況；同筆更新立即重新計算 |
| 錯誤／空資料 | 多種情況皆「尚無數值」 | 本機無紀錄／未完成／數值或本人份量未知／區間待核對／載入解析失敗分開 |
| 睡眠 | 天／週／月／6個月 | 原程式及統計口徑完全保留，瀏覽器檢查入口與六個月選項 |

操作：七項卡片的「日／週／月」→ 切換期間 → 上／下一日、週、月或日期輸入 → 點圖上日期查看當日明細。月圖可橫向滑動；每個日期按鈕至少44px，長文字換行。無需關閉重開視窗。

## 正確性口徑

- **飲品**：僅「已飲用」累計完成容量；已購買、已兌換、飲用中不算喝完。完成但容量未知者保留杯／筆數並顯示容量缺漏。穩定 ID 的 upsert 更新原筆，統計不新增紀錄。
- **餐點**：一筆明確本人食用（consumedQuantity > 0，且狀態部分／吃完）計一餐；另顯示本人完食餐數與食用份量。購買三份、本人一份、家人兩份＝本人一餐／一份，花費仍全額。舊紀錄只有「吃完」但未標本人份量，不猜為本人食用，列待核對。餐別不從時間或文字猜測。
- **活動**：不對重疊部分按比例猜測步數。重疊區間的各筆都排除步數／分鐘並保留明細；明確不重疊者可合計。多筆已完成活動有任何一筆缺區間，當日不能證明彼此獨立，暫不合計。單筆無區間仍照實列示並提醒補區間。這是保守口徑，可能少計但不製造精確的假合計。
- **日照**：明確0分鐘是有效數值；null、缺日不是0。
- **花費**：餐點／飲品依 paymentDate，咖啡依 purchaseDate，花費新欄位依 paymentDate；舊花費未帶此欄位時維持原本 date 歸帳。明確 paymentDate:null 不推定日期。未付款／日期未知列入待確認明細，不計合計。淨支出＝已確認購買－退費－回補，可為負值；圖表顯示有符號淨額。餐費直接使用同一交易 ID，不另造花費。
- 平均分母是有效數值天數，另列全部有紀錄天數；有部分未知時明確提醒合計／平均不完整。
- 週一至週日；月為完整自然月，每週比較不借用相鄰月份數值；Asia/Taipei 決定今日，日期加減使用 UTC 日曆計算避免主機時區／DST偏移。
- 統計唯讀，不寫 localStorage、IndexedDB、不自動修正原紀錄。載入／JSON解析失敗保留原始字串並顯示錯誤，不能當成無紀錄。

## 資料格式及分支相容性

必要新增的選填欄位集中在 `src/stat-fields.js`：餐點 `mealType/orderStatus`，活動 `startTime/endTime`，花費 `paymentDate`；使用這些新欄位的紀錄保存為 **schema v8**。

數量 `quantity/consumedQuantity/familyQuantity/remainingQuantity`、`unit/transactionKind/provenance/updatedAt` 沿用 PR #16 的 v7 名稱。validator 接受v2–v8；舊資料讀取或看統計不升版，只有明確儲存新增欄位才升到必要版本。匯入／合併保留較高版本；不降版、不改 ID、不重設儲存。

**v8 備份不可直接匯入舊正式站或未更新驗證器的 v0.6/v0.7**。本分支不是同步版本，也沒有部署。正式上線前應先備份舊格式，完成各分支的 schema/backup/sync/AI allowlist 整合測試。不能因 SQL 使用 JSONB 就宣稱全部同步支援新欄位。

`git merge-tree --write-tree` 僅建立預檢 Git 物件，沒有合併工作目錄；與 PR #16 head `f87a4e4e05bbf0a5ea653053499bb3e194749425` 有5個衝突：`package.json`、`src/data.js`、`src/main.js`、`src/style.css`、`tests/v04-browser.cjs`。見[預檢輸出](verification/stats-v2-merge-preflight.txt)。整合時須保留全部 tests scripts、統一 transactions 定義、接上 v8 validator，並重新驗證 backups/sync；本次依指示沒有改動那些 OAuth、MCP 或 Supabase 功能。

PR #17 尚在 v0.6 開發線；其六項統計已由 #18 進 main。本 PR 基於 main 取代該統計層，未合併 #16/#17。v0.7 私人雙向同步的先前臨時工作未成功推送，不列為本次已交付成果。

## 真實驗證結果

| 檢查 | 結果 | 證據 |
|---|---|---|
| 單元測試 | **55 tests / 8 files 通過** | [紀錄](verification/stats-v2-unit.txt) |
| lint | 通過 | [紀錄](verification/stats-v2-lint.txt) |
| build | 通過 | [紀錄](verification/stats-v2-build.txt) |
| 全套瀏覽器 | **6 suites 通過**；390/1440px、既有明暗主題、CRUD／備份／照片／模板／小誌／統計 | [紀錄](verification/stats-v2-browser.txt) |
| 增補截圖回歸 | 日／週／月／空資料／解析錯誤及趨勢、週比較 | [紀錄](verification/stats-v2-screenshots.txt) |
| npm audit --omit=dev | 0 vulnerabilities | [JSON](verification/stats-v2-audit.json) |
| GitHub CI | 提交後以 Draft PR Checks 的最新 head 結果為準 | PR Checks |
| 實體 iPhone Safari／WebKit | **未驗證**，手機尺寸僅 Chromium 模擬 | 不能宣稱實機通過 |
| 真實跨裝置／ChatGPT 寫入 | **本次不包含、未驗證** | 統計不等於同步 |

環境：Node 24、Chromium 153.0.8010.0，現有本機 browser binary（CHROME_PATH），Noto CJK 字型。測試所有資料均合成。測試檢查無外部網路請求、統計前後原始儲存完全相同、同筆更新不重複、錯誤時不覆寫、手機沒有水平溢出。

初輪失敗已處理：原測試預期只有6類、把未知本人份量的「吃完」當成本人餐數、舊備份版本固定5等假設，已改為檢查新需求及新欄位；兩處非同步頁面初始化等待已補上。沒有刪除核心斷言，最終整套重跑通過。

### 截圖（合成資料）

| 畫面 | 390px 手機尺寸 | 1440px 桌面 |
|---|---|---|
| 日 | [截圖](screenshots/stats-v2/stats-v2-390-day.png) | [截圖](screenshots/stats-v2/stats-v2-1440-day.png) |
| 週 | [截圖](screenshots/stats-v2/stats-v2-390-week.png) | [截圖](screenshots/stats-v2/stats-v2-1440-week.png) |
| 週趨勢 | [截圖](screenshots/stats-v2/stats-v2-390-week-trend.png) | [截圖](screenshots/stats-v2/stats-v2-1440-week-trend.png) |
| 月 | [截圖](screenshots/stats-v2/stats-v2-390-month.png) | [截圖](screenshots/stats-v2/stats-v2-1440-month.png) |
| 月內週比較 | [截圖](screenshots/stats-v2/stats-v2-390-month-comparison.png) | [截圖](screenshots/stats-v2/stats-v2-1440-month-comparison.png) |
| 空資料 | [截圖](screenshots/stats-v2/stats-v2-390-empty.png) | [截圖](screenshots/stats-v2/stats-v2-1440-empty.png) |
| 解析失敗 | [截圖](screenshots/stats-v2/stats-v2-390-error.png) | [截圖](screenshots/stats-v2/stats-v2-1440-error.png) |

### 主要檔案

- `src/metric-model.js`：純讀取彙總、週月範圍、平均、活動防重疊、餐點本人份量、空／未知狀態。
- `src/metric-detail.js`：統一對話框、日期導航、可點選圖、明細與錯誤提示。
- `src/stat-fields.js`：選填欄位、驗證、編輯器輸入；隔離新增格式以縮小整合範圍。
- `src/data.js`：v2–v8相容驗證、版本不降級、共用付款日與交易讀取、Taipei日期。
- `src/main.js`、`src/style.css`：餐點入口、必要編輯欄位、主卡片一致性、手機深色樣式。
- `tests/statistics-v2.test.js`、`tests/stats-v2-browser.cjs`：新規則、整合操作與截圖；既有 tests 仍執行。

尚需本人於獨立測試站操作實體 iPhone Safari：日期輸入、月圖橫向滑動、44px觸控按鈕、長文明細、鍵盤開關及備份下載。也須在另一個明確授權的整合任務中處理 v0.7 schema 相容，再考慮合併／部署。本次沒有進行正式發布。
