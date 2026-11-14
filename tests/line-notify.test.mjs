import test from 'node:test';
import assert from 'node:assert/strict';
import { sendLineTest } from '../scripts/send-line-test.mjs';

const valid = { LINE_CHANNEL_ACCESS_TOKEN: 'mock-token', LINE_USER_ID: `U${'a'.repeat(32)}` };

test('missing credentials fail closed without sending', async () => {
  let called = false;
  await assert.rejects(sendLineTest({ env: {}, request: () => { called = true; } }), /缺少/);
  assert.equal(called, false);
});

test('invalid user ID fails closed', async () => {
  await assert.rejects(sendLineTest({ env: { ...valid, LINE_USER_ID: 'friend' }, request: () => { throw new Error('should not call'); } }), /格式不正確/);
});

test('sends only synthetic text to a single configured recipient', async () => {
  let called = 0;
  const result = await sendLineTest({
    env: valid,
    request: async (url, opts) => {
      called++;
      assert.equal(url, 'https://api.line.me/v2/bot/message/push');
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers.Authorization, 'Bearer mock-token');
      const payload = JSON.parse(opts.body);
      assert.equal(payload.to, valid.LINE_USER_ID);
      assert.equal(payload.messages.length, 1);
      assert.match(payload.messages[0].text, /測試通知成功/);
      assert.match(payload.messages[0].text, /沒有讀取生活紀錄/);
      return { ok: true };
    },
  });
  assert.equal(result, true);
  assert.equal(called, 1);
});

test('failed API response does not expose credentials', async () => {
  await assert.rejects(
    sendLineTest({ env: valid, request: async () => ({ ok: false, status: 401, headers: { get: () => 'request-123' } }) }),
    (error) => error.message.includes('401') && !error.message.includes('mock-token'),
  );
});
