const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4178','--strictPort'],{stdio:'ignore'});
const url='http://127.0.0.1:4178/test-ai-code/';
(async()=>{
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.env.CI?{}:{channel:'chrome'}});
  const c=await browser.newContext({viewport:{width:390,height:844}}), p=await c.newPage(), errors=[], requests=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
  await p.goto(url);await p.locator('#ocr-open').waitFor();
  // Fixed synthetic fixture avoids dependency on host Chinese font selection.
  const fixture=fs.readFileSync('tests/fixtures/ocr-card.png').toString('base64');
  const images=await p.evaluate(async data=>{
    const image=new Image(); image.src='data:image/png;base64,'+data; await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
    return ['image/png','image/jpeg','image/webp'].map(mime=>({mime,data:canvas.toDataURL(mime,.95).split(',')[1]}));
  },fixture);
  await p.locator('#ocr-open').click();
  await p.locator('#ocr-image').setInputFiles(images.map((image,i)=>({name:`synthetic-card-${i}.${['png','jpg','webp'][i]}`,mimeType:image.mime,buffer:Buffer.from(image.data,'base64')})));
  await p.waitForFunction(()=>document.querySelector('#ocr-progress').textContent.includes('辨識完成：'),null,{timeout:240000});
  const errorText=await p.locator('#ocr-dialog > .error').innerText();assert.equal(errorText,'');
  const count=await p.locator('.ocr-row').count();assert(count>=3,`only ${count} candidates`);
  assert.equal(await p.locator('#ocr-original-select option').count(),3);
  const values=await p.locator('.ocr-row').evaluateAll(rows=>rows.map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value]))));
  assert(values.some(v=>v.date==='2025-02-03'),'explicit date recovered');
  assert(values.some(v=>v.type==='sleep'&&v.minutes==='370'),'sleep duration recovered');
  assert(values.some(v=>v.type==='activity'&&v.steps==='6789'),'steps recovered');
  assert(values.some(v=>v.type==='sunlight'&&v.minutes==='23'),'sunlight recovered');
  assert.equal(await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),null,'OCR alone never writes');
  await p.locator('#ocr-select-all').click();assert.equal(await p.locator('[data-select]:checked').count(),count);
  await p.locator('#ocr-clear').click();assert.equal(await p.locator('[data-select]:checked').count(),0);
  await p.locator('#ocr-select-all').click();await p.locator('#ocr-commit').click();
  assert.equal((await p.locator('#confirm').innerText()).match(/第 \d+ 筆/g).length,count);
  await p.locator('#no').click();assert.equal(await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),null);
  const output=process.env.SCREENSHOT_DIR||'test-results';fs.mkdirSync(output,{recursive:true});
  await p.locator("#ocr-dialog").evaluate(d=>d.scrollTop=0);
  await p.screenshot({path:`${output}/v05-ocr-real-engine-mobile.png`,fullPage:false});
  fs.writeFileSync(`${output}/v05-ocr-synthetic-input.png`,Buffer.from(images[0].data,'base64'));
  fs.writeFileSync(`${output}/v05-ocr-real-engine.json`,JSON.stringify({count,values,errorText,engine:browser.version()},null,2));
  assert.equal(await p.locator('#ocr-dialog').evaluate(d=>d.scrollWidth>d.clientWidth),false);
  assert(requests.every(u=>u.startsWith('http://127.0.0.1:4178/')||u.startsWith('blob:')||u.startsWith('data:')),requests.join('\n'));
  assert.deepEqual(errors,[]);
  console.log(`PASS real Tesseract engine: PNG/JPEG/WebP batch; ${count} candidates; date/sleep/steps/sunlight; all/none, reasons, cancel/no write, same-origin only`);
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
