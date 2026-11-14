// Read-only export projection. Accounting/consumption always use existing data.js.
import { cashflow, liquidIntake, transactionDate, isPaid } from './data.js';
const value = (n, unit='') => n == null ? '未知' : `${n}${unit}`;
const range = r => `${r.startTime || r.time || '時間未知'}${r.endTime ? '～'+r.endTime : r.startTime ? '～結束未確認' : ''}${r.startTime && r.time && r.time!==r.startTime && r.time!==r.endTime ? '（紀錄時間 '+r.time+'）' : ''}`;
const quantity = r => [['quantity','購買'],['consumedQuantity','本人攝取'],['familyQuantity','家人'],['remainingQuantity','剩餘']].filter(([k])=>r[k]!=null).map(([k,t])=>`${t}${r[k]}${r.unit || ''}`).join('；');
const note = r => r.note ? `\n備註：${r.note}` : '';
const money = r => `金額${value(r.amount,' NT$')}；${isPaid(r)?'已付款':r.paid===false?'未付款':'付款未確認'}；付款日期${transactionDate(r) || '未知'}`;
const sort = rs => [...rs].sort((a,b)=>(a.startTime || a.time || '99:99').localeCompare(b.startTime || b.time || '99:99'));

export function journalDocumentSections(data, date) {
  const day=sort(data.records.filter(r=>r.date===date && r.type!=='draft'));
  const flow=cashflow(data,date), liquids=liquidIntake(data,date), out=[];
  const add=(group,id,text)=>out.push({group,id,title:'',value:text});
  if(!day.length && !Object.values(flow.groups).some(rs=>rs.length)) return out;
  add('overview','summary',`本日 ${day.length} 筆紀錄；${flow.groups.purchase.length} 筆購買交易。\n摘要依原始狀態整理；購買不等於本人攝取，開始不等於完成。`);
  for(const r of day.filter(r=>r.type==='journal')) {
    for(const [key,group,label] of [['theme','overview','主題'],['highlight','highlight','亮點'],['wellbeing','body','身體狀況'],['mood','body','心情'],['todo','todo','修正／待辦（原文）'],['note','todo','整理備註']])
      if(r[key])add(group,`${r.id}:${key}`,`${label}：${r[key]}`);
  }
  const sleeps=day.filter(r=>r.type==='sleep');
  if(!sleeps.length)add('health','missing-sleep','目前可見資料未找到睡眠紀錄。');
  for(const r of sleeps) {
    add('health',r.id,`${range(r)} 睡眠 ${value(r.minutes,' 分鐘')}\n分數 ${value(r.score)}；深睡 ${value(r.deep,' 分')}；REM ${value(r.rem,' 分')}；核心 ${value(r.core,' 分')}；清醒 ${value(r.awake,' 分')}（清醒不含於睡眠總時數）${note(r)}`);
    for(const [i,s] of (r.segments || []).entries())add('health',`${r.id}:segment:${i}`,`${s.start}～${s.end} ${s.stage}`);
  }
  for(const r of day.filter(r=>['activity','sunlight'].includes(r.type)))add('activity',r.id,`${range(r)} ${r.type==='activity'?'活動':'日照'}（${r.status}）\n${r.type==='activity'?`步數 ${value(r.steps)}；`:''}時間 ${value(r.minutes,' 分鐘')}${r.source?'；來源 '+r.source:''}${note(r)}`);
  if(!day.some(r=>['activity','sunlight'].includes(r.type)))add('activity','missing-activity','目前可見資料未找到活動或日照紀錄。');
  add('food-drinks','liquid-summary',`已確認飲用總量：${value(liquids.value,' mL')}；${liquids.pending} 筆未完成／未確認，不計入完飲量；${liquids.unknown} 筆已飲用但容量未知，不推估。`);
  for(const r of day.filter(r=>['coffee','water','beverage'].includes(r.type)))add('food-drinks',r.id,`${range(r)} ${r.name || (r.type==='coffee'?'咖啡':'飲水')}（${r.status}）\n${r.status==='已飲用'?'已飲用量':'記錄容量（非完飲量）'} ${value(r.volume,' mL')}${r.capacity!=null?`；裝水容量 ${r.capacity} mL`:''}${quantity(r)?'\n'+quantity(r):''}${r.type==='water'?'':'\n'+(r.payment==='voucher'?'兌換券，不重複計券面費用；記錄金額'+value(r.amount,' NT$'):money(r))}${note(r)}`);
  const meals=day.filter(r=>r.type==='meal');
  if(!meals.length)add('food-meals','missing-meals','目前可見資料未找到餐點紀錄。');
  for(const r of meals)add('food-meals',r.id,`${range(r)} ${r.name}（${r.status}）${quantity(r)?'\n'+quantity(r):''}\n${money(r)}${r.orderDate?'；訂購日期'+r.orderDate:''}${note(r)}`);
  for(const [kind,label] of [['purchase','購買'],['refund','退費'],['reimbursement','回補']]) {
    for(const [i,r] of sort(flow.groups[kind]).entries())add('food-money',`transaction:${r.id}`,`${label} ${i+1}｜${value(r.amount,' NT$')}\n${r.time || '時間未知'} ${r.name || (r.type==='coffee'?'咖啡':r.note || '花費')}\n付款日期 ${transactionDate(r)}${r.name || r.type==='coffee'?note(r):''}`);
  }
  add('food-money','expense-summary',`已確認購買支出：${value(flow.totals.purchase.value,' NT$')}（${flow.groups.purchase.filter(r=>r.amount!=null).length} 筆金額已知，${flow.totals.purchase.unknown} 筆未知）\n退費：${flow.groups.refund.length?value(flow.totals.refund.value,' NT$'):'無紀錄'}；回補：${flow.groups.reimbursement.length?value(flow.totals.reimbursement.value,' NT$'):'無紀錄'}\n已確認淨支出：${value(flow.knownNet,' NT$')}。未知金額保留未知，不視為零。`);
  // Unpaid / undated spending is still a record, but never a confirmed transaction.
  for(const r of day.filter(r=>r.type==='spending'&&!Object.values(flow.groups).some(rs=>rs.some(x=>x.id===r.id))))add('food-money',r.id,`${r.time || '時間未知'} ${r.note || '花費紀錄'}\n${money(r)}；不列入本日已確認交易合計。`);
  const events=day.filter(r=>r.type==='event');
  if(!events.length)add('timeline','missing-events','目前可見資料未找到重要事件。');
  for(const r of events)add('timeline',r.id,`${r.time} ${r.name}${note(r)}`);
  if(!out.some(s=>s.group==='todo'))add('todo','missing-risk','目前可見資料未找到風險與修正文字；不自行補寫健康判斷。');
  const coffee=day.filter(r=>r.type==='coffee');
  const completedMeals=meals.filter(r=>r.endTime).map(r=>r.endTime).sort();
  add('factors','sleep-factors',`已記錄因素（非睡眠預測）：\n${coffee.length?'咖啡時段：'+coffee.map(r=>`${range(r)}（${r.status}）`).join('、'):'目前可見資料未找到咖啡時段。'}\n${completedMeals.length?'最後一筆餐點結束時間：'+completedMeals.at(-1):'目前可見資料未找到餐點結束時間。'}\n飲品待確認 ${liquids.pending} 筆；身體狀況與修正見原文區塊。`);
  add('verdict','verdict',`本日紀錄已分開呈現攝取與付款；${flow.unknown || liquids.pending?'仍有未知金額或飲用狀態待確認。':'以已確認資料為準，持續觀察。'}`);
  return out;
}
