import './style.css';
import { localDate, shiftDate, loadRecords, recordFor, STORAGE_KEY, THEME_KEY } from './data.js';

const app = document.querySelector('#app');
let date = localDate();
let records = loadRecords(localStorage);
let theme = localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let selected = null;
const icons = { sleep: '☾', coffee: '☕', water: '◉', activity: '↗', spending: '▣' };
const names = { sleep: '睡眠', coffee: '咖啡', water: '飲水', activity: '活動', spending: '花費' };
const fields = {
  sleep: [['total', '總睡眠（小時）', 'number', '0.1'], ['deep', '深睡（小時）', 'number', '0.1'], ['rem', 'REM（小時）', 'number', '0.1'], ['score', '睡眠分數（0–100）', 'number', '1']],
  coffee: [['time', '飲用時間', 'time'], ['volume', '容量（ml）', 'number', '1'], ['status', '飲用狀態', 'select']],
  water: [['amount', '今日飲水量（ml）', 'number', '1'], ['goal', '每日目標（ml）', 'number', '1']],
  activity: [['steps', '步數', 'number', '1'], ['minutes', '活動時間（分鐘）', 'number', '1']],
  spending: [['amount', '今日支出（元）', 'number', '1'], ['detail', '支出明細', 'text']],
};
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number(value).toLocaleString('zh-TW');
const formatDate = value => { const [y,m,d] = value.split('-').map(Number); return new Intl.DateTimeFormat('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' }).format(new Date(y,m-1,d)); };

