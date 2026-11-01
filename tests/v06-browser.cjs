// Synthetic transport simulation: NO requests to a real Supabase account.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {spawn}=require('node:child_process');
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4186','--strictPort'],{stdio:'ignore'});
const url='http://127.0.0.1:4186/test-ai-code/';
const day='2026-11-01';
const water={id:'synthetic-water',type:'water',date:day,time:'12:00',status:'已飲用',note:'SECRET NOTE',provenance:'SECRET SOURCE',volume:200};
const seed={version:7,records:[water,{id:'synthetic-journal',type:'journal',date:day,time:'',status:'已記錄',note:'',theme:'秘密',highlight:'',wellbeing:'',mood:'',todo:''},{...water,id:'previous',date:'2026-10-31',volume:300}]};
let browser;
async function date(page){await page.locator('#date').fill(day);await page.locator('#date').dispatchEvent('change');}
async function login(page){
 await page.locator('#private-sync').click();
 await page.locator('[name=sync-url]').fill('https://synthetic.supabase.co');await page.locator('[name=sync-key]').fill('sb_publishable_synthetic12345');
 await page.locator('[name=sync-email]').fill('synthetic@example.invalid');await page.locator('[name=sync-consent]').check();
 await page.locator('[data-send]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('驗證碼已要求'));
 await page.locator('[name=sync-otp]').fill('123456');await page.locator('[data-login]').click();
 await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('已同步生活紀錄'));
}
async function sync(page){await page.locator('[data-sync]').click();await page.waitForFunction(()=>/已同步生活紀錄|筆衝突/.test(document.querySelector('[data-status]').textContent));}
async function edit(page,volume){
 await page.locator('[data-close]').click();await date(page);await page.locator('.water details').evaluate(d=>d.open=true);
 await page.locator('.water [data-edit]').click();await page.locator('[name=volume]').fill(String(volume));await page.locator('#edit-form .save').click();await page.locator('#editor').waitFor({state:'hidden'});
 await page.locator('#private-sync').click();
}
(async()=>{
 try {
 for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.env.CI?{}:{channel:'chrome'})});
 fs.mkdirSync('test-results',{recursive:true});
 for(const theme of ['light','dark']){
  const rows=new Map(),requests=[],errors=[];let fail=false,expired=false;
  async function context(width){
   const c=await browser.newContext({viewport:{width,height:900},...(width===390?{isMobile:true,hasTouch:true}:{}),colorScheme:theme,timezoneId:'America/Los_Angeles'});
   await c.route('https://synthetic.supabase.co/**',async route=>{
    const req=route.request();requests.push(req.url());const path=new URL(req.url()).pathname;
    const body=req.postDataJSON();let result={};let status=200;
    if(path.endsWith('/otp'))result={};
    else if(path.endsWith('/verify'))result={access_token:'synthetic-access',user:{id:'same-user'},expires_in:3600};
    else if(req.headers().authorization!=='Bearer synthetic-access'||expired){status=401;result={};}
    else if(fail){status=503;result={};}
    else if(path.endsWith('/sbl_list'))result=[...rows.values()];
    else if(path.endsWith('/sbl_cas')){
     const old=rows.get(body.p_id);
     if(old && JSON.stringify(old.record)===JSON.stringify(body.p_record)&&old.deleted===body.p_deleted)result=old;
     else if((old?.revision??0)!==body.p_expected){status=409;result={};}
     else {result={id:body.p_id,revision:(old?.revision??0)+1,record:body.p_record,deleted:body.p_deleted,server_updated_at:new Date().toISOString()};rows.set(body.p_id,result);}
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);
   await p.evaluate(theme=>localStorage.setItem('second-brain-theme',theme),theme);return {c,p};
  }
  const {c:phone,p}=await context(390);const {c:desktop,p:pc}=await context(1440);
  await p.evaluate(data=>localStorage.setItem('second-brain-lite-v2',JSON.stringify(data)),seed);await p.reload();await date(p);
  const before=await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2'));
  await p.locator('#ai-share').click();const preview=await p.locator('#ai-share-preview').inputValue();assert.ok(!preview.includes('SECRET'));assert.ok(!preview.includes('秘密'));assert.ok(preview.includes('synthetic-water'));
  await p.locator('#ai-range').selectOption('custom');await p.locator('#ai-from').fill('2026-10-31');await p.locator('#ai-from').dispatchEvent('change');assert.ok((await p.locator('#ai-share-preview').inputValue()).includes('previous'));
  await p.locator('#ai-sensitive').check();assert.ok((await p.locator('#ai-share-preview').inputValue()).includes('SECRET NOTE'));
  await p.locator('#ai-sensitive').uncheck();
  const download=p.waitForEvent('download');await p.locator('[data-share-action=download]').click();const snap=JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));
  assert.equal(snap.records.length,2);assert.equal(snap.version,7);assert.equal(snap.origin,'local-device');
  await p.evaluate(()=>{window.syntheticShares=[];navigator.canShare=()=>true;navigator.share=async data=>window.syntheticShares.push(await data.files[0].text());});
  await p.locator('[data-share-action=native]').click();await p.waitForFunction(()=>window.syntheticShares.length===1);assert.equal(await p.evaluate(()=>JSON.parse(window.syntheticShares[0]).generatedAt),snap.generatedAt);
  await p.locator('.ai-share-dialog').evaluate(d=>d.scrollTop=0);await p.screenshot({path:`test-results/v06-${theme}-ai-mobile.png`});await p.locator('.ai-share-close').click();
  assert.equal(await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),before);assert.equal(requests.length,0);
  await login(p);assert.equal(rows.size,3);await login(pc);assert.deepEqual(JSON.parse(await pc.evaluate(()=>localStorage.getItem('second-brain-lite-v2'))),seed);
  // Both devices edit while disconnected. Their local editing workflow remains live.
  await phone.setOffline(true);await desktop.setOffline(true);await edit(p,350);await edit(pc,450);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('second-brain-lite-v2')).records.find(r=>r.id==='synthetic-water').volume),350);
  await phone.setOffline(false);await p.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('已同步生活紀錄'));
  await desktop.setOffline(false);await pc.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('筆衝突'));
  assert.equal(rows.get('synthetic-water').record.volume,350);
  const conflict=pc.locator('[data-conflicts] details');await conflict.locator('summary').click();await pc.screenshot({path:`test-results/v06-${theme}-conflict-desktop.png`});
  await conflict.getByRole('button',{name:'保留本機版本'}).click();await pc.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('衝突已處理'));await sync(pc);await sync(p);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('second-brain-lite-v2')).records.find(r=>r.id==='synthetic-water').volume),450);
  fail=true;await p.locator('[data-sync]').click();await p.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('503'));
  const retained=await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2'));fail=false;await sync(p);assert.equal(await p.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),retained);
  await p.locator('.private-sync-dialog').evaluate(d=>d.scrollTop=0);await p.screenshot({path:`test-results/v06-${theme}-sync-mobile.png`});
  expired=true;await p.locator('[data-sync]').click();await p.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('未授權'));expired=false;
  await p.locator('[data-stop]').click();const count=requests.length;assert.equal(await p.locator('[data-sync]').isDisabled(),true);await p.locator('[data-close]').click();await p.reload();assert.equal(requests.length,count);
  assert.ok(!(await p.evaluate(()=>JSON.stringify(localStorage))).includes('synthetic-access'));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await phone.close();await desktop.close();console.log(`PASS v0.6 ${theme}: mobile/desktop isolated storage, date/privacy preview, identical share/download, offline UI edits, reconnect conflicts, retry, auth refusal, stop/reload and no token persistence`);
 }
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
