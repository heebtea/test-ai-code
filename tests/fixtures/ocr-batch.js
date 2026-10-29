// Entirely synthetic. No user journal, image, or reported real metrics.
import { candidateRecord } from '../../src/ocr-records.js';
export const day='2025-02-03';
const c=(type, fields={})=>({type,date:day,source:'synthetic '+type,...fields});
export const candidates=[
 c('sleep',{minutes:345,score:76,status:'已完成',recommended:true}),
 c('activity',{steps:6789,status:'已完成',recommended:true}),
 c('sunlight',{minutes:23,status:'已記錄',recommended:true}),
 c('sleep',{score:82,status:'已完成',recommended:true}),
 c('event',{name:'合成事件甲',time:'09:10',status:'已記錄',reviewed:true}),
 c('event',{name:'合成事件乙',time:'11:20',status:'已記錄',reviewed:true}),
 c('activity',{date:'2025-02-04',steps:4321,status:'已完成',recommended:true}),
 ...['甲','乙','丙'].map(name=>c('unclassified',{name,source:'synthetic unknown '+name})),
 c('meal',{name:'合成訂購',amount:71,orderDate:day}),
 c('meal',{name:'合成付款未知',amount:72,status:'吃完'}),
 c('meal',{name:'合成食用未知',amount:73,paid:'yes',paymentDate:day}),
 c('coffee',{volume:210,amount:41,payment:'purchase',purchaseDate:day,status:'已購買',reviewed:true}),
 c('coffee',{volume:220,payment:'voucher'}),
 c('spending',{amount:74}),
 c('sunlight',{date:'',minutes:24,status:'已記錄',reviewed:true}),
 c('water',{volume:-1,status:'已飲用',reviewed:true}),
 c('meal',{name:'合成已付款餐點',amount:75,paid:'yes',paymentDate:day,status:'吃完',reviewed:true}),
 c('spending',{amount:75,status:'已付款',reviewed:true}),
 c('water',{volume:230,status:'已飲用',reviewed:true}),
 c('journal',{theme:'合成主題',status:'已記錄'}),
];
export function values(c) {
 const v=Object.fromEntries(Object.entries(c).filter(([k])=>!['source','recommended','reviewed'].includes(k)).map(([k,v])=>[k,v==null?'':String(v)]));
 if(c.type==='sunlight')v.source='';
 return v;
}
export const existing={version:5,records:candidates.slice(0,3).map((c,i)=>candidateRecord(values(c),'existing-'+i))};
export const items=candidates.map((c,i)=>({id:'candidate-'+i,index:i,source:c.source,values:values(c),trusted:!!c.recommended,verified:!!c.reviewed,recommended:!!c.recommended,action:'skip'}));
