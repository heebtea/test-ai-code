import { sectionNames } from "./templates.js";

export const JOURNAL_SIZE = Object.freeze({ width:1080, height:1920, left:54, top:292, bottom:1815, contentWidth:972, gap:18 });
export const JOURNAL_FONT_SIZE = 27;
const LINE = 36, PAD = 16, GAP = 14;
const titleGroups = {
  overview:['每日主題'], health:['睡眠','活動','活動時間','日照'],
  'food-meals':['餐點'], 'food-drinks':['咖啡已飲用','飲水','其他飲品已飲用','今日已飲用總量','飲品明細'],
  'food-money':['已付款花費','購買明細','退費明細','回補明細','已確認淨支出'],
  highlight:['今日亮點'], body:['身體狀況','心情'], todo:['待辦事項'],
};
const titles = { ...sectionNames, 'food-meals':'飲食時間線', 'food-drinks':'飲品逐筆紀錄', 'food-money':'完整花費明細', overview:'摘要', health:'睡眠與身體數據', activity:'活動與日照', timeline:'重要事件', todo:'風險與修正', factors:'今晚睡眠相關因素', verdict:'一句總評' };
const familyOf = t => t.font === 'serif' ? 'Georgia, "PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", serif' : '"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';
const font = (ctx,size,family,bold=false) => { ctx.font = `${bold?'bold ':''}${size}px ${family}`; ctx.fontKerning='none'; ctx.direction='ltr'; };

// Use the same font for measurement and painting. Never use fillText(maxWidth),
// which silently compresses glyphs. Graphemes preserve combining marks/emoji.
export function wrapJournalText(ctx, value, width) {
  const segmenter = new Intl.Segmenter('zh-TW', {granularity:'grapheme'});
  return String(value ?? '').split(/\r?\n/).flatMap(paragraph => {
    const lines = []; let line = '';
    const tokens=[];
    for (const {segment} of segmenter.segment(paragraph)) {
      if (/^[A-Za-z0-9_.$%:/~-]+$/.test(segment) && /^[A-Za-z0-9_.$%:/~-]+$/.test(tokens.at(-1) || '')) tokens[tokens.length-1]+=segment;
      else tokens.push(segment);
    }
    for (const token of tokens) {
      if (line && ctx.measureText(line+token).width > width) { lines.push(line); line=''; }
      if (ctx.measureText(token).width <= width) line+=token;
      else for (const {segment} of segmenter.segment(token)) {
        if (line && ctx.measureText(line+segment).width > width) { lines.push(line); line=''; }
        line+=segment;
      }
    }
    lines.push(line);
    return lines;
  });
}
function makeItems(sections, events, template) {
  const keys = template.mapping.flatMap(key => key==='food' ? ['food-drinks','food-meals','food-money'] : key==='health' ? ['health','activity'] : [key]);
  keys.push('factors','verdict');
  const items = [...new Set(keys)].map(key => ({key,title:titles[key] || key,entries:[]}));
  for (const [i,s] of sections.entries()) {
    const key = s.group || Object.keys(titleGroups).find(k=>titleGroups[k].includes(s.title)) || 'overview';
    let item = items.find(item=>item.key===key);
    if (!item) { item={key,title:titles[key] || s.title,entries:[]}; items.push(item); }
    item.entries.push({id:s.id || `section-${i}`,text:s.title ? `${s.title}：${s.value}` : String(s.value)});
  }
  const item = items.find(item=>item.key==='timeline');
  events.forEach((e,i)=>item?.entries.push({id:`timeline-${i}`,text:`${e.time} ${e.label}${e.record.name?' · '+e.record.name:''}${e.record.note?'；'+e.record.note:''}`}));
  return items.filter(item=>item.entries.length);
}

