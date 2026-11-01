import { describe, it, expect } from 'vitest';
import { classifyLine, zoneCandidates } from '../src/ocr-layout.js';
import { planReviewBatch } from '../src/ocr-review.js';
import { empty, expenses, parseBackup } from '../src/data.js';

const date='2026-01-02';
const item=(id,values,extra={})=>({id,index:id,values:{date,...values},source:'synthetic',action:'add',...extra});
describe('section classification and safe review',()=>{
 it('separates travel, education, drinks and meals and coalesces ambiguous text',()=>{
  expect(classifyLine('07:30 通勤前往職訓','timeline').type).toBe('event');
  expect(classifyLine('09:10 開始喝麥茶','drinks').type).toBe('beverage');
  expect(classifyLine('12:00 午餐便當','meal').type).toBe('meal');
  expect(classifyLine('飲食相關 總計 $90','spending').type).toBe('unclassified');
  const c=zoneCandidates({timeline:'雜訊甲\n雜訊乙'},date);
  expect(c).toHaveLength(1); expect(c[0].source).toContain('雜訊乙');
 });
 it('stores unknown payment and consumption as drafts without affecting expenses and deduplicates them',()=>{
  const candidates=[item('s',{type:'sleep',status:'已完成',minutes:'365',score:''},{trusted:true}),item('m',{type:'meal',name:'餐點',paid:'',status:'',amount:'55'}),item('c',{type:'coffee',status:'已購買',payment:'purchase',purchaseDate:date,paidConfirm:'',volume:'300',amount:'45'},{verified:true})];
  const first=planReviewBatch(empty(),candidates); expect(first.added).toBe(1);expect(first.drafts).toBe(2);expect(expenses(first.data,date)).toHaveLength(0);
  const again=planReviewBatch(first.data,candidates.slice(1));expect(again.skipped).toBe(2);expect(again.data.records).toHaveLength(3);
  expect(parseBackup(JSON.stringify(first.data)).records).toHaveLength(3);
 });
});
