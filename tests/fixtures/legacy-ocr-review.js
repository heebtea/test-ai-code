// Historical reproduction only: verbatim planner from main ceaff60 (imports adjusted).
import {upsert,remove,validDate} from '../../src/data.js';
import {candidateRecord,planCandidates} from './legacy-ocr-records.js';
const normalize=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
function sameDraft(r,classification,payload,source){return r.type==='draft'&&r.classification===classification&&r.payload===payload&&r.source===source;}
function duplicateConfirmed(data,v){
 if(!v.date||!['meal','event','coffee','water','beverage'].includes(v.type))return false;
 const name=normalize(v.name);const time=v.startTime||v.time;
 if(!name||!time)return false;
 return data.records.some(r=>r.type===v.type&&r.date===v.date&&normalize(r.name)===name&&(r.startTime||r.time)===time);
}
export function planReviewBatch(data,items){
 let next=data,added=0,merged=0,skipped=0,drafts=0,failed=0;const results=[];
 for(const item of items){
  try{
   const v=item.values;const source=String(item.source||'').slice(0,500);
   if(item.recommended && item.action==='skip' && next.records.some(r=>r.type===v.type && r.date===v.date)){skipped++;results.push({index:item.index,kind:'skipped'});continue;}
   const unresolved=((v.type==='meal'||v.type==='beverage') && (!v.paid || !v.status || v.status==='未確認')) ||
     (v.type==='coffee' && (!v.payment || !v.status || (v.payment==='purchase' && v.purchaseDate && v.paidConfirm!=='yes'))) ||
     (v.type==='spending' && (!v.status || v.amount===''));
   if((item.trusted||item.verified)&&v.type!=='unclassified'&&!unresolved){
    try{
      candidateRecord(v,item.id);
      const p=planCandidates(next,[{...item,values:v}]);next=p.data;added+=p.added;merged+=p.merged;skipped+=p.skipped;
      if(item.draftId && (p.added||p.merged))next=remove(next,item.draftId);
      results.push({index:item.index,kind:p.skipped?'skipped':'success'});continue;
    }catch{/* Incomplete or unsafe facts stay as a draft. */}
   }
   if(duplicateConfirmed(next,v)){skipped++;results.push({index:item.index,kind:'skipped'});continue;}
   const cleanValues={};for(const [k,val] of Object.entries(v))if(typeof val==='string')cleanValues[k]=val.slice(0,500);
   const classification=['sleep','activity','sunlight','meal','coffee','water','spending','event','journal','beverage'].includes(v.type)?v.type:'unclassified';cleanValues.type=classification;
   const payload=JSON.stringify(cleanValues);const existing=next.records.find(r=>sameDraft(r,classification,payload,source));
   if(existing && existing.id!==item.draftId){skipped++;results.push({index:item.index,kind:'skipped'});continue;}
   if(existing && existing.id===item.draftId){skipped++;results.push({index:item.index,kind:'skipped'});continue;}
   const id=item.draftId||item.id;
   if(!item.draftId&&next.records.some(r=>r.id===id))throw Error('ID 衝突');
   const date=validDate(v.date)?v.date:'';
   next=upsert(next,{id,type:'draft',date,status:'待確認',note:'',time:'',classification,payload,source});drafts++;results.push({index:item.index,kind:'draft'});
  }catch{failed++;results.push({index:item.index,kind:'failed'});}
 }
 return {data:next,added,merged,skipped,drafts,failed,results};
}