export function planJournalLayout(ctx, sections, events, template) {
  const columns = [1,2,3].includes(template.columns) ? template.columns : 3;
  const width = (JOURNAL_SIZE.contentWidth-JOURNAL_SIZE.gap*(columns-1))/columns;
  const family=familyOf(template), items=makeItems(sections,events,template);
  font(ctx,JOURNAL_FONT_SIZE,family);
  for(const item of items) for(const entry of item.entries) entry.lines=wrapJournalText(ctx,entry.text,width-PAD*2);
  font(ctx,24,family,true);
  for(const item of items) {
    item.heading=wrapJournalText(ctx,item.title,width-PAD*2);
    item.continuedHeading=wrapJournalText(ctx,item.title+'（續）',width-PAD*2);
  }
  // Ordered newspaper flow: down a column, then right, then next page.
  // Each line has a stable entry ID and offset, so pagination can be audited.
  function pack(limit) {
    const pages=[{cards:[]}]; let col=0,y=0;
    const advance=()=>{col++;y=0;if(col===columns){col=0;pages.push({cards:[]});}};
    for(const item of items) {
      let entryIndex=0,lineIndex=0,continued=false;
      while(entryIndex<item.entries.length) {
        const heading=continued?item.continuedHeading:item.heading;
        const header=heading.length*31+18;
        const shortHeight=header+PAD*2+item.entries.reduce((n,e)=>n+e.lines.length*LINE+8,0)-8;
        if(limit-y < header+PAD*2+LINE || (!continued && shortHeight<=header+PAD*2+LINE*5 && shortHeight<=limit && y+shortHeight>limit)) advance();
        const card={key:item.key,title:item.title,heading,continued,x:JOURNAL_SIZE.left+col*(width+JOURNAL_SIZE.gap),y:JOURNAL_SIZE.top+y,width,header,lines:[],height:header+PAD*2};
        while(entryIndex<item.entries.length) {
          const entry=item.entries[entryIndex];
          const entryGap=lineIndex===0 && card.lines.length ? 8 : 0;
          if(y+card.height+LINE+entryGap>limit) break;
          card.height+=entryGap;
          card.lines.push({id:entry.id,index:lineIndex,text:entry.lines[lineIndex],offset:card.height-PAD});
          card.height+=LINE; lineIndex++;
          if(lineIndex===entry.lines.length){entryIndex++;lineIndex=0;}
        }
        pages.at(-1).cards.push(card); y+=card.height+GAP; continued=true;
        if(entryIndex<item.entries.length) advance();
      }
    }
    return pages;
  }
  const maxHeight=JOURNAL_SIZE.bottom-JOURNAL_SIZE.top;
  let pages=pack(maxHeight);
  // Balance available columns without increasing the page count or shrinking text.
  let lo=160,hi=maxHeight;
  for(let i=0;i<12;i++) {
    const mid=Math.floor((lo+hi)/2), candidate=pack(mid);
    if(candidate.length<=pages.length){hi=mid;pages=candidate;}else lo=mid+1;
    if(lo>=hi)break;
  }
  return {pages,items,columns,size:JOURNAL_FONT_SIZE,width,missing:!items.length,shown:events.length,clipped:0,pageCount:pages.length};
}
function readableAccent(hex) {
  const rgb=hex.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));
  return (299*rgb[0]+587*rgb[1]+114*rgb[2])/1000>150?'#152a24':'#ffffff';
}
export function renderJournalPage(canvas, plan, date, template, pageIndex=0) {
  if(!plan.pages[pageIndex]) throw Error('小誌頁碼超出範圍');
  canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d'), family=familyOf(template);
  ctx.fillStyle=template.background;ctx.fillRect(0,0,1080,1920);
  ctx.fillStyle='#245f72';ctx.fillRect(54,48,972,220);
  ctx.fillStyle='#ffffff';font(ctx,40,family,true);ctx.fillText('PROJECT SECOND BRAIN',85,111);
  font(ctx,58,family,true);ctx.fillText(date,85,187);
  font(ctx,26,family);ctx.fillText('DAILY JOURNAL · 完整紀錄',85,235);
  if(plan.missing){ctx.fillStyle='#526d61';font(ctx,31,family);ctx.fillText('今天尚無可整理的數據',75,360);}
  for(const card of plan.pages[pageIndex].cards) {
    const {x,y,width,height,header}=card;
    ctx.fillStyle='#fffefa';ctx.fillRect(x,y,width,height);
    ctx.fillStyle=template.accent;ctx.fillRect(x,y,width,header);
    ctx.fillStyle=readableAccent(template.accent);font(ctx,24,family,true);
    card.heading.forEach((line,i)=>ctx.fillText(line,x+PAD,y+33+i*31));
    ctx.fillStyle='#263d37';font(ctx,JOURNAL_FONT_SIZE,family);
    for(const line of card.lines) ctx.fillText(line.text,x+PAD,y+line.offset+JOURNAL_FONT_SIZE);
  }
  ctx.fillStyle='#33483d';font(ctx,23,family);
  ctx.fillText('依欄由左至右閱讀 · 續欄保留完整原文',54,1871);
  ctx.fillText(`第 ${pageIndex+1} / ${plan.pages.length} 頁`,825,1871);
  return plan;
}
export function renderJournalTemplate(canvas, sections, events, date, template) {
  const plan=planJournalLayout(canvas.getContext('2d'),sections,events,template);
  renderJournalPage(canvas,plan,date,template);
  return plan;
}
