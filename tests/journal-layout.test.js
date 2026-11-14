import { it, expect } from 'vitest';
import { baseTemplate } from '../src/templates.js';
import { planJournalLayout, renderJournalPage, wrapJournalText, JOURNAL_SIZE } from '../src/journal-layout.js';
import { journalDocumentSections } from '../src/journal-document.js';
import { journalFixture, day } from './fixtures/journal-flow.js';
import { parseBackup, merge, empty, cashflow, liquidIntake } from '../src/data.js';
function fakeCanvas() {
  const drawn=[];
  const ctx={ font:'27px sans-serif', fillStyle:'',
    measureText(value){const size=Number(this.font.match(/(\d+)px/)?.[1] || 27);return {width:Array.from(String(value)).reduce((s,c)=>s+(/[A-Za-z0-9 ]/.test(c)?size*.52:size),0)};},
    fillRect(...args){drawn.push({kind:'rect',args});},
    fillText(...args){drawn.push({kind:'text',args,font:this.font,width:this.measureText(args[0]).width});},
  };
  return {canvas:{width:0,height:0,getContext:()=>ctx},ctx,drawn};
}
function assertCoverage(plan) {
  const actual=plan.pages.flatMap(p=>p.cards.flatMap(c=>c.lines.map(l=>[l.id,l.index,l.text])));
  const expected=plan.items.flatMap(item=>item.entries.flatMap(e=>e.lines.map((line,i)=>[e.id,i,line])));
  expect(actual).toEqual(expected);
  expect(new Set(actual.map(([id,i])=>`${id}:${i}`)).size).toBe(actual.length);
}
it('wraps Chinese, URLs, whitespace and graphemes without dropping characters',()=>{
  const {ctx}=fakeCanvas();
  for(const text of ['中文 https://example.test/12345678901234567890  完整','家庭👨‍👩‍👧‍👦é測試','首行\n\n尾行']) {
    const lines=wrapJournalText(ctx,text,280);
    expect(lines.join('')).toBe(text.replaceAll('\n',''));
    expect(lines.some(l=>l.includes('…'))).toBe(false);
  }
});
it.each([1,2,3])('paginates at readable size in %i columns with exact once-only line coverage',columns=>{
  const {ctx,canvas,drawn}=fakeCanvas();
  const data=journalFixture(), before=JSON.stringify(data), sections=journalDocumentSections(data,day);
  const template={...baseTemplate(),columns};
  const plan=planJournalLayout(ctx,sections,[],template);
  expect(plan.size).toBe(27);expect(plan.pageCount).toBeGreaterThan(1);expect(plan.clipped).toBe(0);
  assertCoverage(plan);
  for(let i=0;i<plan.pageCount;i++)renderJournalPage(canvas,plan,day,template,i);
  expect(canvas.width).toBe(1080);expect(canvas.height).toBe(1920);
  for(const page of plan.pages) for(const card of page.cards) {
    expect(card.y+card.height).toBeLessThanOrEqual(JOURNAL_SIZE.bottom);
    expect(card.x+card.width).toBeLessThanOrEqual(1026);
    // Each drawn glyph lies inside its card and above the footer.
    for(const line of card.lines) expect(card.y+line.offset+27).toBeLessThan(card.y+card.height);
  }
  expect(drawn.filter(d=>d.kind==='text').every(d=>d.args.length===3)).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
});
it('flows long expense rows across columns/pages, preserving notes, amount and 11 transactions',()=>{
  const data=journalFixture(), out=journalDocumentSections(data,day), {ctx}=fakeCanvas();
  const plan=planJournalLayout(ctx,out,[],baseTemplate());
  const transactions=out.filter(s=>s.id.startsWith('transaction:'));
  expect(transactions).toHaveLength(11);
  expect(cashflow(data,day).totals.purchase.value).toBe(638);
  expect(data.records.slice(0,5).reduce((s,r)=>s+r.amount,0)).toBe(457);
  expect(data.records.slice(5,8).reduce((s,r)=>s+r.amount,0)).toBe(115);
  expect(data.records.slice(8,11).reduce((s,r)=>s+r.amount,0)).toBe(66);
  expect(out.find(s=>s.id==='expense-summary').value).toContain('638 NT$');
  expect(transactions.find(s=>s.id==='transaction:synthetic-purchase-5').value).toContain('不計本人攝取');
  expect(plan.pages.flatMap(p=>p.cards).filter(c=>c.key==='food-money').length).toBeGreaterThan(1);
  assertCoverage(plan);
});
it('preserves nulls, unfinished intake, original start/end and prior purchases through JSON import',()=>{
  const source=journalFixture(), text=JSON.stringify(source), parsed=parseBackup(text);
  const imported=merge(empty(),parsed).data;
  expect(imported.records).toEqual(source.records);
  expect(merge(imported,parsed).added).toBe(0);
  expect(journalDocumentSections(imported,day)).toEqual(journalDocumentSections(source,day));
  expect(liquidIntake(imported,day).value).toBe(1080);
  expect(liquidIntake(imported,day).pending).toBe(2);
  const sections=journalDocumentSections(imported,day);
  expect(sections.find(s=>s.id==='synthetic-coffee').value).toContain('08:30～09:25');
  expect(sections.find(s=>s.id==='synthetic-water').value).toContain('飲用中');
  expect(sections.find(s=>s.id==='synthetic-water').value).toContain('未知');
  expect(sections.some(s=>s.id==='transaction:synthetic-drink')).toBe(false);
  expect(JSON.stringify(source)).toBe(text);
});
it('retains unknown transactions and separates refunds and reimbursements without inferring zero',()=>{
  const data=journalFixture();
  data.records.push(...[['unknown',null,'purchase'],['refund',20,'refund'],['reimbursement',10,'reimbursement']].map(([id,amount,transactionKind])=>({id,date:day,type:'spending',status:'已付款',time:'',note:id,amount,paymentDate:day,transactionKind})));
  const out=journalDocumentSections(data,day);
  expect(out.find(s=>s.id==='transaction:unknown').value).toContain('未知');
  expect(out.find(s=>s.id==='expense-summary').value).toContain('608 NT$');
  expect(out.filter(s=>s.id.startsWith('transaction:'))).toHaveLength(14);
});
it('balances the available three columns and supports custom mapping and empty days',()=>{
  const {ctx}=fakeCanvas();
  const sections=Array.from({length:18},(_,i)=>({id:`x${i}`,group:'food-money',title:'',value:'合成明細'.repeat(5)}));
  const plan=planJournalLayout(ctx,sections,[],baseTemplate());
  const used=new Set(plan.pages[0].cards.map(c=>c.x));
  expect(used.size).toBe(3);assertCoverage(plan);
  const reversed={...baseTemplate(),mapping:[...baseTemplate().mapping].reverse()};
  const reordered=planJournalLayout(ctx,[{title:'每日主題',value:'測試'},{title:'待辦事項',value:'修正'}],[],reversed);
  expect(reordered.items[0].key).toBe('todo');
  expect(planJournalLayout(ctx,[],[],baseTemplate()).missing).toBe(true);
});
it('retains very long narratives and 180 events over many pages, never ellipsizing',()=>{
  const {ctx}=fakeCanvas();
  const events=Array.from({length:180},(_,i)=>({time:'12:00',label:'合成事件'+i,record:{name:'長名稱'.repeat(20),note:'長備註'.repeat(40)}}));
  const plan=planJournalLayout(ctx,[{title:'每日主題',value:'長段落'.repeat(1200)}],events,baseTemplate());
  expect(plan.pages.length).toBeGreaterThan(3);expect(plan.shown).toBe(180);assertCoverage(plan);
  expect(plan.items.flatMap(i=>i.entries).filter(e=>e.id.startsWith('timeline-'))).toHaveLength(180);
});
