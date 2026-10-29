const trim = (s) => s.replace(/[\u3000\s]+/g, ' ').trim();
const compact = (s) => trim(s).replace(/\s+/g, '');
const clock = (s) => {const a=[...s.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];return a.length===1?`${a[0][1].padStart(2,'0')}:${a[0][2]}`:''};
const drink = /(咖啡|美式|拿鐵|茶|飲品|清水|飲水|礦泉水)/;
const activity = /(通勤|職訓|上課|課程|教室|YouBike|騎車|公車|捷運|洗澡|洗衣|步行|交通|移動)/i;
const food = /(午餐|晚餐|早餐|餐點|排骨飯|便當|雞排|可樂餅|貝果|肉桂捲|麵包|麵食)/;
const decorative = /^(?:餐點|飲品|花費|今日亮點|身體狀況|心情與感受|晚間待辦|今日時間軸|交通與移動)[：:]?$/;
const amountValue = s => { const a=[...s.matchAll(/(?:NT\$|\$)\s*(\d+(?:\.\d{1,2})?)/g)]; return a.length===1?Number(a[0][1]):null; };
const volumeValue = s => { const a=[...s.matchAll(/(\d{1,5})\s*(?:mL|毫升)/gi)]; return a.length===1?Number(a[0][1]):null; };
export function classifyLine(text,zone='unknown') {
 const source=trim(text);const s=compact(source);
 if(!s||s.length<3||s.length>500||decorative.test(s))return null;
 const time=clock(s);const amounts=[...s.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)];
 let name=source;
 if(['highlight','body','todo','header'].includes(zone))return {type:'journal',source,name,zone,time,highlight:zone==='highlight'?source:'',wellbeing:zone==='body'?source:'',todo:zone==='todo'?source:'',theme:zone==='header'?source:'',mood:''};
 // Multiple adjacent columns are never treated as one meal, event or payment.
 if([...s.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)].length>1)return {type:'unclassified',source,name,zone,time:''};
 if(zone==='spending'){
  if(/總額|總計|合計|飲食相關/.test(s))return {type:'unclassified',source,name,zone,time};
  if(amounts.length===1)return {type:'spending',source,name,zone,time,amount:Number(amounts[0][1])};
  return {type:'unclassified',source,name,zone,time};
 }
 if(activity.test(s))return {type:'event',source,name,zone,time};
 if(drink.test(s))return {type:/咖啡|美式|拿鐵/.test(s)?'coffee':/清水|飲水|礦泉水/.test(s)?'water':'beverage',source,name,zone,time};
 if(food.test(s))return {type:'meal',source,name,zone,time,startTime:time};
 if(time)return {type:'event',source,name,zone,time};
 return {type:'unclassified',source,name,zone,time};
}
export function layoutIsRecognized(whole){const s=compact(whole);return /ProjectSecondBrain/i.test(s)&&/睡眠/.test(s)&&/日照/.test(s)&&/時間/.test(s)}
export const layoutZones={timeline:[.01,.29,.98,.20],meal:[.01,.50,.70,.18],spending:[.71,.50,.28,.18],drinks:[.01,.69,.66,.14],transport:[.68,.69,.31,.14],highlight:[.01,.83,.32,.17],body:[.34,.83,.24,.17],todo:[.58,.83,.41,.17]};
export function zoneCandidates(regions,date){
 const out=[];const fingerprints=new Map();
 for(const [zone,content] of Object.entries(regions)){
 const unclassified=[];const journal=[];
 for(const raw of (content||'').split('\n')){
  const v=classifyLine(raw,zone);if(!v)continue;
  if(v.type==='unclassified'){unclassified.push(v.source);continue;}
  if(v.type==='journal'){journal.push(v.source);continue;}
  // Matching explicit time and category denotes a likely same event in another region.
  const key=v.time&&['meal','coffee','water','beverage','event'].includes(v.type)?`${date}:${v.type}:${v.time}`:'';
  if(key&&fingerprints.has(key)){const first=fingerprints.get(key);const a=compact(first.name),b=compact(v.name);if(a===b || (Math.min(a.length,b.length)>=5 && (a.includes(b)||b.includes(a)))){first.source=(first.source+' / '+v.source).slice(0,500);first.reason='同事件多處線索，請確認';continue;}v.reason='同時間可能重複，請核對';}
  const candidate={...v,date,recommended:false,reason:v.reason || (zone==='spending'?'付款及金額待確認':'辨識分類與內容待確認')};
  if(v.type==='meal')Object.assign(candidate,{amount:amountValue(v.source)});
  if(['coffee','water','beverage'].includes(v.type))Object.assign(candidate,{amount:amountValue(v.source),volume:volumeValue(v.source),startTime:v.time});
  const quantity=v.source.match(/(\d+(?:\.\d+)?)\s*(顆|根|條|份|杯|碗|瓶|個)/);
  if(quantity)Object.assign(candidate,{quantity:Number(quantity[1]),unit:quantity[2]});
  if(key)fingerprints.set(key,candidate);out.push(candidate);
 }
 let journalChunk='';
 const flushJournal=()=>{if(!journalChunk)return;out.push({type:'journal',date,zone,source:journalChunk,name:journalChunk.slice(0,100),highlight:zone==='highlight'?journalChunk:'',wellbeing:zone==='body'?journalChunk:'',todo:zone==='todo'?journalChunk:'',theme:zone==='header'?journalChunk:'',mood:'',recommended:false,reason:'小誌文字待核對'});journalChunk='';};
 for(const line of journal){if(journalChunk && journalChunk.length+line.length+1>480)flushJournal();journalChunk+=(journalChunk?'\n':'')+line.slice(0,480);}flushJournal();
 let chunk='';
 for(const line of unclassified){if(chunk && chunk.length+line.length+1>480){out.push({type:'unclassified',date,zone,name:chunk.slice(0,100),source:chunk,recommended:false,reason:'此區文字需要手動分類'});chunk='';} chunk+=(chunk?'\n':'')+line.slice(0,480);}
 if(chunk)out.push({type:'unclassified',date,zone,name:chunk.slice(0,100),source:chunk,recommended:false,reason:'此區文字需要手動分類'});
 }
 return out;
}
