const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {buildSync}=require('esbuild');
const auditScript=buildSync({stdin:{contents:"export {journalDocumentSections} from './src/journal-document.js'; export {planJournalLayout,renderJournalPage} from './src/journal-layout.js'; export {baseTemplate} from './src/templates.js';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'JournalAudit'}).outputFiles[0].text;
const url='http://127.0.0.1:4197/test-ai-code/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4197','--strictPort'],{stdio:'ignore'});
(async()=>{
  let browser;
  try {
    for(let i=0;i<60;i++){if(await fetch(url).then(r=>r.ok,()=>false))break;await new Promise(r=>setTimeout(r,100));}
    const {journalFixture,day}=await import('./fixtures/journal-flow.js');
    const data=journalFixture();
    const output=process.env.SCREENSHOT_DIR || 'test-results/journal-flow';fs.mkdirSync(output,{recursive:true});
    browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:process.env.CI?{}:{channel:'chrome'}),headless:true});
    for(const width of [390,430]) {
      const context=await browser.newContext({viewport:{width,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:1,acceptDownloads:true});
      const page=await context.newPage(),errors=[],outbound=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();outbound.push(route.request().url());return route.abort();});
      await page.route('**/__journal-audit.js',route=>route.fulfill({contentType:'text/javascript',body:auditScript}));
      await page.goto(url);
      await page.locator('#import').setInputFiles({name:'synthetic-journal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      await page.locator('#yes').click();
      await page.locator('#confirm').waitFor({state:'hidden'});
      await page.locator('#date').fill(day);await page.locator('#date').dispatchEvent('change');
      const saved=await page.evaluate(()=>localStorage.getItem('second-brain-lite-v2'));
      assert.deepEqual(JSON.parse(saved).records,data.records);
      // Repeat import must not create duplicate records.
      await page.locator('#import').setInputFiles({name:'synthetic-journal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      await page.locator('#yes').click();await page.locator('#confirm').waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),saved);
      await page.evaluate(()=>{window.journalDraws=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){window.journalDraws.push({page:Number(this.canvas.dataset.page || 0),text,x,y,width:this.measureText(text).width,compressed:rest.length>0});return original.call(this,text,x,y,...rest);};});
      await page.locator('#journal').tap();
      await page.locator('#journal-download').waitFor();
      const count=await page.locator('.journal-page').count();assert.ok(count>1);
      assert.ok(await page.locator('.journal-page-canvas').first().evaluate(c=>c.getBoundingClientRect().width < innerWidth));
      await page.locator('#journal-dialog h2').click();
      await page.screenshot({path:path.join(output,`after-${width}.png`)});
      for(let i=0;i<count;i++) {
        const download=page.waitForEvent('download');
        await page.locator('.journal-page-download').nth(i).tap();
        const file=await download, buffer=fs.readFileSync(await file.path());
        assert.equal(buffer.readUInt32BE(16),1080);assert.equal(buffer.readUInt32BE(20),1920);
        assert.match(file.suggestedFilename(),new RegExp(`p${String(i+1).padStart(2,'0')}-of-${count}`));
        if(width===390)fs.writeFileSync(path.join(output,`multi-page-${i+1}.png`),buffer);
      }
      await page.locator('#journal-zoom').tap();
      assert.equal(await page.locator('#journal-zoom').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.journal-page-canvas').first().evaluate(c=>c.getBoundingClientRect().width),1080);
      await page.locator('.journal-page').first().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`zoom-${width}.png`)});
      await page.locator('#journal-zoom').tap();
      await page.locator('.journal-page-text summary').first().tap();
      assert.ok((await page.locator('.journal-page-text').first().innerText()).includes('摘要'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.evaluate(()=>localStorage.getItem('second-brain-lite-v2')),saved);
      const actualDraws=await page.evaluate(()=>window.journalDraws);
      await page.locator('#journal-close').tap();
      // Actual canvas draw-call audit, using real browser fonts and measurement.
      await page.addScriptTag({url:url+'__journal-audit.js'});
      const audit=await page.evaluate(async({data,day})=>{
        const {journalDocumentSections,planJournalLayout,renderJournalPage,baseTemplate}=window.JournalAudit;
        const result=[];
        for(const columns of [1,2,3]) {
          const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),t={...baseTemplate(),columns};
          const plan=planJournalLayout(ctx,journalDocumentSections(data,day),[],t);
          const calls=[],original=ctx.fillText.bind(ctx);let drawingPage=0;
          ctx.fillText=(...args)=>{calls.push({page:drawingPage,args,width:ctx.measureText(args[0]).width});original(...args);};
          for(let i=0;i<plan.pageCount;i++){drawingPage=i;renderJournalPage(canvas,plan,day,t,i);}
          const lines=plan.pages.flatMap(p=>p.cards.flatMap(c=>c.lines));
          const expected=plan.items.flatMap(item=>item.entries.flatMap(e=>e.lines.map((text,index)=>({id:e.id,index,text}))));
          const actual=lines.map(({id,index,text})=>({id,index,text}));
          const transactions=[...new Set(lines.filter(l=>l.id.startsWith('transaction:')).map(l=>l.id))];
          const coverage=JSON.stringify(actual)===JSON.stringify(expected);
          const inBounds=plan.pages.every(p=>p.cards.every(c=>c.y+c.height<=1815&&c.lines.every(l=>{ctx.font='27px "Noto Sans CJK TC", sans-serif';return ctx.measureText(l.text).width<=c.width-32+.01;})));
          result.push({columns,calls,pages:plan.pageCount,coverage,inBounds,transactions,compressed:calls.some(c=>c.args.length>3),texts:calls.map(c=>c.args[0]).join('')});
        }
        return result;
      },{data,day});
      for(const a of audit){assert.ok(a.coverage);assert.ok(a.inBounds);assert.equal(a.transactions.length,11);assert.equal(a.compressed,false);assert.ok(a.texts.includes('638 NT$'));assert.ok(a.texts.includes('08:30～09:25'));assert.ok(a.texts.includes('飲用中'));}
      const expectedDraws=audit.find(a=>a.columns===3).calls.map(c=>({page:c.page,text:c.args[0],x:c.args[1],y:c.args[2]}));
      assert.deepEqual(actualDraws.map(({page,text,x,y})=>({page,text,x,y})),expectedDraws);
      assert.ok(actualDraws.every(c=>!c.compressed && c.x+c.width<=1026 && c.y<1920));
      fs.writeFileSync(path.join(output,`audit-${width}.json`),JSON.stringify(audit.map(a=>({columns:a.columns,pages:a.pages,coverage:a.coverage,inBounds:a.inBounds,transactions:a.transactions,compressed:a.compressed,actualDrawCoverage:true})),null,2));
      // Sparse day stays one page; exercise real template selection for 1/2/3 columns.
      const sparse={version:8,records:[data.records.find(r=>r.type==='sleep')]};
      await page.evaluate(d=>localStorage.setItem('second-brain-lite-v2',JSON.stringify(d)),sparse);await page.reload();
      await page.locator('#date').fill(day);await page.locator('#date').dispatchEvent('change');
      for(const columns of [1,2,3]) {
        await page.locator('#template-new').tap();
        await page.locator('[name=name]').fill(`合成${columns}欄`);
        await page.locator('[name=columns]').selectOption(String(columns));
        await page.locator('#template-form button[type=submit]').tap();
        await page.locator('#template-editor').waitFor({state:'hidden'});
        await page.locator('#journal').tap();await page.locator('#journal-download').waitFor();
        if(columns===3)assert.equal(await page.locator('.journal-page').count(),1);
        const dl=page.waitForEvent('download');await page.locator('#journal-download').tap();
        const image=fs.readFileSync(await (await dl).path());
        if(width===390)fs.writeFileSync(path.join(output,`single-${columns}-column.png`),image);
        await page.locator('#journal-close').tap();
      }
      assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
      console.log(`PASS journal ${width}px Chromium touch: ${count} pages, 11 transactions/638, all page downloads, zoom, 1/2/3 columns, real-font line/draw audit, JSON repeat import, no mutation/outbound/errors`);
      await context.close();
    }
    console.log(`Chromium ${browser.version()}; NOT physical iPhone Safari`);
  } finally {await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
