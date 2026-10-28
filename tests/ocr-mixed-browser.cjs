const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
// Stub only OCR output at the module boundary; exercise the real review UI,
// planner, localStorage, confirmation, drafts and re-import in a real browser.
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4175','--strictPort'],{stdio:'ignore'});
(async()=>{
 let browser;
 try{
  const {candidates,existing}=await import('./fixtures/ocr-batch.js');
  for(let i=0;i<80;i++){
   try{if((await fetch('http://127.0.0.1:4175/test-ai-code/')).ok)break;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({...process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.env.CI?{}:{channel:'chrome'},headless:true,args:['--no-sandbox']});
  fs.mkdirSync(process.env.SCREENSHOT_DIR||'test-results',{recursive:true});
  for(const width of [390,1440])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}});
   await context.addInitScript(({existing,theme})=>{localStorage.setItem('second-brain-lite-v2',JSON.stringify(existing));localStorage.setItem('second-brain-theme',theme);},{existing,theme});
   await context.route('**/src/ocr.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function recognizeCard(){return ${JSON.stringify({candidates,raw:{whole:'synthetic'}})}}`}));
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4175/test-ai-code/');
   // Production CSP blocks Vite's inline dev CSS; load the same stylesheet externally.
   await page.addStyleTag({url:'http://127.0.0.1:4175/test-ai-code/src/style.css?direct'});
   assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--page').trim()),'');
   await page.locator('#ocr-open').click();
   const scan=async()=>{
    await page.locator('#ocr-image').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('synthetic OCR stub')});
    await page.waitForFunction(()=>document.querySelectorAll('.ocr-row').length===22);
   };
   await scan();
   for(let i=0;i<candidates.length;i++)if(candidates[i].reviewed){
    const row=page.locator(`.ocr-row[data-index="${i}"]`);await row.locator('summary').click();await row.locator('[data-verified]').check();await row.locator('summary').click();
   }
   await page.locator('#ocr-select-all').click();assert.equal(await page.locator('[data-select]:checked').count(),22);
   await page.locator('#ocr-commit').click();
   assert.match(await page.locator('#confirm').innerText(),/成功 5 筆，重複跳過 3 筆，暫存待確認 14 筆，失敗 0 筆/);
   assert.equal((await page.locator('#confirm').innerText()).match(/第 \d+ 筆/g).length,22);
   await page.locator('#no').click();
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('second-brain-lite-v2'))),existing);
   await page.locator('#ocr-commit').click();await page.locator('#yes').click();
   await page.locator('#ocr-result li').last().waitFor();assert.equal(await page.locator('#ocr-result li').count(),22);
   const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('second-brain-lite-v2')));
   assert.equal(saved.records.length,22);assert.deepEqual(saved.records.slice(0,3),existing.records);
   assert.equal(saved.records.filter(r=>r.type==='draft').length,14);
   assert.equal(saved.records.filter(r=>r.type==='spending').length,0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.locator('#ocr-dialog').evaluate(d=>d.scrollWidth>d.clientWidth),false);
   await page.screenshot({path:`${process.env.SCREENSHOT_DIR||'test-results'}/mixed-${width}-${theme}.png`,fullPage:true});
   await scan();await page.locator('#ocr-select-all').click();await page.locator('#ocr-commit').click();await page.locator('#yes').click();
   await page.waitForFunction(()=>document.querySelector('#ocr-result').textContent.includes('重複跳過 22 筆'));
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('second-brain-lite-v2'))),saved);
   await page.locator('#ocr-cancel').click();
   await page.locator('#ocr-drafts').click();assert.equal(await page.locator('.ocr-row').count(),14);
   assert.equal(await page.locator('.ocr-row [data-field=type]').evaluateAll(nodes=>nodes.filter(n=>n.value==='unclassified').length),3);
   assert.deepEqual(errors,[]);await context.close();
   console.log(`PASS mixed batch ${width} ${theme}: 22 selected, 5 new / 3 exact copies / 14 drafts, reasons, cancel, retry, draft reopen, no overwrite`);
  }
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
