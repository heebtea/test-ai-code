import { createSupabaseSync, validateSyncConfig } from './supabase-sync.js';
import { readSyncState, synchronize, resolveSyncConflict, SYNC_KEY } from './private-sync.js';
import { STORAGE_KEY } from './data.js';

export function createSyncUI({storage,onChange}) {
  let adapter=null, enabled=false, busy=false, generation=0, dialog=null;
  let config=null;
  try {const raw=storage?.getItem('second-brain-sync-public-config');if(raw)config=validateSyncConfig(JSON.parse(raw));} catch { /* Ignore invalid public settings; never auto-connect. */ }
  let status='本機模式 · 尚未連接雲端', timer;
  const update=()=>{
    const badge=document.querySelector('#sync-state'); if(badge) badge.textContent=status;
    if(!dialog?.isConnected) return;
    dialog.querySelector('[data-status]').textContent=status;
    let state;
    try {state=readSyncState(storage);} catch {status='無法讀取同步狀態；請保留原始資料並匯出備份';dialog.querySelector('[data-status]').textContent=status;return;}
    dialog.querySelector('[data-last]').textContent='最後完整同步：'+(state.lastSync ? new Date(state.lastSync).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}) : '尚未完成')+'（Asia/Taipei）';
    dialog.querySelector('[data-conflicts]').replaceChildren();
    for(const c of state.conflicts) {
      const item=document.createElement('details'), summary=document.createElement('summary');summary.textContent='衝突 '+c.id+' · 雲端版本 '+c.remote.revision;
      const pre=document.createElement('pre');pre.textContent=JSON.stringify({本機:c.local,雲端:c.remote},null,2);item.append(summary,pre);
      for(const [choice,label] of [['local','保留本機版本'],['cloud','採用雲端版本']]) {
        const b=document.createElement('button');b.textContent=label;b.disabled=busy||!enabled;
        b.onclick=()=>run(async active=>{await resolveSyncConflict({storage,adapter,id:c.id,choice,active});onChange();status='衝突已處理，請再同步以核對完整狀態';});item.append(b);
      }
      dialog.querySelector('[data-conflicts]').append(item);
    }
    dialog.querySelectorAll('[data-auth-action]').forEach(b=>b.disabled=busy||!enabled);
    dialog.querySelector('[data-login]').disabled=busy||enabled;
    dialog.querySelector('[data-send]').disabled=busy||enabled;
    dialog.querySelector('[data-settings]').open=!enabled;
  };
  async function run(task) {
    if(busy) return;
    busy=true;const g=generation;update();
    try {await task(()=>enabled && g===generation);}
    catch(e) {status=e.message;}
    finally {busy=false;update();}
  }
  async function sync() {
    if(!enabled || !adapter?.authorized) {if(enabled) status='授權已到期：停止雲端傳輸，請停止同步後重新登入';update();return;}
    if(!navigator.onLine) {status='離線：本機繼續保存，頁面恢復連線後重試';update();return;}
    await run(async active=>{
      status='同步中：本機紀錄與雲端逐筆核對';update();
      const state=await synchronize({storage,adapter,active});
      status=state.conflicts.length ? '有 '+state.conflicts.length+' 筆衝突：保留雙方版本，請逐筆選擇' : '已同步生活紀錄 · 照片／模板仍僅本機；ChatGPT 尚未連接';
      onChange();
    });
  }
  function changed(){
    if(!enabled) return;
    status='本機有變更 · 等待同步';update();clearTimeout(timer);timer=setTimeout(sync,1200);
  }
  window.addEventListener('online',()=>{if(enabled)sync();});
  window.addEventListener('offline',()=>{if(enabled){status='離線：本機繼續保存，頁面恢復連線後重試';update();}});
  window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY)changed();});
  function open() {
    if(dialog?.isConnected) return;
    dialog=document.createElement('dialog');dialog.className='private-sync-dialog';
    dialog.innerHTML=`<h2>私人同步（需自行設定）</h2>
      <p data-status role="status"></p><p data-last></p>
      <p>預設只有本機紀錄。授權後會同步全部結構化生活紀錄（包含私人日誌及 OCR 草稿），照片、模板、設定不會上傳；請另存完整備份。AI 分享仍須另行選取，ChatGPT 尚未連線。</p>
      <p>重新載入頁面後需重新登入；Token 僅留在記憶體。離線時已開啟的頁面可繼續記錄，關閉頁面後不會背景同步。</p>
      <details data-settings open><summary>雲端登入設定</summary><label>Supabase 專案網址<input name="sync-url" type="url" placeholder="https://your-project.supabase.co" autocomplete="off"></label>
      <label>Publishable 公開金鑰<input name="sync-key" placeholder="sb_publishable_…" autocomplete="off"></label>
      <label>已建立的登入帳戶 Email<input name="sync-email" type="email" autocomplete="email"></label>
      <label><input name="sync-remember" type="checkbox"> 記住此裝置的公開設定（不保存 Email、驗證碼或 Token）</label><button data-send>寄送登入驗證碼</button>
      <label>信件驗證碼<input name="sync-otp" inputmode="numeric" autocomplete="one-time-code"></label>
      <label><input name="sync-consent" type="checkbox"> 我已備份，並同意將全部結構化紀錄同步至上述私人專案</label>
      <button data-login>驗證並啟用同步</button></details>
      <button data-auth-action data-sync>立即同步／重試</button>
      <button data-stop>停止同步（保留本機資料）</button><button data-revoke>登出並撤銷登入工作階段</button>
      <p>登出無法立即使已簽發的 JWT 失效；若需立即阻擋，請在 Supabase 移除允許帳戶。已送出的請求可能已在雲端完成。停止同步後不再套用回傳資料。</p>
      <button data-export>匯出同步狀態與紀錄（私密）</button>
      <div data-conflicts></div><button data-close>關閉</button>`;
    document.body.append(dialog);
    const input=name=>dialog.querySelector('[name="'+name+'"]');
    if(config) {input('sync-url').value=config.url;input('sync-key').value=config.key;}
    input('sync-consent').checked=enabled;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{dialog.remove();dialog=null;});
    dialog.querySelector('[data-send]').onclick=()=>run(async()=>{
      if(enabled) throw Error('請先停止同步再切換登入設定');
      if(!input('sync-consent').checked) throw Error('請先確認私人同步授權');
      if(!input('sync-email').validity.valid || !input('sync-email').value) throw Error('請填有效 Email');
      config=validateSyncConfig({url:input('sync-url').value,key:input('sync-key').value});
      if(input('sync-remember').checked) storage.setItem('second-brain-sync-public-config',JSON.stringify(config));
      else storage.removeItem('second-brain-sync-public-config');
      adapter=createSupabaseSync(config);
      await adapter.sendCode(input('sync-email').value);status='驗證碼已要求寄送；需先在自己的專案建立允許帳戶，並將郵件模板設為驗證碼';
    });
    dialog.querySelector('[data-login]').onclick=async()=>{
      await run(async()=>{
        if(!adapter || !input('sync-consent').checked) throw Error('請先勾選授權並寄送驗證碼');
        await adapter.verifyCode(input('sync-email').value,input('sync-otp').value);
        input('sync-otp').value='';enabled=true;status='已登入；即將同步';
      });
      if(enabled) await sync();
    };
    dialog.querySelector('[data-sync]').onclick=sync;
    dialog.querySelector('[data-stop]').onclick=()=>{generation++;enabled=false;adapter?.stop();clearTimeout(timer);status='本機模式 · 已停止同步，雲端副本仍保留';update();};
    dialog.querySelector('[data-revoke]').onclick=async()=>{
      generation++;enabled=false;clearTimeout(timer);
      try {await adapter?.revoke();status='已登出；即時撤權請移除雲端允許帳戶，現有 JWT 到期前仍可能有效';}
      catch {status='已停止本機同步；遠端撤銷未確認，請至 Supabase 移除允許帳戶';}
      update();
    };
    dialog.querySelector('[data-export]').onclick=()=>{
      const blob=new Blob([JSON.stringify({format:'second-brain-sync-recovery',version:1,records:JSON.parse(storage.getItem(STORAGE_KEY)||'null'),sync:JSON.parse(storage.getItem(SYNC_KEY)||'null')},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='second-brain-private-sync-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    update();dialog.showModal();
  }
  return {open,changed,update};
}
