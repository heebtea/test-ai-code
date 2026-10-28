export const STORAGE_KEY = 'second-brain-lite-v1';
export const THEME_KEY = 'second-brain-theme';

// The same clearly fictional baseline is used for every date until edited.
export function sampleData() {
  return {
    sleep: { total: 7.5, deep: 1.5, rem: 1.8, score: 84 },
    coffee: { time: '09:30', volume: 250, status: '已飲用' },
    water: { amount: 1500, goal: 2000 },
    activity: { steps: 7842, minutes: 42 },
    spending: { amount: 480, detail: '午餐 $180、咖啡 $120、交通 $180' },
  };
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + days));
}
export function loadRecords(storage) {
  try {
    const records = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  } catch { return {}; }
}
export function recordFor(records, date) {
  const defaults = sampleData();
  return Object.fromEntries(Object.keys(defaults).map(key => [key, { ...defaults[key], ...records[date]?.[key] }]));
}
