// Synthetic, valid v8 records. Never seed a test browser with personal data.
export const from = '2031-02-03';
export const to = '2031-02-04';
export const correctedAt = '2031-02-05T02:30:00.000Z';
const entry = (id, type, status, fields) => ({
  id, type, date: from, status, time: '12:30', note: 'PRIVATE_TEST_NOTE', ...fields,
});

export const data = {
  version: 8,
  records: [
    entry('test-meal', 'meal', '部分', {
      name: 'PRIVATE_TEST_MEAL', provenance: '[PRIVATE_TEST_FILENAME.png] 原文',
      updatedAt: correctedAt, correctedAt, amount: 125, paid: true,
      paymentDate: to, orderDate: from, mealType: 'lunch', orderStatus: 'ordered',
      startTime: '12:30', endTime: '12:45', quantity: 3, consumedQuantity: 0.5,
      familyQuantity: 1, remainingQuantity: 1.5, unit: '份',
    }),
    entry('test-coffee', 'coffee', '飲用中', {
      provenance: '手動輸入', volume: 480, amount: null, payment: 'voucher',
      startTime: '09:00', endTime: '', purchaseDate: null,
    }),
    entry('test-unpaid', 'beverage', '未確認', {
      name: 'PRIVATE_TEST_BEVERAGE', amount: 40, volume: null, paid: false,
      paymentDate: null, startTime: '', endTime: '',
    }),
    entry('test-unknown-date', 'spending', '已付款', { paymentDate: null, amount: 50 }),
    entry('test-unknown-amount', 'spending', '已付款', { paymentDate: to, amount: null }),
    entry('test-refund', 'spending', '已付款', {
      date: '2031-02-02', paymentDate: to, amount: 20, transactionKind: 'refund',
    }),
    entry('test-reimbursement', 'spending', '已付款', {
      paymentDate: to, amount: 10, transactionKind: 'reimbursement',
    }),
    entry('test-activity', 'activity', '已完成', {
      steps: 500, minutes: 10, startTime: '10:00', endTime: '10:10',
    }),
    entry('test-sleep', 'sleep', '已完成', {
      minutes: 420, deep: 70, rem: 90, core: 260, awake: 5, score: 80,
      segments: [{ start: '2031-02-03T01:00:00+08:00', end: '2031-02-03T01:05:00+08:00', stage: 'awake' }],
    }),
    entry('test-event', 'event', '已記錄', { name: 'PRIVATE_TEST_EVENT' }),
    entry('test-journal', 'journal', '已記錄', {
      theme: 'PRIVATE_TEST_JOURNAL', highlight: '', wellbeing: '', mood: '', todo: '',
    }),
  ],
};