function render() {
  document.documentElement.dataset.theme = theme;
  const data = recordFor(records, date);
  const progress = Math.min(100, Math.round(data.water.amount / data.water.goal * 100)) || 0;
  const isToday = date === localDate();
  app.innerHTML = `
    <div class="shell">
      <header class="topbar"><div class="brand"><span class="brand-mark">✳</span><span>SECOND BRAIN <b>LITE</b></span></div><button class="theme-toggle" id="theme" aria-label="切換深色或淺色模式">${theme === 'dark' ? '☀' : '☾'} <span>${theme === 'dark' ? '淺色模式' : '深色模式'}</span></button></header>
      <main>
        <div class="intro"><div><div class="eyebrow"><span></span> YOUR DAILY OVERVIEW</div><h1>生活，一目了然<span>。</span></h1><p>把每一天的小事，留給更清晰的自己。</p></div><div class="intro-art" aria-hidden="true"><span>✳</span></div></div>
        <div class="notice"><span>✦</span><div><strong>這是一個模擬資料儀表板</strong><br>所有數據皆為虛構範例，並非真實健康紀錄。編輯只儲存於此瀏覽器，不會同步。</div></div>
        <div class="section-heading"><div><div class="eyebrow muted">YOUR DASHBOARD</div><h2>每日總覽 <span>✳</span></h2></div><div class="date-nav"><button id="prev" aria-label="前一天">‹</button><label class="date-label"><span>${isToday ? '今天 · ' : ''}${formatDate(date)}</span><input id="date" type="date" value="${date}" aria-label="選擇日期"></label><button id="next" aria-label="後一天">›</button></div></div>
        <div class="dashboard">
          <button class="card sleep" data-card="sleep"><div class="card-head"><span class="icon">${icons.sleep}</span><span class="card-name">睡眠</span><span class="arrow">↗</span></div><div class="card-caption">昨晚睡了</div><div class="metric">${number(data.sleep.total)} <small>小時</small></div><div class="sleep-chart" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="sleep-stats"><div><span>深睡</span><strong>${number(data.sleep.deep)} 小時</strong></div><div><span>REM</span><strong>${number(data.sleep.rem)} 小時</strong></div><div><span>睡眠分數</span><strong>${number(data.sleep.score)} 分</strong></div></div></button>
          <button class="card coffee" data-card="coffee"><div class="card-head"><span class="icon">${icons.coffee}</span><span class="card-name">咖啡</span><span class="arrow">↗</span></div><div class="card-caption">今天的咖啡時光</div><div class="metric">${escape(data.coffee.time)}</div><div class="card-bottom"><span>${number(data.coffee.volume)} ml</span><span class="pill">${escape(data.coffee.status)}</span></div><div class="coffee-art" aria-hidden="true">☕</div></button>
          <button class="card water" data-card="water"><div class="card-head"><span class="icon">${icons.water}</span><span class="card-name">飲水</span><span class="arrow">↗</span></div><div class="card-caption">今日飲水量</div><div class="metric">${number(data.water.amount)} <small>ml</small></div><div class="progress-label"><span>每日目標 ${number(data.water.goal)} ml</span><strong>${progress}%</strong></div><div class="progress"><i style="width:${progress}%"></i></div><div class="card-note">每一口，都是對自己的照顧。</div></button>
          <button class="card activity" data-card="activity"><div class="card-head"><span class="icon">${icons.activity}</span><span class="card-name">活動</span><span class="arrow">↗</span></div><div class="card-caption">今天走了</div><div class="metric">${number(data.activity.steps)} <small>步</small></div><div class="activity-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="card-bottom"><span>活動時間</span><strong>${number(data.activity.minutes)} 分鐘</strong></div></button>
          <button class="card spending" data-card="spending"><div class="card-head"><span class="icon">${icons.spending}</span><span class="card-name">花費</span><span class="arrow">↗</span></div><div class="card-caption">今日支出</div><div class="metric"><small>NT$</small> ${number(data.spending.amount)}</div><div class="expense"><span>支出明細</span><strong>${escape(data.spending.detail) || '尚無明細'}</strong></div></button>
        </div><div class="footer"><span>✳ &nbsp; 一點一滴，都是生活的記錄。</span><span>點選卡片即可編輯模擬資料 ↗</span></div>
      </main>
    </div><dialog id="editor" aria-labelledby="dialog-title"><form id="edit-form"><div class="dialog-head"><div><span class="eyebrow muted">EDIT SAMPLE DATA</span><h2 id="dialog-title">編輯${selected ? names[selected] : ''}</h2></div><button type="button" id="close" aria-label="關閉">×</button></div><p class="dialog-description">${formatDate(date)} · 模擬資料，僅儲存在此瀏覽器，不會同步</p><div id="form-fields"></div><p class="error" id="error" role="alert"></p><div class="dialog-actions"><button type="button" id="cancel">取消</button><button type="submit" class="save">儲存變更</button></div></form></dialog>`;
  document.querySelector('#prev').onclick = () => { date = shiftDate(date, -1); render(); };
  document.querySelector('#next').onclick = () => { date = shiftDate(date, 1); render(); };
  document.querySelector('#date').onchange = e => { if (e.target.value) { date = e.target.value; render(); } };
  document.querySelector('#theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem(THEME_KEY, theme); render(); };
  document.querySelectorAll('[data-card]').forEach(card => card.onclick = () => openEditor(card.dataset.card));
}
function openEditor(key) {
  selected = key;
  const dialog = document.querySelector('#editor');
  const data = recordFor(records, date)[key];
  document.querySelector('#dialog-title').textContent = `編輯${names[key]}`;
  document.querySelector('#form-fields').innerHTML = fields[key].map(([name, label, type, step]) => `<label>${label}${type === 'select' ? `<select name="${name}">${['已飲用', '未飲用'].map(option => `<option ${data[name] === option ? 'selected' : ''}>${option}</option>`).join('')}</select>` : `<input name="${name}" type="${type}" value="${escape(data[name])}" ${type === 'number' ? `min="${name === 'goal' ? 1 : 0}" step="${step}" ${name === 'score' ? 'max="100"' : ''}` : ''} ${name === 'detail' ? 'maxlength="120"' : 'required'}>`}</label>`).join('');
  document.querySelector('#error').textContent = '';
  document.querySelector('#close').onclick = () => dialog.close();
  document.querySelector('#cancel').onclick = () => dialog.close();
  document.querySelector('#edit-form').onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    for (const [name,, type] of fields[key]) if (type === 'number') values[name] = Number(values[name]);
    if (key === 'sleep' && (values.deep > values.total || values.rem > values.total || values.deep + values.rem > values.total)) { document.querySelector('#error').textContent = '深睡與 REM 的合計不能超過總睡眠時間。'; return; }
    records[date] = { ...recordFor(records, date), [key]: values };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { document.querySelector('#error').textContent = '無法儲存資料，請檢查瀏覽器儲存空間。'; return; }
    dialog.close(); selected = null; render();
  };
  dialog.showModal();
}
render();
