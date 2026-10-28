import { upsert, remove, validDate, expenses } from './data.js';
import { candidateRecord, planCandidates, findExactCandidate } from './ocr-records.js';

const classifications = ['sleep','activity','sunlight','meal','coffee','water','spending','event','journal','beverage'];
function unresolvedReason(v) {
  if (!classifications.includes(v.type)) return '分類不明，保留原文待分類';
  if (['meal','beverage'].includes(v.type) && (!['yes','no'].includes(v.paid) || !v.status || v.status === '未確認')) return '付款或食用／飲用狀態未確認';
  if (['meal','beverage'].includes(v.type) && v.paid === 'yes' && !v.paymentDate) return '實際付款日期未確認';
  if (v.type === 'coffee' && (!v.payment || !v.status || (v.payment === 'purchase' && (v.paidConfirm !== 'yes' || !v.purchaseDate)))) return '咖啡付款方式、實際付款日期或飲用狀態未確認';
  if (v.type === 'spending' && (!v.status || v.amount === '' || v.amount == null)) return '花費金額或付款狀態未確認';
  return '';
}
// The same payment can appear in both the food/drink and expense regions.
// Keep ambiguous overlaps out of totals, even after individual verification.
function paymentOverlap(data, record) {
  const incoming = {version:6, records:[record]};
  const date = record.paymentDate || record.purchaseDate || record.date;
  if (!expenses(incoming, date).length || record.amount === null) return false;
  return expenses(data, date).some(r => r.amount === record.amount);
}
export function planReviewBatch(data, items) {
  let next=data, added=0, merged=0, skipped=0, drafts=0, failed=0;
  const results=[];
  for (const item of items) {
    const report = (kind, code, reason, recordId) => results.push({index:item.index, kind, code, reason, recordId});
    try {
      const v=item.values;
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('候選格式無效');
      const source=String(item.source||'').slice(0,500);
      if (item.draftId && !next.records.some(r => r.id === item.draftId && r.type === 'draft')) throw Error('草稿 ID 無效，未覆寫既有資料');
      const duplicate=findExactCandidate(next,v);
      if (duplicate) {
        skipped++; report('skipped','duplicate-record','與既有紀錄所有欄位完全相同',duplicate.id); continue;
      }
      let reason=unresolvedReason(v);
      let record;
      if (!reason) {
        try { record=candidateRecord(v,item.id); }
        catch (e) { reason='格式或必填資料待確認：'+e.message; }
      }
      if (!reason && !(item.trusted || item.verified)) reason='尚未核對，保留為待確認草稿';
      if (!reason && paymentOverlap(next,record)) reason='可能與既有餐飲或花費重複計帳，待確認付款歸屬';
      if (!reason) {
        try {
          const p=planCandidates(next,[item]);
          if (p.skipped) reason='合併沒有新增欄位，內容仍不同，保留待確認';
          else {
            let planned=p.data;
            if (item.draftId) planned=remove(planned,item.draftId);
            next=planned; added+=p.added; merged+=p.merged;
            report('success',p.merged?'merged':'added',p.merged?'依確認僅補空白欄位':'格式合法且已核對，確認後新增',item.id); continue;
          }
        } catch (e) {
          reason=e.message;
        }
      }
      const classification=classifications.includes(v.type)?v.type:'unclassified';
      const cleanValues={};
      for (const [k,val] of Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) {
        if (typeof val==='string' || typeof val==='number' || typeof val==='boolean') cleanValues[k]=String(val).slice(0,500);
        else if (val===null) cleanValues[k]='';
      }
      cleanValues.type=classification;
      const payload=JSON.stringify(cleanValues);
      const existing=next.records.find(r => r.type==='draft' && r.classification===classification && r.source===source && JSON.stringify(Object.entries(JSON.parse(r.payload)).sort(([a],[b])=>a.localeCompare(b)))===JSON.stringify(Object.entries(cleanValues).sort(([a],[b])=>a.localeCompare(b))));
      if (existing) {
        skipped++; report('skipped','duplicate-draft','相同內容及來源的待確認草稿已保存',existing.id); continue;
      }
      const id=item.draftId||item.id;
      if (!item.draftId && next.records.some(r=>r.id===id)) throw Error('ID 衝突，未覆寫既有資料');
      next=upsert(next,{id,type:'draft',date:validDate(v.date)?v.date:'',status:'待確認',note:'',time:'',classification,payload,source});
      drafts++; report('draft','needs-review',reason,id);
    } catch (e) { failed++; report('failed','invalid-candidate',e.message); }
  }
  return {data:next,added,merged,skipped,drafts,failed,results};
}
