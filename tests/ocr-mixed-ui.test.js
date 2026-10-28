// @vitest-environment jsdom
import {it,expect,vi,beforeEach} from 'vitest';
import {candidates,existing} from './fixtures/ocr-batch.js';
import {STORAGE_KEY} from '../src/data.js';
vi.mock('../src/ocr.js',()=>({recognizeCard:vi.fn()}));
beforeEach(async()=>{
 vi.resetModules();localStorage.clear();document.body.innerHTML='<div id="app"></div>';
 localStorage.setItem(STORAGE_KEY,JSON.stringify(existing));
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};
 URL.createObjectURL=vi.fn(()=> 'blob:synthetic');URL.revokeObjectURL=vi.fn();
 const {recognizeCard}=await import('../src/ocr.js');recognizeCard.mockResolvedValue({candidates,raw:{whole:'synthetic'}});
 await import('../src/main.js');
});
it('selects all 22, previews every reason, cancels without writes, then commits only once',async()=>{
 document.querySelector('#ocr-open').click();
 const input=document.querySelector('#ocr-image');Object.defineProperty(input,'files',{value:[new File(['x'],'synthetic.png',{type:'image/png'})]});input.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(document.querySelectorAll('.ocr-row')).toHaveLength(22));
 for(const row of document.querySelectorAll('.ocr-row'))if(candidates[Number(row.dataset.index)].reviewed)row.querySelector('[data-verified]').checked=true;
 document.querySelector('#ocr-select-all').click();expect(document.querySelectorAll('[data-select]:checked')).toHaveLength(22);
 document.querySelector('#ocr-commit').click();
 expect(document.querySelector('#confirm').textContent).toContain('成功 5 筆，重複跳過 3 筆，暫存待確認 14 筆，失敗 0 筆');
 expect(document.querySelector('#confirm').textContent.match(/第 \d+ 筆/g)).toHaveLength(22);
 expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(existing);
 document.querySelector('#no').click();expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(existing);
 document.querySelector('#ocr-commit').click();document.querySelector('#yes').click();
 await vi.waitFor(()=>expect(document.querySelectorAll('#ocr-result li')).toHaveLength(22));
 const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));expect(saved.records).toHaveLength(22);
 expect(saved.records.slice(0,3)).toEqual(existing.records);
 expect(document.querySelectorAll('.ocr-row')).toHaveLength(0);
});
it('an unselected exact duplicate is pending rather than counted as processed/skipped',async()=>{
 document.querySelector('#ocr-open').click();
 const input=document.querySelector('#ocr-image');Object.defineProperty(input,'files',{value:[new File(['x'],'synthetic.png',{type:'image/png'})]});input.dispatchEvent(new Event('change'));
 await vi.waitFor(()=>expect(document.querySelectorAll('.ocr-row')).toHaveLength(22));
 document.querySelector('#ocr-clear').click();document.querySelector('.ocr-row[data-index="6"] [data-select]').checked=true;
 document.querySelector('#ocr-commit').click();expect(document.querySelector('#confirm').textContent).toContain('重複跳過 0 筆');expect(document.querySelector('#confirm').textContent).toContain('未選待處理 21 筆');
});
