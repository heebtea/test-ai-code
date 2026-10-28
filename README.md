# test-ai-code
讓 GPT 寫程式的測試用

## Project Second Brain Lite

繁體中文的生活儀表板，以 Vite、原生 JavaScript、HTML 和 CSS 建立。睡眠、咖啡、飲水、活動與花費均為**虛構模擬資料**，不是個人健康紀錄，也不使用 API Key。每個日期初始顯示相同的範例；點選卡片即可編輯，資料與深淺色偏好只保存在目前瀏覽器的 localStorage，不會同步到其他裝置。清除瀏覽器資料會移除修改。

需要 Node.js 22.12 以上的 22.x、24.x，或 26.0 以上版本，以及 npm（建議使用支援的 LTS 版本）。

```bash
npm ci
npm run dev
npm test
npm run build
```

開發伺服器的位址會顯示在終端機。使用日期箭頭或日期選擇器切換日期；點選卡片可編輯該日資料。

## GitHub Pages

目標網址：https://heebtea.github.io/test-ai-code/

Vite 的 `base` 固定為 `/test-ai-code/`，建置輸出為 `dist/`。開發時也需使用終端機顯示的 `/test-ai-code/` 路徑。HTML 中的 JavaScript、CSS 與 favicon 由 Vite 在建置時補上此前綴；日後新增資源請使用 Vite import、CSS `url()` 或 `import.meta.env.BASE_URL`，避免在 JavaScript 中硬寫根目錄 URL。

部署設定 PR 本身不會部署。確認 PR 與 CI 通過後，再由維護者執行：

1. 在儲存庫 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
2. 確認已準備公開網站後，將部署設定 PR 合併至 `main`。這個動作會觸發部署。
3. 在 **Actions → Deploy to GitHub Pages** 確認 build 與 deploy 成功，再開啟目標網址。
4. 如合併時尚未啟用 Pages，啟用後可從該 workflow 的 **Run workflow** 選擇 `main` 手動執行。

`.github/workflows/deploy.yml` 只接受 `main` 的 push 或手動執行，且兩個 job 都限制為 `main`；推送開發分支、建立 PR 不會部署。build 使用 Node.js 24，依序執行 `npm ci`、`npm test`、`npm run build`，成功後僅上傳 `dist/`。build 只有 `contents: read`；deploy 僅有 `pages: write` 與 `id-token: write`，使用官方 Pages Actions 與 `github-pages` environment，不需額外 PAT。原有 `ci.yml` 保持獨立。

公開內容只有程式內的虛構範例，不含真實個人健康、飲食或花費紀錄，也不需要 API Key。訪客自行編輯的資料只留在該瀏覽器的 localStorage，不會進入部署產物或上傳至 GitHub。請勿把真實個人紀錄、瀏覽器匯出資料或 `.env` 檔加入 `src/`、`public/` 或儲存庫。
