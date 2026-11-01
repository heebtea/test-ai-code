import {it,expect} from 'vitest';
import {planReviewBatch} from '../src/ocr-review.js';
import {candidateRecord,findExactCandidate} from '../src/ocr-records.js';
import {empty,expenses,parseBackup,merge} from '../src/data.js';
import {existing,items,day} from './fixtures/ocr-batch.js';
it('22 mixed candidates each have a decision; only exact copies skip, different daily metrics become drafts',()=>{
 const snapshot=JSON.stringify(existing);
 const p=planReviewBatch(existing,items);
 expect([p.added,p.skipped,p.drafts,p.failed]).toEqual([5,3,14,0]);
 expect(p.results).toHaveLength(22);
 expect(p.results.every(r=>r.reason&&r.code)).toBe(true);
 expect(p.results.slice(0,3).every(r=>r.code==='duplicate-record')).toBe(true);
 expect(p.results[3].kind).toBe('draft');
 expect(p.results[19].reason).toContain('重複計帳');
 expect(p.data.records.slice(0,3)).toEqual(existing.records);
 expect(JSON.stringify(existing)).toBe(snapshot);
 expect(expenses(p.data,day).map(r=>r.amount)).toEqual([75]);
 expect(p.data.records.filter(r=>r.type==='draft'&&r.classification==='unclassified')).toHaveLength(3);
 expect(parseBackup(JSON.stringify(p.data))).toEqual(p.data);
 const replay=planReviewBatch(p.data,items);
 expect([replay.added,replay.skipped,replay.drafts,replay.failed]).toEqual([0,22,0,0]);
 expect(replay.data).toEqual(p.data);
});
it('every persisted fact matters: same name/time or same day/type cannot discard changed content',()=>{
 const v={type:'event',date:day,name:'synthetic',time:'09:00',status:'已記錄',note:'old'};
 const data={version:5,records:[candidateRecord(v,'old')]};
 expect(findExactCandidate(data,{...v,note:'new'})).toBeUndefined();
 const p=planReviewBatch(data,[{id:'new',index:0,values:{...v,note:'new'},trusted:true,action:'skip'}]);
 expect(p.added).toBe(1);expect(p.skipped).toBe(0);
});
it('unknown, invalid, unverified and purchased-only data cannot silently enter statistics',()=>{
 const p=planReviewBatch(empty(),items.slice(9,18));
 expect(p.added).toBe(0); expect(p.drafts).toBe(9);expect(expenses(p.data,day)).toEqual([]);
 expect(JSON.parse(p.data.records[1].payload).paid).toBeUndefined();
 const numeric=planReviewBatch(empty(),[{id:'raw',values:{type:'unclassified',steps:123,name:'unknown'},source:'synthetic'}]);
 expect(JSON.parse(numeric.data.records[0].payload).steps).toBe('123');
});
it('ID collision or forged draft ID fails per item without overwriting and processing continues',()=>{
 const p=planReviewBatch(existing,[{...items[4],id:existing.records[0].id},{...items[5],draftId:existing.records[1].id},items[6],{id:'bad',values:null}]);
 expect(p.failed).toBe(3);expect(p.added).toBe(1);
 expect(p.data.records.slice(0,3)).toEqual(existing.records);
});
it.each([2,3,4,5,6])('JSON v%s remains readable and original records survive draft export/reimport',version=>{
 const original={version,records:[candidateRecord({type:'water',date:day,status:'已飲用',volume:'101'},'legacy')]};
 const loaded=parseBackup(JSON.stringify(original));
 const p=planReviewBatch(loaded,[items[9]]);
 expect(loaded).toEqual(original);expect(p.data.version).toBe(7);
 expect(p.data.records[0]).toEqual(original.records[0]);
 expect(merge(parseBackup(JSON.stringify(p.data)),original).added).toBe(0);
 expect(parseBackup(JSON.stringify(p.data))).toEqual(p.data);
});
