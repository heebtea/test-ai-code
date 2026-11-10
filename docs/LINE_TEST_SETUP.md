# LINE Messaging API：私人單次測試（尚未正式綁定）

本測試不讀取 Second Brain Lite 生活紀錄、不修改正式站、不自動定時傳訊。只有使用者在 GitHub Actions 手動執行，才會對指定的 LINE 使用者推送一則固定的合成測試訊息。

## 本人操作

1. 在 https://manager.line.biz/ 建立或選擇 LINE 官方帳號，啟用 Messaging API；見 https://developers.line.biz/en/docs/messaging-api/getting-started/
2. 在 https://developers.line.biz/console/ 的對應 Messaging API Channel → Messaging API 分頁，取得 Channel access token。金鑰只存於安全的 Secrets，**不要貼在聊天、前端、截圖或 GitHub 版本紀錄**。
3. 在 Channel → Basic settings → Your user ID 找到本人以 U 開頭的使用者 ID。若沒有，先把 LINE 與 Business ID 連結；見 https://developers.line.biz/en/docs/messaging-api/getting-user-ids/
4. 以個人 LINE 加入這個 LINE 官方帳號為好友，並確認未封鎖。
5. 在 GitHub Repo → Settings → Secrets and variables → Actions → New repository secret 設定 `LINE_CHANNEL_ACCESS_TOKEN` 和 `LINE_USER_ID`。只在 GitHub Secrets 頁輸入，不要公開。
6. **審查並明確批准合併本測試 workflow 到 main 後**，到 Actions → LINE notification smoke test (manual only) → Run workflow 手動測試。GitHub workflow_dispatch 需要預設分支已有此工作流程；僅開發分支不能啟動。
7. 檢查剛加入好友的 LINE 官方帳號聊天室是否收到「Second Brain Lite｜LINE 測試通知成功」。

## 安全與邊界

- 僅發送固定合成文字，不觸及睡眠、醫療、花費或其他紀錄，也不支援廣播。
- 不在公開前端、localStorage、GitHub Pages 或原始碼放入 Channel access token。
- 不會自動把 ChatGPT 對話轉發 LINE，也沒有 Webhook 或排程；真正的通知功能必須另外評估安全性、資料權限和發送規則。
- 測試只存在獨立分支；沒有合併、沒有部署正式站。

## 離線合成測試

```bash
node --test tests/line-notify.test.mjs
```

通過合成測試**不代表**真實 LINE 訊息已送達。
