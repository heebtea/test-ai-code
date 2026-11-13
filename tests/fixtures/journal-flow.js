// Entirely synthetic: acceptance amounts only; no personal names, routes or logs.
export const day = '2026-11-13';
const base = (id, type, status) => ({ id, type, date: day, status, time: '', note: '' });
export function journalFixture() {
  const records = [];
  const amounts = [100,22,30,95,210,45,36,34,15,22,29];
  for (const [i, amount] of amounts.entries()) {
    records.push({ ...base(`synthetic-purchase-${i+1}`, 'spending', '已付款'),
      amount, paymentDate: day, transactionKind: 'purchase',
      note: `合成交易${String(i+1).padStart(2,'0')}｜${i<5?'餐飲與零食':i<8?'測試超市':'交通'}。${i===4?'合成點心分給家人，計入購買支出，不計本人攝取。':'保留購買品項、付款狀態及必要的對帳備註。'}` });
  }
  records.push({ ...base('synthetic-sleep','sleep','已完成'), time:'07:30', minutes:410,deep:70,rem:80,core:260,awake:35,score:null,note:'合成睡眠資料，沒有分數時保留未知。' });
  records.push({ ...base('synthetic-coffee','coffee','已飲用'),time:'08:30',startTime:'08:30',endTime:'09:25',volume:480,amount:null,payment:'voucher',purchaseDate:null,note:'合成兌換券；不重複計入券面支出。' });
  records.push({ ...base('synthetic-water','water','飲用中'),time:'17:50',startTime:'17:50',endTime:'',volume:null,capacity:900,note:'只確認開喝，已飲用量未知；不可當作已喝完。' });
  records.push({ ...base('synthetic-drink','beverage','已飲用'),name:'合成前日購入茶',time:'10:30',startTime:'10:30',endTime:'15:55',volume:600,amount:null,paid:true,paymentDate:'2026-11-12',note:'先前購買，今天攝取；金額未知，不在今天重新記帳。' });
  records.push({ ...base('synthetic-drink-pending','beverage','飲用中'),name:'合成晚間茶',time:'19:30',startTime:'19:30',endTime:'',volume:null,amount:null,paid:null,paymentDate:null,note:'加冰後繼續喝，容量未知，不以瓶裝容量推估攝取。' });
  for (let i=0;i<6;i++) records.push({ ...base(`synthetic-meal-${i}`,'meal',i===0?'未確認':'吃完'),name:`合成餐點${i+1}`,time:`${12+i}:05`,startTime:`${12+i}:05`,endTime:i===0?'':`${12+i}:30`,amount:null,paid:null,paymentDate:null,orderDate:null,quantity:2,consumedQuantity:i===0?null:1,familyQuantity:1,remainingQuantity:0,unit:'份',note:'購買、付款與本人攝取分開記錄；家人份量不計本人攝取，帳務已於獨立交易列一次。' });
  records.push({ ...base('synthetic-activity','activity','已完成'),time:'21:00',steps:8600,minutes:null,note:'合成活動觀察；未提供分鐘，不推估。' });
  records.push({ ...base('synthetic-sun','sunlight','已記錄'),time:'21:00',minutes:65,source:'合成測試',note:'合成日照時間。' });
  for(let i=0;i<4;i++) records.push({ ...base(`synthetic-event-${i}`,'event','已記錄'),time:`${9+i}:40`.padStart(5,'0'),name:`合成事件${i+1}`,note:'測試長文字換行與跨欄，保持事件原文、順序及備註。'.repeat(3) });
  records.push({ ...base('synthetic-journal','journal','已記錄'),theme:'合成驗收日：完整明細優先',highlight:'合成記錄涵蓋餐飲、飲品、採買及交通。'.repeat(3),wellbeing:'這是一段用來測試手機閱讀及跨頁的合成身體觀察，沒有醫療推論。'.repeat(3),mood:'平穩；記錄不等於完成。',todo:'風險與修正：飲品完成狀態待核對，保留未知金額，不做重複記帳。'.repeat(3),note:'所有文字與時間均為測試資料。' });
  return { version:8, records };
}
