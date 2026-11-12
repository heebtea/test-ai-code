# Second Brain Lite AI 私人資料橋接驗收

2026-11-12 · 合成資料驗證 · 交付於獨立開發分支

## 分支與正式站

| 來源 | 查核結果 |
| --- | --- |
| [main](https://github.com/heebtea/test-ai-code/commit/0fcedcd0e33673d47b9e1a381f6968a06a01ef1f)／[正式站](https://heebtea.github.io/test-ai-code/) | 現行 v0.4，主線含六類日／週／月統計和既有睡眠視圖。使用該提交重建，HTML 與 JavaScript 均與正式站逐位元相同。正式站沒有 AI 分享與私人同步入口。 |
| [#14 AI 分享](https://github.com/heebtea/test-ai-code/pull/14)／[#15 v0.5](https://github.com/heebtea/test-ai-code/pull/15) | 原有單日分享、OCR 審核與完整備份皆已在 #16 的祖先提交中。 |
| [#16 v0.6](https://github.com/heebtea/test-ai-code/pull/16) | 原有日期區間／分類／預覽／系統分享、Supabase 同步原型、RS256/JWKS 驗證與唯讀 MCP，均未進 main。雲端資料庫與發證端尚未實際接線。 |
| [#17 v0.6 統計](https://github.com/heebtea/test-ai-code/pull/17)／[#18 v0.4 發布](https://github.com/heebtea/test-ai-code/pull/18) | 六類統計已由 #18 納入 main。 |
| [#19 Statistics V2](https://github.com/heebtea/test-ai-code/pull/19)／[#20 圖表觸控](https://github.com/heebtea/test-ai-code/pull/20) | 七類統計、餐點、付款日、v8 欄位及選日下鑽已開發。#20 承接 #19，兩者均未進 main。 |

整合分支直接承接 #16 與 #20 的提交歷史。編輯器共用一組份量與交易欄位，報表與快照共用付款日規則。完整備份讀取 v2–v8，私人同步原型可保留 v8。舊版 v0.4 頁面無法讀取新格式。開啟分享對話框時重讀當前裝置的已儲存紀錄；預覽、下載、複製和系統分享皆唯讀。

## iPhone 使用方式

1. 在 Lite 按「分享資料給 AI」，選日期區間及類別，再核對預覽。
2. 按「系統分享」，選 Google Drive 的「我的雲端硬碟」私人位置。若分享清單未列出 Drive，按「下載 JSON」，再從「檔案」App 分享或從 Drive 上傳。
3. 把該次檔案的 Drive 連結交給 ChatGPT，請它讀取原始 JSON 並回報日期、最後更新時間和筆數。以檔名內的產出時間識別版本。每次需要較新的紀錄時，匯出涵蓋所需日期的快照即可。

## 快照欄位與帳務

- 快照版本 3。保留 Lite 資料版本、Asia/Taipei 日期區間、產出時間及已選資料的最後更新時間。逐筆保留 ID、原狀態、起訖時間、已儲存的來源類型與修改時間。
- 來源預設只出安全類型（手動、Apple Watch、OCR、已遮蔽、未知）。輸入與量測來源並存時各自保留類型。名稱、備註、私人日誌文字、任意來源原文預設省略。照片、模板及待確認 OCR 草稿始終省略。名稱與文字需另行勾選，日誌與事件也需各自選取類別。
- 手動編輯與 OCR 補欄位沿用原 ID，保存 `correctedAt`。舊紀錄缺乏來源、修改時間或補正標記時保留未知。跨快照以 ID、版本時間及最新快照涵蓋區間核對。
- `records` 依紀錄日，保留飲用中、未完成、部分、本人／家人／剩餘份量。只在 `transactions` 依實際入帳日加總金額。退款、回補、購買分列，兌換券不重複入帳。待付款、付款未確認和付款日未知分列於 `pendingTransactions`，排除於已付合計。未知金額保留 `null`。不同 ID 的獨立紀錄仍須核對是否代表同一交易。
- 可匯出空區間，保留已查區間和選取類別。快照僅涵蓋使用者當次選取範圍。

## 驗收結果

| 驗收項目 | 結果 |
| --- | --- |
| 本機單元／整合測試 | 142 項通過。含 v8 備份還原、同步拉取與衝突解決、原 ID 補正、隱私與付款日期。 |
| lint、production build、production audit | 通過，production audit 0 漏洞。 |
| Google Drive 檔案權限 | 合成快照放入 My Drive，驗證 `shared=false`，權限只有擁有者。 |
| Google Drive 連接器原檔讀取 | 以檔案連結讀取原始 `application/json`，6,429 bytes 與本機生成檔逐位元一致。SHA-256 `c308f35085c16c5c0c82254b972c8ff13f0e7ff369184dea5be52993f4742360`。讀出 8 筆紀錄、4 筆入帳、2 筆未入帳。已確認購買 NT$125、退費 NT$20、回補 NT$10、淨額 NT$95，另 1 筆入帳金額未知。本人部分攝取 0.5 份與補正時間均保留。 |
| Google Drive 依檔名發現 | 完整檔名、精確名稱條件、簡短關鍵字測試均回空。指定檔案連結可讀原檔，預設文字欄回空。 |
| Chromium iPhone 尺寸與觸控 | 日期區間、類別、預設隱私、系統分享替身與下載逐位元相同、分享不可用時的備援，以及原始資料不變均通過。瀏覽器輸出與 Drive 讀回的內容除了兩次各自的產出時間外完全相同。 |
| 實體 iPhone Safari → Drive | 待實機驗證系統分享面板與 Drive App 接收。Linux WebKit 因 GTK 等相依套件缺失未能啟動。 |

Google Drive 測試透過這次 ChatGPT Work 會話中的既有連接器完成。一般 Chat 或 iPhone 上的原始 JSON 讀取未另做獨立驗證。

## 第二階段

[OpenAI 目前的自訂 MCP 說明](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)列 Business、Enterprise／Edu 可使用完整自訂 MCP，另明載 Pro 可連唯讀／擷取工具。近期官方說明未確認 Plus 可加掛私人 MCP；較早的支援回覆曾提到 Plus Developer Mode。本次瀏覽器顯示登入頁，未能查到這個 Plus 帳號的開關，亦未實際連接自訂 MCP。現階段已實測的是既有 Drive 連接器指定原檔讀取。

現有 #16 原型可作為後續接線基底。若網頁版 Plugins 的帳號設定確認可新增自訂 MCP，依 [OpenAI 的連接規格](https://developers.openai.com/api/docs/guides/custom-mcp-server)接上 OAuth 發證與撤權資料庫，使用可撤回的 `records:read` 授權。唯讀儲存 adapter 應以授權擁有者為查詢範圍，並涵蓋付款日落在期間內的跨日交易。接線前用合成資料驗證過期、撤權、跨帳號隔離、日期及分類限制。可評估 [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 的帳號資格。這次只做研究、保留及驗證本機原型，沒有開通或部署外部服務。
