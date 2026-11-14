/** A single LINE Messaging API push smoke test. No personal data access. */
const ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const TEST_MESSAGE = '🍌 Second Brain Lite｜LINE 測試通知成功！這是一則手動觸發的測試訊息，沒有讀取生活紀錄。';

export async function sendLineTest({ env = process.env, request = fetch } = {}) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = env.LINE_USER_ID;
  if (!token || !userId) {
    throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_USER_ID。請先在 GitHub Actions Secrets 設定。');
  }
  if (!/^U[0-9a-f]{32}$/i.test(userId)) {
    throw new Error('LINE_USER_ID 格式不正確，應為 U 開頭的 LINE 使用者 ID。');
  }
  const response = await request(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: TEST_MESSAGE }] }),
  });
  if (!response.ok) {
    const requestId = response.headers?.get?.('x-line-request-id') || 'unknown';
    throw new Error(`LINE Messaging API 傳送失敗，HTTP ${response.status}，request ID: ${requestId}`);
  }
  return true;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  sendLineTest()
    .then(() => console.log('LINE API 已接受測試訊息。請至 LINE 官方帳號聊天室確認收件。'))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
