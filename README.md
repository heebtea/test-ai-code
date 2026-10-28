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
