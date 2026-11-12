import { it, expect } from 'vitest';
import { planReviewBatch as historicalPlan } from './fixtures/legacy-ocr-review.js';
import { planReviewBatch } from '../src/ocr-review.js';
import { candidateRecord } from '../src/ocr-records.js';
import { validateRecord, parseBackup, upsert, cashflow, liquidIntake } from '../src/data.js';
import { zoneCandidates } from '../src/ocr-layout.js';
const day='2025-02-03';
it('historical code reproduces 0 success / 22 skipped for different same-day values; v0.5 keeps all for review',()=>{
 const old={version:5,records:[candidateRecord({type:'sleep',date:day,minutes:300,status:'已完成'},'existing')]};
 const items=Array.from({length:22},(_,i)=>({id:'c'+i,index:i,recommended:true,trusted:true,action:'skip',values:{type:'sleep',date:day,minutes:String(400+i),score:'',status:'已完成'}}));
 const before=JSON.stringify(old);
 const historic=historicalPlan(old,items);
 expect([historic.added,historic.skipped,historic.drafts]).toEqual([0,22,0]);
 const fixed=planReviewBatch(old,items);
 expect([fixed.added,fixed.skipped,fixed.drafts]).toEqual([0,0,22]);
 expect(fixed.results.every(r=>r.reason.includes('同日數據內容不同'))).toBe(true);
 expect(JSON.stringify(old)).toBe(before);
});
it('same-name and same-date purchases are not discarded, quantity edits are stored without inventing consumption',()=>{
 const a={type:'meal',date:day,name:'合成香蕉',quantity:'5',unit:'根',paid:'yes',paymentDate:day,amount:'50',status:'未確認'};
 const p=planReviewBatch({version:5,records:[]},[{id:'x',values:a,verified:true}]);
 expect(p.drafts).toBe(1);expect(p.added).toBe(0);
 const r=candidateRecord({...a,status:'部分',consumedQuantity:'1',familyQuantity:'2',remainingQuantity:'2'},'m');
 expect(r.quantity).toBe(5);expect(r.consumedQuantity).toBe(1);
 expect(()=>validateRecord({...r,consumedQuantity:4})).toThrow(/超過/);
 const changed=upsert({version:7,records:[r]},{...r,consumedQuantity:2,remainingQuantity:1});
 expect(changed.records).toHaveLength(1);expect(changed.records[0].id).toBe('m');
 expect(parseBackup(JSON.stringify(changed))).toEqual(changed);
});
it('voucher defaults to 480mL, accepts correction, starts drinking without consuming, and purchase/refund/reimbursement stay separate',()=>{
 const coffee=candidateRecord({type:'coffee',date:day,payment:'voucher',status:'飲用中'},'coffee');
 expect(coffee.volume).toBe(480);expect(coffee.amount).toBeNull();
 expect(candidateRecord({type:'coffee',date:day,payment:'voucher',status:'飲用中',volume:'420'},'coffee').volume).toBe(420);
 const money=(id,amount,transactionKind)=>({id,date:day,type:'spending',time:'',note:'合成交易',status:'已付款',amount,transactionKind});
 const data={version:7,records:[coffee,money('p',100,'purchase'),money('u',null,'purchase'),money('r',20,'refund'),money('b',10,'reimbursement')]};
 const f=cashflow(data,day);
 expect(f.totals.purchase.value).toBe(100);expect(f.totals.refund.value).toBe(20);expect(f.totals.reimbursement.value).toBe(10);expect(f.knownNet).toBe(70);expect(f.unknown).toBe(1);
 expect(liquidIntake(data,day).value).toBeNull();
});
it('OCR extracts explicit amount/volume/quantity but never assumes paid or consumed',()=>{
 const result=zoneCandidates({meal:'12:00 午餐便當 2 份 $120',drinks:'14:00 美式咖啡 480 mL $35'},day);
 expect(result[0]).toMatchObject({quantity:2,unit:'份',amount:120});
 expect(result[1]).toMatchObject({volume:480,amount:35});
 for(const c of result){expect(c.recommended).toBe(false);expect(c.paid).toBeUndefined();expect(c.status).toBeUndefined();}
});
it('same amount is only a possible payment overlap; user can explicitly confirm an independent transaction',()=>{
 const data={version:6,records:[{id:'first',date:day,type:'spending',status:'已付款',time:'12:00',note:'合成交易甲',amount:70}]};
 const item={id:'second',values:{type:'spending',date:day,status:'已付款',time:'13:00',note:'合成交易乙',amount:'70'},verified:true};
 expect(planReviewBatch(data,[item]).drafts).toBe(1);
 const p=planReviewBatch(data,[{...item,separatePayment:true}]);expect(p.added).toBe(1);expect(cashflow(p.data,day).totals.purchase.value).toBe(140);
});
