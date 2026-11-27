export const day = '2026-11-27';
const record = (id, type, status, values) => ({ id, date: day, type, status, time: '10:00', note: '', ...values });

export function recordMaintenanceFixture() {
  const initial = {
    version: 8,
    records: [
      record('sleep', 'sleep', '已完成', { minutes: 511, score: 80, deep: 90, rem: 100 }),
      record('coffee-known', 'coffee', '已飲用', { volume: 480, payment: 'voucher', amount: null }),
      record('coffee-corrected', 'coffee', '已飲用', { volume: null, payment: 'purchase', amount: 180, updatedAt: '2026-11-27T03:00:00Z' }),
      record('water', 'water', '飲用中', { volume: null, capacity: 900, startTime: '13:00', endTime: '' }),
      record('activity', 'activity', '已完成', { steps: 7172, minutes: null }),
      record('sunlight', 'sunlight', '已記錄', { minutes: 127, source: '合成資料' }),
      record('expense', 'spending', '已付款', { amount: 661 }),
      record('reimbursement', 'spending', '已付款', { amount: 100, transactionKind: 'reimbursement' }),
      record('unpaid', 'spending', '未付款', { amount: 250, paymentDate: null }),
      record('meal', 'meal', '部分', { name: '合成餐點', amount: 160, quantity: 3, consumedQuantity: 1, familyQuantity: 1, remainingQuantity: 1, unit: '份', paid: false, paymentDate: null, orderDate: day, startTime: '12:00', endTime: '' }),
      record('other-drink', 'beverage', '已購買', { name: '合成飲品', amount: null, volume: 350, paid: null, paymentDate: null, startTime: '', endTime: '' }),
      record('event', 'event', '已記錄', { name: '合成事件' }),
      record('journal', 'journal', '已記錄', { theme: '合成小誌', highlight: '', wellbeing: '', mood: '', todo: '' }),
      record('neighbor', 'water', '已飲用', { date: '2026-11-26', volume: 42 }),
    ],
  };
  const corrections = {
    version: 8,
    records: [
      { ...initial.records[2], volume: 591, correctedAt: '2026-11-27T12:00:00Z', provenance: '合成補正', note: '591 mL 為杯型標示容量；實際液體攝取量未實測。' },
      { ...initial.records[3], status: '已飲用', volume: 900, endTime: '16:00', correctedAt: '2026-11-27T12:00:00Z' },
    ],
  };
  return { initial, corrections };
}
