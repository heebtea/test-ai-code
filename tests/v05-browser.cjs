const {chromium,webkit}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4177','--strictPort'],{stdio:'ignore'});
const url='http://127.0.0.1:4177/test-ai-code/';
const output=process.env.SCREENSHOT_DIR||'test-results';
const day='2025-02-03';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const common=(id,type,status)=>({id,type,status,date:day,time:'12:00',note:'合成驗證',provenance:'合成測試',updatedAt:'2025-02-03T12:00:00.000Z'});
const backup=theme=>({format:'second-brain-lite-complete',backupVersion:1,appVersion:'0.5.0',records:{version:7,records:[
 {...common('meal','meal','部分'),name:'合成午餐',amount:125,paid:true,paymentDate:day,orderDate:day,startTime:'12:00',endTime:'12:20',quantity:3,consumedQuantity:1,familyQuantity:1,remainingQuantity:1,unit:'份'},
 {...common('coffee','coffee','飲用中'),volume:480,amount:null,payment:'voucher',purchaseDate:null,startTime:'13:00',endTime:''},
 {...common('water','water','已飲用'),volume:350},
 {...common('refund','spending','已付款'),transactionKind:'refund',amount:20},
 {...common('sleep','sleep','已完成'),minutes:370,deep:60,rem:70,score:80},
]},photos:[{id:'meal',mime:'image/png',data:png}],templates:[{id:'synthetic-template',name:'合成三欄',background:'#f6f3eb',accent:'#386a58',font:'sans',columns:3,illustration:'✳',mapping:['overview','health','timeline','food','highlight','body','todo'],image:{mime:'image/png',data:png}}],settings:{theme,template:'synthetic-template'}});
async function importComplete(page,value){
 await page.locator('#complete-import').setInputFiles({name:'synthetic-complete.json',mimeType:'application/json',buffer:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
 await page.locator('#backup-dialog').waitFor({state:'visible'});
}
async function apply(page){await page.locator('#backup-apply').click();await page.locator('#backup-dialog').waitFor({state:'hidden'});}
async function exportComplete(page){const download=page.waitForEvent('download');await page.locator('#complete-export').click();return JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));}
const comparable=x=>{const y=structuredClone(x);delete y.createdAt;return y;};
(async()=>{
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const engine=process.env.BROWSER_ENGINE==='webkit'?'webkit':'chromium';
  browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='webkit'?process.env.WEBKIT_PATH?{executablePath:process.env.WEBKIT_PATH}:{}:process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.env.CI?{}:{channel:'chrome'})});
  fs.mkdirSync(output,{recursive:true});
  for(const width of [390,1440])for(const theme of ['light','dark']){
   const c=await browser.newContext({viewport:{width,height:width===390?844:1000},...(width===390?{isMobile:true,hasTouch:true}:{}),colorScheme:theme});
   const p=await c.newPage();const errors=[],external=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4177/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
   await p.goto(url);await p.locator('#complete-export').waitFor();
   const data=backup(theme);await importComplete(p,data);
   assert.match(await p.locator('#backup-dialog').innerText(),/新增 9 · 相同 0 · 衝突 0 · 無法解析 0/);
   await p.locator('#backup-cancel').click();assert.equal(await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),null);
   await importComplete(p,data);await apply(p);
   await p.locator('#date').fill(day);await p.locator('#date').dispatchEvent('change');
   assert.equal(await p.locator('html').getAttribute('data-theme'),theme);
   assert.match(await p.locator('.hydration .metric').innerText(),/350/);
   assert.match(await p.locator('.spending .metric').innerText(),/125/);
   await p.locator('.spending summary').click();assert.match(await p.locator('.spending').innerText(),/105/);assert.match(await p.locator('.spending').innerText(),/退費/);
   await p.locator('.spending summary').click();
   await p.locator('#prev').click();assert.equal(await p.locator('.water .metric').innerText(),'尚無資料');await p.locator('#next').click();
   await p.locator('.meal summary').click();await p.locator('.meal [data-edit]').click();
   assert.equal(await p.locator('[name=quantity]').inputValue(),'3');assert.equal(await p.locator('[name=consumedQuantity]').inputValue(),'1');
   assert.equal(await p.locator('#editor').evaluate(d=>d.scrollWidth>d.clientWidth),false);
   await p.screenshot({path:`${output}/v05-${engine}-${width}-${theme}-editor.png`,fullPage:false});
   await p.locator('#cancel').click();
   const saved=await exportComplete(p);assert.deepEqual(comparable(saved),comparable(data));
   await p.reload();await p.locator('#date').fill(day);await p.locator('#date').dispatchEvent('change');
   await p.locator('#journal').click();assert.equal(await p.locator('#journal-download').isEnabled(),true);
   const dl=p.waitForEvent('download');await p.locator('#journal-download').click();const image=fs.readFileSync(await (await dl).path());
   assert.equal(image.readUInt32BE(16),1080);assert.equal(image.readUInt32BE(20),1920);
   fs.writeFileSync(`${output}/v05-${engine}-${width}-${theme}-journal.png`,image);await p.locator('#journal-close').click();
   assert.deepEqual(comparable(await exportComplete(p)),comparable(saved));
   // A separate browser context has separate localStorage AND IndexedDB: real device portability boundary.
   const c2=await browser.newContext({viewport:{width:390,height:844}});const p2=await c2.newPage();await p2.goto(url);await p2.locator('#complete-import').waitFor();
   assert.equal(await p2.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),null);
   await importComplete(p2,saved);await apply(p2);assert.deepEqual(comparable(await exportComplete(p2)),comparable(saved));
   const conflict=structuredClone(saved);conflict.records.records[0].amount=999;conflict.settings.theme=theme==='light'?'dark':'light';
   await importComplete(p2,conflict);assert.match(await p2.locator('#backup-dialog').innerText(),/衝突 2/);
   await p2.screenshot({path:`${output}/v05-${engine}-${width}-${theme}-restore.png`,fullPage:false});
   await apply(p2);assert.deepEqual(comparable(await exportComplete(p2)),comparable(saved));
   await importComplete(p2,conflict);const row=p2.locator('.backup-rows details').filter({hasText:'合成午餐'});await row.locator('summary').click();await row.locator('select').selectOption('replace');await apply(p2);
   const replaced=await exportComplete(p2);assert.equal(replaced.records.records[0].amount,999);assert.equal(replaced.settings.theme,theme);assert.equal(replaced.photos[0].data,png);
   // Fail a real localStorage write after IndexedDB mutations; verify rollback and no orphan image.
   const fail=structuredClone(replaced);fail.records.records.push({...fail.records.records[2],id:'failure'});fail.photos.push({id:'failure',mime:'image/png',data:png});
   await importComplete(p2,fail);
   await p2.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='second-brain-lite-v2'){Storage.prototype.setItem=original;throw Error('synthetic quota');}return original.call(this,k,v);};});
   await p2.locator('#backup-apply').click();await p2.waitForFunction(()=>document.querySelector('#backup-dialog .error').textContent.includes('已回復原有資料'));
   await p2.locator('#backup-cancel').click();assert.deepEqual(comparable(await exportComplete(p2)),comparable(replaced));
   // Reject stale previews instead of overwriting a newer local change.
   await importComplete(p2,fail);await p2.evaluate(()=>localStorage.setItem('second-brain-theme','synthetic-stale'));
   await p2.locator('#backup-apply').click();await p2.waitForFunction(()=>document.querySelector('#backup-dialog .error').textContent.includes('重新預覽'));
   await p2.locator('#backup-cancel').click();
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   await c2.close();await c.close();console.log(`PASS v0.5 ${engine} ${width}px ${theme}: separate-device full roundtrip, photo/template bytes, conflicts, rollback, stale preview, quantities, date, PNG 1080x1920`);
  }
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
