/* ---------- habits: nothing personal ships in this public code.
   Her habits, lists, quests and history live in the Sheet and only reach a device
   unlocked with her passcode. Everyone else gets the demo below, kept under its own
   key and never sent anywhere. */
const HABITS = [];
const DEMO=!(window.Sync&&Sync.unlocked);
const DEMO_DATA=()=>{
  const h=(id,name,icon,section,weekly)=>({id:'d_'+id,name,icon,section,...(weekly?{weekly}:{})});
  const L=(id,cat,name,shade)=>({id:'dl_'+id,cat,name,shade});
  const T=(list,text)=>({id:'dt_'+Math.random().toString(36).slice(2,8),list:'dl_'+list,text,done:false,doneAt:null});
  return {
    baseHabits:[
      h('wake','Up by 7 am','🌅','w2w'), h('stretch','Morning stretch','🧘','w2w'), h('water','Glass of water','💧','w2w'),
      h('breakfast','Breakfast','🍳','w2w'), h('walk','Walk outside','🚶','meat'), h('lunch','Lunch away from the desk','🥗','meat'),
      h('inbox','Clear the inbox','📥','meat'), h('workout','Workout','🏋️','meat',3), h('dinner','Dinner','🍽️','wind'),
      h('evestretch','Evening stretch','🤸','wind'), h('read','Read 10 pages','📖','wind'), h('call','Call a friend','📞','wind',2),
      h('bed','In bed by 11 pm','🌙','wind'),
    ],
    prio:[
      {group:'Move',id:'d_stretch',label:'Morning',due:9,dueTxt:'by 9 am',cls:'am',icon:'body'},
      {group:'Move',id:'d_evestretch',label:'Evening',due:21,dueTxt:'by 9 pm',cls:'pm',icon:'body'},
      {group:'Sleep',id:'d_bed',label:'In bed',due:23,dueTxt:'by 11 pm',cls:'am',icon:'moon'},
    ],
    lists:[L('work','work','Work',0),L('side','side','Side project',0),L('read','esc','Reading list',0),L('home','home','Home',0)],
    tasks:[T('work','Reply to the team thread'),T('work','Plan next week'),T('side','Sketch the landing page'),T('side','Pick a name'),
      T('read','Finish the novel on the nightstand'),T('home','Groceries'),T('home','Water the plants'),T('home','Book a haircut')],
  };
};

/* ---------- quest colour families: the category lives in the colour ---------- */
const SHADES = {
  work:['#4A2E27','#6B4436','#8C5E4B','#A87C66','#5A3A30'],   // potting soil
  side:['#3D5B80','#5E7C9F','#7E98B8','#4B6A8F'],             // deep cerulean
  esc: ['#4D0E12','#6E1A20','#8F2E34','#B04E54'],             // sceptre
  home:['#F5EFC6','#E6DBA2','#D6C985'],                       // transparent yellow
};
const ORDER=['work','side','esc','home'];
const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const lum=rgb=>{const c=rgb.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const onColor=bg=>{const L=lum(hx(bg)), y=(lum(hx('#F5EFC6'))+.05)/(L+.05), j=(L+.05)/(lum(hx('#231815'))+.05); return y>=j?'#F5EFC6':'#231815';};

/* ---------- storage + migration ---------- */
const KEY=DEMO?'tension-demo-v1':'tension-dashboard-v1';
const uid=()=>Math.random().toString(36).slice(2,9);
let S; try{ S=JSON.parse(localStorage.getItem(KEY)) }catch(e){ S=null }
if(!S||typeof S!=='object') S=DEMO?DEMO_DATA():{};
S.checks ||= {}; S.tasks ||= []; S.pomo ||= {};
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
S.start ||= ymd(new Date());
if(!S.lists){
  const fromCats = (S.cats||[]).filter(c=>c.id!=='be');
  S.lists=[];
  fromCats.forEach(c=>c.projects.forEach(p=>S.lists.push({id:uid(),cat:c.id,name:p})));
  S.tasks=S.tasks.filter(t=>t.cat!=='be').map(t=>{
    const l=S.lists.find(l=>l.cat===t.cat&&l.name===t.proj);
    return l?{id:t.id,list:l.id,text:t.text,done:!!t.done,doneAt:t.done?Date.now():null}:null;
  }).filter(Boolean);
  delete S.cats;
}
if(!S.lists.some(l=>l.cat==='home')) S.lists.push({id:uid(),cat:'home',name:'Home'});
// finished quests clear at the start of each month
const NOW=new Date();
S.tasks=S.tasks.filter(t=>{ if(!t.done) return true; const d=new Date(t.doneAt); return d.getFullYear()===NOW.getFullYear()&&d.getMonth()===NOW.getMonth(); });
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(S)) }catch(e){} window.Sync&&Sync.changed(); }
save();

S.lists.forEach(l=>{ if(l.shade==null){ l.shade=S.lists.filter(x=>x.cat===l.cat).indexOf(l); } }); save();
function nextShade(cat){ const used=S.lists.filter(l=>l.cat===cat).map(l=>l.shade), n=(SHADES[cat]||SHADES.work).length; for(let i=0;i<n;i++) if(!used.includes(i)) return i; return used.length; }
function shadeOf(list){
  const fam=SHADES[list.cat]||SHADES.work;
  const bg=fam[(list.shade||0)%fam.length]; return {bg,on:onColor(bg)};
}

/* ---------- dates & habit logic ---------- */
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const monday=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());return addDays(x,-((x.getDay()+6)%7))};
const isWeekend=d=>d.getDay()===0||d.getDay()===6;
const TODAY=new Date(), TK=ymd(TODAY), DAYNUM=Math.floor(TODAY.getTime()/864e5);
const applies=(h,d)=>!(h.weekdays&&isWeekend(d));
const isDone=(id,k)=>!!(S.checks[k]&&S.checks[k][id]);
function setDone(id,k,v){ S.checks[k] ||= {}; if(v){ if(!S.checks[k][id]) S.checks[k][id]=Date.now(); } else delete S.checks[k][id]; save(); }
const habitDone=(h,k)=>isDone(h.id,k);
function weekCount(h,ref,upto,incl=true){
  const m=monday(ref); let c=0;
  for(let i=0;i<7;i++){ const k=ymd(addDays(m,i)); if(k>upto||(!incl&&k===upto)) break; if(isDone(h.id,k)) c++; }
  return c;
}
function dayScore(d){
  const k=ymd(d); let tot=0,done=0;
  HABITS.forEach(h=>{ if(h.weekly||!applies(h,d)) return; tot++; if(isDone(h.id,k)) done++; });
  return {tot,done,pct:tot?done/tot:0};
}

/* ---------- tabs ---------- */
const TABS=[
  {id:'today',label:'Today',icon:'<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'},
  {id:'habits',label:'Habits',icon:'<path d="M4 11.5 12 5l8 6.5V20H4z"/>'},
  {id:'quests',label:'Quests',icon:'<path d="M5 20V4M5 4h11l-2 4 2 4H5"/>'},
  {id:'gallery',label:'Gallery',icon:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'},
  {id:'focus',label:'Focus',icon:'<circle cx="12" cy="13" r="7"/><path d="M12 13V9M10 3h4"/>'},
];
let current='today', habitView='today', questView='open';
function renderTabs(){
  const mk=ic=>TABS.map(t=>`<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id===current}">${ic?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>`:''}${t.label}</button>`).join('');
  tabsTop.innerHTML=mk(false); tabsBottom.innerHTML=mk(true);
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-tab]'); if(!b) return; current=b.dataset.tab; show(); window.scrollTo({top:0});});
function show(){
  renderTabs();
  TABS.forEach(t=>document.getElementById('v-'+t.id).hidden=t.id!==current);
  if(current!=='gallery') stopGallery();
  ({today:renderTodayPage,habits:renderHabits,quests:renderQuests,gallery:startGallery,focus:renderFocus})[current]();
}

/* ---------- clock ---------- */
function tickClock(){
  const d=new Date(); let h=d.getHours(); const ap=h<12?'am':'pm'; h=h%12||12;
  tdClock.innerHTML=`${h}:${pad(d.getMinutes())}<small>${ap}</small>`;
  tdDate.textContent=d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  if(typeof renderPrio==='function'&&window.prio&&current==='today') try{renderPrio()}catch(_){}
  if(ymd(d)!==TK) location.reload();   // a new day: picks and parks reset, habits start fresh
}
tickClock(); setInterval(tickClock,15000);

/* ---------- images ---------- */
const pick=(arr,seed,n)=>{ const out=[]; for(let i=0;i<n;i++) out.push(arr[(seed*7+i*13)%arr.length]); return out; };
const qi=DAYNUM%ASSETS.quotes.length;
function wireQuote(el,offset){
  const img=el.querySelector('img'); let i=(qi+offset)%ASSETS.quotes.length;
  const set=()=>img.src=ASSETS.quotes[i]; const next=()=>{i=(i+1)%ASSETS.quotes.length;set()};
  el.addEventListener('click',next); el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();next()}});
  set(); return next;
}
const nextFocusQuote=wireQuote(focusQuote,5);
arches.innerHTML=pick(ASSETS.photos,DAYNUM,6).map(s=>`<img src="${s}" alt="">`).join('');
frost.style.setProperty('--frost-img',`url(${ASSETS.photos[(DAYNUM*5+11)%ASSETS.photos.length]})`);
/* rotating title */
const MOTTOS=['Seize the day','Baby steps','Devotion demands discipline'];
// 6 am–12 pm, 12–6 pm, 6 pm–6 am
function motto(){ const h=new Date().getHours(); return h>=6&&h<12?MOTTOS[0]:h>=12&&h<18?MOTTOS[1]:MOTTOS[2]; }
function setMotto(){ const m=motto(); if(rotTitle.textContent===m) return;
  if(!rotTitle.textContent||matchMedia('(prefers-reduced-motion: reduce)').matches){ rotTitle.textContent=m; return; }
  rotTitle.classList.add('out'); setTimeout(()=>{ rotTitle.textContent=m; rotTitle.classList.remove('out'); },600); }
setMotto(); setInterval(setMotto,30000);
photoPair.innerHTML=pick(ASSETS.photos,DAYNUM+3,4).map(s=>`<img src="${s}" alt="" loading="lazy">`).join('');

/* ---------- HABITS ---------- */
const CHECK='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>';
const GRIP='<i></i><i></i><i></i><i></i><i></i><i></i>';
const SECS=[
  {id:'w2w', name:'Wake to work',    from:4,  to:11},
  {id:'meat',name:'Meat of the day', from:11, to:19},
  {id:'wind',name:'Wind down',       from:19, to:28},
];
S.baseHabits ||= []; S.customHabits ||= [];
const HMAP={};
function loadHabits(){
  HABITS.length=0; for(const k in HMAP) delete HMAP[k];
  [...S.baseHabits,...S.customHabits].forEach(h=>{ if(!HMAP[h.id]){ HABITS.push(h); HMAP[h.id]=h; } });
}
loadHabits();
function initOrder(){
  // ids whose habit hasn't arrived from the Sheet yet keep their place, so her layout survives
  S.habitOrder ||= []; S.habitSec ||= {};
  HABITS.forEach((h,i)=>{
    if(!S.habitOrder.includes(h.id)){ const prev=HABITS.slice(0,i).reverse().find(p=>S.habitOrder.includes(p.id)); S.habitOrder.splice(prev?S.habitOrder.indexOf(prev.id)+1:0,0,h.id); }
    if(!S.habitSec[h.id]) S.habitSec[h.id]= h.section||'w2w';
  });
  save();
}
initOrder();
const habitsInOrder=()=>SECS.flatMap(s=>S.habitOrder.filter(id=>HMAP[id]&&S.habitSec[id]===s.id).map(id=>HMAP[id]));
function currentSec(){ let h=new Date().getHours(); if(h<4) h+=24; return (SECS.find(s=>h>=s.from&&h<s.to)||SECS[0]).id; }
const isBonus=h=>h.weekly&&weekCount(h,TODAY,TK,false)>=h.weekly;
S.missed ||= {};
function isMissed(h){ return !!(h&&!isDone(h.id,TK)&&S.missed[TK]&&S.missed[TK][h.id]); }
function setMissed(id,v){ S.missed[TK] ||= {}; if(v) S.missed[TK][id]=true; else delete S.missed[TK][id]; save(); }
const fmtTime=t=>{ const [a,b]=t.split(':').map(Number); return `${a%12||12}${b?':'+String(b).padStart(2,'0'):''} ${a<12?'am':'pm'}`; };
const MISSED_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l2.5 2"/><path d="M5 19 19 5"/></svg>';
function missedInSec(sec){ return habitsInOrder().filter(h=>(sec==='all'||S.habitSec[h.id]===sec)&&applies(h,TODAY)&&isMissed(h)); }
function missedFold(sec){ const ms=missedInSec(sec); if(!ms.length) return '';
  return `<details class="missed"><summary>${MISSED_ICON}Missed today (${ms.length})</summary>${ms.map(h=>`<div class="mrow"><span class="micon">${MISSED_ICON}</span><span class="mname">${esc(h.name)}</span><button class="unpark" data-unmiss="${h.id}">Put back</button><button class="unpark" data-didit="${h.id}">I did it</button></div>`).join('')}</details>`; }
function openInSec(sec){ const hs=habitsInOrder().filter(h=>S.habitSec[h.id]===sec&&applies(h,TODAY)&&!isDone(h.id,TK)&&!isMissed(h)); return [...hs.filter(h=>!isBonus(h)),...hs.filter(isBonus)]; }

function renderHabits(){ renderCollection(); renderWeek(); renderRings(); }
let justCollected=null;
function row(h,{grip=true}={}){
  const bonus=isBonus(h); let meta='';
  if(h.weekly){ const c=weekCount(h,TODAY,TK); meta=bonus?'goal hit, this one’s a bonus':`${c} of ${h.weekly} this week`; }
  return `<label class="habit ${bonus?'bonus':''}" data-hid="${h.id}">${grip?`<span class="hgrip" title="Drag to reorder" aria-hidden="true">${GRIP}</span>`:''}<input type="checkbox" data-habit="${h.id}"><span class="box">${CHECK}</span><span class="hname">${esc(h.name)}</span>${meta?`<span class="hmeta">${meta}</span>`:''}<button class="hmiss" data-miss="${h.id}" title="Mark as missed today" aria-label="Mark ${esc(h.name)} as missed today">${MISSED_ICON}</button>${h.custom?`<button class="hdel" data-hdel="${h.id}" aria-label="Remove ${esc(h.name)}">×</button>`:''}</label>`;
}
const MOBILE=matchMedia('(max-width:720px)');
const day=tdHabits;
function fitDay(){
  const rows=[...day.querySelectorAll('.habit:not(.leaving)')];
  day.style.maxHeight='';
  if(!MOBILE.matches||rows.length<=5){ day.classList.remove('scrolls','more'); scrollHint.classList.remove('on'); return; }
  const top=day.getBoundingClientRect().top, cut=rows[4].getBoundingClientRect().bottom;
  day.style.maxHeight=Math.ceil(cut-top+18)+'px';
  day.classList.add('scrolls');
  scrollHint.textContent=`${rows.length-5} more below, scroll the list`;
  scrollHint.classList.add('on'); onDayScroll();
}
function onDayScroll(){ const atEnd=day.scrollTop+day.clientHeight>=day.scrollHeight-4; day.classList.toggle('more',!atEnd); scrollHint.classList.toggle('on',!atEnd&&day.classList.contains('scrolls')); }
day.addEventListener('scroll',onDayScroll,{passive:true});
MOBILE.addEventListener?MOBILE.addEventListener('change',()=>{ if(current==='today') fitDay(); }):0;
function renderCollection(){
  const c=S.checks[TK]||{};
  const got=HABITS.filter(h=>applies(h,TODAY)&&isDone(h.id,TK)).map(h=>({h,at:c[h.id]})).sort((a,b)=>a.at-b.at);
  collection.innerHTML = got.length ? got.map(({h})=>`<button class="gem ${h.id===justCollected?'new':''}" data-undo="${h.id}" title="${h.name}" aria-label="${h.name}, tap to put back">${h.icon}</button>`).join('')
    : '<p class="coll-empty">Check something off and it lands here.</p>';
  collFoot.textContent = got.length ? `${got.length} collected today` : '';
  justCollected=null;
}
function updateTension(){
  const s=dayScore(TODAY), p=Math.round(s.pct*100);
  tFill.style.width=p+'%'; tKnot.style.left=p+'%';
  tGap.hidden=p>=100; tGap.style.left=p+'%'; tGap.classList.toggle('tight',p>70);
  tGapLbl.textContent=`${100-p}%`;
  renderPrio();
  tRead.innerHTML=`<b>${s.done} of ${s.tot}</b> habits done. ${p===100?'Nothing left between you.':p>=60?'Closing the distance.':'The day is still wide open.'}`;
}
/* priority badges: tap to fill, pulse when late, a week of dots under each.
   Which habits, labels and due times come from the Sheet (S.prio); only the icons live here. */
const PRIO_ICONS={
  body:'<path d="M12 5.5a1.6 1.6 0 1 0 0-.1M6 10.5c2 .9 4 1.3 6 1.3s4-.4 6-1.3M12 11.8v3.7M12 15.5l-3 4.5M12 15.5l3 4.5"/>',
  moon:'<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z"/>',
};
function renderPrio(){
  const list=(Array.isArray(S.prio)?S.prio:[]).filter(p=>HMAP[p.id]);
  prio.style.display=list.length?'':'none';
  const hr=new Date().getHours(), m=monday(TODAY), days=[...Array(7)].map((_,i)=>addDays(m,i));
  const badge=p=>{ const done=isDone(p.id,TK), missed=isMissed(HMAP[p.id]), late=!done&&!missed&&hr>=p.due;
    return `<button class="pbadge ${p.cls==='pm'?'pm':'am'} ${done?'done':''} ${late?'late':''} ${missed?'missedb':''}" data-prio="${esc(p.id)}" aria-pressed="${done}" aria-label="${esc(p.group)}, ${esc(p.label.toLowerCase())} ${esc(p.dueTxt)}${done?', done':missed?', missed':late?', overdue':''}">
      <span class="pring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PRIO_ICONS[p.icon]||PRIO_ICONS.body}</svg></span>
      <span class="plabel">${esc(p.label)}<small>${missed?'missed':late?'overdue':esc(p.dueTxt)}</small></span>
      <span class="pdots">${days.map(d=>{const k=ymd(d);return `<i class="${isDone(p.id,k)?'on':''} ${k===TK?'today':''} ${k>TK?'future':''}"></i>`}).join('')}</span>
    </button>`; };
  const groups=[...new Set(list.map(p=>p.group))];
  prio.innerHTML=groups.map(g=>`<div class="pgroup"><h3>${esc(g)}</h3><div class="pbadges">${list.filter(p=>p.group===g).map(badge).join('')}</div></div>`).join('');
}
prio.addEventListener('click',e=>{
  const b=e.target.closest('[data-prio]'); if(!b) return; const id=b.dataset.prio, on=!isDone(id,TK);
  setDone(id,TK,on); if(on) justCollected=id;
  renderTodaySection(); updateTension();
});
function renderRings(){
  rings.innerHTML=HABITS.filter(h=>h.weekly).map(h=>{
    const c=weekCount(h,TODAY,TK), r=27, C=2*Math.PI*r, f=Math.min(c/h.weekly,1), hit=c>=h.weekly;
    return `<div class="ring"><svg viewBox="0 0 66 66"><circle cx="33" cy="33" r="${r}" fill="none" stroke="#DCE5EF" stroke-width="6"/>${f?`<circle cx="33" cy="33" r="${r}" fill="none" stroke="${hit?'#4D0E12':'#5E7C9F'}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C*f} ${C}" transform="rotate(-90 33 33)"/>`:''}</svg><div class="rv">${c}/${h.weekly}${c>h.weekly?` <b>+${c-h.weekly}</b>`:''}</div><div class="rl">${h.name}</div></div>`;
  }).join('');
}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
function checkHabit(input,after){
  const id=input.dataset.habit; if(!id) return; setDone(id,TK,true); justCollected=id;
  const el=input.closest('.habit'); if(reduce){after();return;} el.classList.add('leaving'); setTimeout(after,320);
}
day.addEventListener('click',e=>{ if(e.target.closest('.hgrip')) e.preventDefault(); },true);
day.addEventListener('change',e=>checkHabit(e.target,()=>{renderTodaySection();updateTension();}));
collection.addEventListener('click',e=>{const b=e.target.closest('[data-undo]'); if(!b) return; setDone(b.dataset.undo,TK,false); renderCollection(); renderRings();});

/* drag a habit by its grip: up, down, or into another section */
(function habitSort(){
  let st=null;
  day.addEventListener('pointerdown',e=>{
    const g=e.target.closest('.hgrip'); if(!g||e.button>0) return;
    e.preventDefault(); st={el:g.closest('.habit'),id:e.pointerId,sx:e.clientX,sy:e.clientY,y:e.clientY,on:false};
  });
  function place(){ const el=st.el; el.style.transform='none'; const r=el.getBoundingClientRect(); el.style.transform=`translate(0px,${st.y-st.gy-r.top}px)`; }
  addEventListener('pointermove',e=>{
    if(!st||e.pointerId!==st.id) return; st.y=e.clientY;
    if(!st.on){ if(Math.abs(st.y-st.sy)<4) return; st.on=true; const r=st.el.getBoundingClientRect(); st.gy=st.sy-r.top; st.el.classList.add('hdragging'); document.body.classList.add('drag-active'); try{navigator.vibrate&&navigator.vibrate(10)}catch(_){} }
    e.preventDefault();
    const kids=[...day.children].filter(n=>n!==st.el&&(n.classList.contains('habit')||n.classList.contains('hsec')));
    let before=null; for(const n of kids){ const r=n.getBoundingClientRect(); if(st.y<r.top+r.height/2){ before=n; break; } }
    if(kids[0]&&kids[0].classList.contains('hsec')&&before===kids[0]) before=kids[1]||null;   // never above the first section label
    if(before){ if(st.el.nextSibling!==before) day.insertBefore(st.el,before); } else day.appendChild(st.el);
    if(st.y<70) scrollBy(0,-10); else if(st.y>innerHeight-90) scrollBy(0,10);
    const dr=day.getBoundingClientRect(); if(day.classList.contains('scrolls')){ if(st.y<dr.top+30) day.scrollTop-=8; else if(st.y>dr.bottom-30) day.scrollTop+=8; }
    place();
  },{passive:false});
  function end(e){
    if(!st||(e&&e.pointerId!==st.id)) return;
    if(st.on){
      const id=st.el.dataset.hid; let sec=tdSec==='all'?SECS[0].id:tdSec, prev=null, next=null, seen=false;
      for(const n of day.children){
        if(n.classList.contains('hsec')){ if(seen) break; sec=n.dataset.sec; prev=null; continue; }
        if(n===st.el){ seen=true; continue; }
        if(!n.classList.contains('habit')) continue;
        if(!seen) prev=n.dataset.hid; else { next=n.dataset.hid; break; }
      }
      const order=S.habitOrder.filter(x=>x!==id);
      if(prev) order.splice(order.indexOf(prev)+1,0,id);
      else if(next) order.splice(order.indexOf(next),0,id);
      else order.push(id);
      S.habitOrder=order; S.habitSec[id]=sec; save();
      document.body.classList.remove('drag-active'); st=null; renderTodaySection(); return;
    }
    st=null;
  }
  addEventListener('pointerup',end); addEventListener('pointercancel',end);
})();

let weekOffset=0;
wkTable.addEventListener('click',e=>{
  const c=e.target.closest('[data-cell]'); if(!c) return; const [id,k]=c.dataset.cell.split('|');
  setDone(id,k,!isDone(id,k)); renderWeek(); renderRings(); renderCollection();
});
wkPrev.onclick=()=>{weekOffset--;renderWeek()}; wkNext.onclick=()=>{weekOffset++;renderWeek()};
function renderWeek(){
  const m=addDays(monday(TODAY),weekOffset*7), days=[...Array(7)].map((_,i)=>addDays(m,i));
  const fmt=d=>d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  weekTitle.textContent=weekOffset===0?'This week':`${fmt(days[0])} to ${fmt(days[6])}`;
  bars.innerHTML=days.map(d=>{const k=ymd(d),fut=k>TK||(k<S.start&&!(S.checks[k]&&Object.keys(S.checks[k]).length)),p=Math.round(dayScore(d).pct*100);
    return `<div class="bar ${fut?'future':''}"><div class="pct">${fut?'':p+'%'}</div><div class="col" style="height:${fut?3:Math.max(p,2)}%"></div></div>`}).join('');
  barLabels.innerHTML=days.map(d=>`<div class="${ymd(d)===TK?'is-today':''}">${d.toLocaleDateString(undefined,{weekday:'short'})}</div>`).join('');
  const head=`<tr><th></th>${days.map(d=>`<th class="${ymd(d)===TK?'is-today':''}">${d.toLocaleDateString(undefined,{weekday:'short'})}<br>${d.getDate()}</th>`).join('')}</tr>`;
  const body=SECS.map(sec=>`<tr><td colspan="8" style="font-family:var(--sans);font-size:12px;font-weight:600;color:var(--sceptre);padding-top:14px">${sec.name}</td></tr>`+habitsInOrder().filter(h=>S.habitSec[h.id]===sec.id).map(h=>{
    const label=h.weekly?`${h.name}<small>${weekCount(h,days[6],ymd(days[6]))}/${h.weekly}</small>`:h.name;
    return `<tr><td>${label}</td>${days.map(d=>{
      const k=ymd(d);
      if(!applies(h,d)) return '<td><span class="na">off</span></td>';
      if(k>TK) return '<td></td>';
      const done=isDone(h.id,k), cls=done?'done':k===TK?'pend':(h.weekly||k<S.start)?'blank':'miss';
      const day=d.toLocaleDateString(undefined,{weekday:'long'});
      return `<td><button class="cell" data-cell="${h.id}|${k}" aria-pressed="${done}" aria-label="${esc(h.name)}, ${day}: ${done?'done, tap to undo':'not done, tap to mark done'}"><i class="dot ${cls}"></i></button></td>`;
    }).join('')}</tr>`;
  }).join('')).join('');
  wkTable.innerHTML=`<thead>${head}</thead><tbody>${body}</tbody>`;
}

/* ---------- QUESTS ---------- */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PLUS='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';
let openAdd=null;
questSeg.addEventListener('click',e=>{const b=e.target.closest('[data-qv]'); if(!b) return; questView=b.dataset.qv; renderQuests();});
newListBtn.onclick=()=>{ const open=newListForm.hidden; newListForm.hidden=!open; newListBtn.setAttribute('aria-expanded',open); if(open) newListName.focus(); };
newListForm.addEventListener('submit',e=>{
  e.preventDefault(); const name=newListName.value.trim(); if(!name) return;
  const cat=newListForm.querySelector('input[name=cat]:checked').value;
  // keep lists grouped by colour family
  const N=colCount(BOARDS.quests), counts=[...Array(N)].map((_,i)=>S.lists.filter(x=>Math.min(x.col??0,N-1)===i).length);
  const l={id:uid(),cat,name,shade:nextShade(cat),col:counts.indexOf(Math.min(...counts)),gap:0};
  S.lists.push(l);
  save(); newListName.value=''; newListForm.hidden=true; newListBtn.setAttribute('aria-expanded','false');
  questView='open'; renderQuests();
});
function renderQuests(){
  [...questSeg.children].forEach(b=>b.setAttribute('aria-pressed',b.dataset.qv===questView));
  document.getElementById('qv-open').hidden=questView!=='open';
  document.getElementById('qv-done').hidden=questView!=='done';
  questView==='open'?renderOpen():renderDone();
}
/* ---------- boards: Quests shows everything, Today shows only today's picks ---------- */
const BOARDS={
  quests:{id:'quests', el:lists, col:'col', gap:'gap', render:()=>renderOpen()},
  today: {id:'today',  el:tdLists, col:'tcol', gap:'tgap', render:()=>renderTodayPage()},
};
function colCount(b){ if(matchMedia('(max-width:720px)').matches) return 1; const w=b.el.clientWidth||(b.id==='quests'?document.querySelector('.app').clientWidth-40:600); return Math.max(1,Math.min(4,Math.floor((w+16)/316))); }
const tParked=t=>t.park===TK||(t.parkUntil&&t.parkUntil>TK);
const lParked=l=>l.park===TK||(l.parkUntil&&l.parkUntil>TK);
const backLabel=x=>x.parkUntil&&x.parkUntil>TK?`Back ${new Date(x.parkUntil+'T00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}`:'Parked for today';
function visibleLists(b){
  if(b.id==='quests') return S.lists.filter(l=>!lParked(l));
  const has=new Set(S.tasks.filter(t=>!t.done&&t.pick===TK&&!tParked(t)).map(t=>t.list));
  const ls=S.lists.filter(l=>!lParked(l)&&(has.has(l.id)||openAdd===l.id));
  return ls.sort((x,y)=>(x.tcol??99)-(y.tcol??99)||(x.tord??99)-(y.tord??99));
}
function ensureCols(b,N,ls){
  if(N<2) return; let changed=false;
  const cnt=[...Array(N)].map((_,i)=>ls.filter(l=>l[b.col]!=null&&Math.min(l[b.col],N-1)===i).length);
  ls.forEach(l=>{ if(l[b.col]==null){ const c=cnt.indexOf(Math.min(...cnt)); l[b.col]=c; l[b.gap]=0; if(b.id==='today') l.tord=cnt[c]; cnt[c]++; changed=true; } });
  if(changed){ if(b.id==='quests') S.lists.sort((x,y)=>x.col-y.col); save(); }
}
function tasksFor(b,l){
  const all=S.tasks.filter(t=>t.list===l.id&&!t.done);
  if(b.id==='today') return {ts:all.filter(t=>t.pick===TK&&!tParked(t)),pk:[]};
  return {ts:all.filter(t=>!tParked(t)),pk:all.filter(tParked)};
}
function card(b,l){
  const {bg,on}=shadeOf(l), isOpen=openAdd===l.id, {ts,pk}=tasksFor(b,l), today=b.id==='today';
  if(!today&&lParked(l)){
    const n=S.tasks.filter(t=>t.list===l.id&&!t.done).length;
    return `<div class="list lparked ${l.id===S.selList?'sel':''}" data-list="${l.id}" style="--shade:${bg};--on:${on};--gap:${l[b.gap]||0}px">
      <div class="list-head"><span class="grip" aria-hidden="true">${GRIP}</span><h3>${esc(l.name)}</h3><span class="lp-tag">${MOON}${backLabel(l)}</span></div>
      <div class="list-body lp-body"><span>${n} quest${n===1?'':'s'} resting</span><button class="unpark" data-lunpark="${l.id}">Bring back</button></div></div>`;
  }
  return `<div class="list ${!today&&l.id===S.selList?'sel':''}" data-list="${l.id}" style="--shade:${bg};--on:${on};--gap:${l[b.gap]||0}px">
    <div class="list-head"><span class="grip" aria-hidden="true">${GRIP}</span><h3>${esc(l.name)}</h3>
      ${today?'':`<button class="lact" data-lpark="${l.id}" title="Park this list for today" aria-label="Park ${esc(l.name)} for today">${MOON}</button><button class="lact" data-lparkuntil="${l.id}" title="Park this list until a date" aria-label="Park ${esc(l.name)} until a date">${CAR}</button><button class="rm" data-rmlist="${l.id}" aria-label="Remove ${esc(l.name)}">×</button>`}
      <button class="plus" data-add="${l.id}" aria-expanded="${isOpen}" aria-label="Add a quest to ${esc(l.name)}">${PLUS}</button></div>
    <div class="list-body">
      <form class="add" data-addform="${l.id}" ${isOpen?'':'hidden'}><input placeholder="${today?'New quest for today, then Enter':'New quest, then Enter'}" aria-label="New quest for ${esc(l.name)}"></form>
      ${ts.map(t=>`<div class="task ${t.pick===TK?'picked':''}" data-tid="${t.id}"><span class="tgrip" title="Drag to reorder" aria-hidden="true">${GRIP}</span><label class="tcheck" aria-label="Mark ${esc(t.text)} done"><input type="checkbox" data-task="${t.id}"><span class="box">${CHECK}</span></label><span class="t" data-edit="${t.id}" title="Double-click to edit">${esc(t.text)}</span>${taskActions(t)}<button class="del" data-del="${t.id}" aria-label="Delete quest">×</button></div>`).join('')}
      ${ts.length||pk.length||isOpen?'':'<p class="empty">Nothing here.</p>'}
      ${pk.length?`<details class="parked" ${openParked.has(l.id)?'open':''} data-parkfold="${l.id}"><summary>Parked (${pk.length})</summary>${pk.map(t=>`<div class="ptask"><span class="t">${esc(t.text)}</span><span class="pwhen">${backLabel(t)}</span><button class="unpark" data-unpark="${t.id}">Bring back</button></div>`).join('')}</details>`:''}
    </div></div>`;
}
function renderBoard(b){
  const ls=visibleLists(b), N=colCount(b); ensureCols(b,N,ls);
  const cols=[...Array(N)].map(()=>[]); ls.forEach(l=>cols[Math.min(l[b.col]??0,N-1)].push(l));
  b.el.innerHTML=cols.map((c,i)=>`<div class="bcol" data-col="${i}">${c.map(l=>card(b,l)).join('')}</div>`).join('');
  b.n=N;
  if(openAdd){ const f=b.el.querySelector(`[data-addform="${openAdd}"] input`); f&&f.focus(); }
}
function renderOpen(){
  if(!S.ordered){ S.lists.sort((a,b)=>ORDER.indexOf(a.cat)-ORDER.indexOf(b.cat)); S.ordered=true; save(); }
  const live=S.lists.filter(l=>!lParked(l));
  if(!live.some(l=>l.id===S.selList)) S.selList=live[0]&&live[0].id;
  const parked=S.lists.filter(lParked);
  pshelf.hidden=!parked.length;
  pshelf.innerHTML=parked.length?`<span class="ps-label">${MOON} Parked</span>${parked.map(l=>`<button class="ps-item" data-lunpark="${l.id}" title="Bring ${esc(l.name)} back"><u>${esc(l.name)}</u><small>${backLabel(l).replace('Parked for today','until tomorrow').replace('Back ','until ')}</small></button>`).join('')}`:'';
  pills.innerHTML=live.map(l=>{const {bg,on}=shadeOf(l); return `<button class="pill ${lParked(l)?'pparked':''}" data-pill="${l.id}" aria-pressed="${l.id===S.selList}" style="--shade:${bg};--on:${on}">${esc(l.name)}</button>`;}).join('');
  renderBoard(BOARDS.quests);
}
pshelf.addEventListener('click',e=>{ const b=e.target.closest('[data-lunpark]'); if(!b) return; const l=S.lists.find(l=>l.id===b.dataset.lunpark); delete l.park; delete l.parkUntil; save(); renderOpen(); });
pills.addEventListener('click',e=>{if(suppressClick){suppressClick=false;return;} const p=e.target.closest('[data-pill]'); if(!p) return; S.selList=p.dataset.pill; openAdd=null; save(); renderOpen();});

/* ---------- pick for today (star) and park for today (moon) ---------- */
const STAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
const CAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16.5h14M4 16.5v-3.2l1.8-4.6A2 2 0 0 1 7.7 7.4h8.6a2 2 0 0 1 1.9 1.3l1.8 4.6v3.2"/><path d="M4 13.3h16"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/></svg>';
const openParked=new Set();
/* small date picker: pick the day something comes back */
function openDatePop(anchor,title,onPick){
  closeDatePop();
  const tom=addDays(TODAY,1), mon=addDays(monday(TODAY),7), nextwk=addDays(TODAY,7);
  const wkday=(()=>{let d=addDays(TODAY,1); while(isWeekend(d)) d=addDays(d,1); return d;})();
  const chips=[['Tomorrow',tom],['Next weekday',wkday],['Monday',mon],['In a week',nextwk]].filter((c,i,a)=>a.findIndex(x=>ymd(x[1])===ymd(c[1]))===i);
  const pop=document.createElement('div'); pop.className='datepop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label',title);
  pop.innerHTML=`<p class="dp-title">${title}</p><div class="dp-chips">${chips.map(([n,d])=>`<button data-d="${ymd(d)}">${n}<small>${d.toLocaleDateString(undefined,{weekday:'short',day:'numeric'})}</small></button>`).join('')}</div>
    <label class="dp-pick">Or pick a date<input type="date" min="${ymd(tom)}" value="${ymd(tom)}"></label><button class="dp-go">Park it</button>`;
  document.body.appendChild(pop);
  const r=anchor.getBoundingClientRect(), w=pop.offsetWidth;
  pop.style.top=(r.bottom+scrollY+6)+'px'; pop.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w))+'px';
  const done=v=>{ closeDatePop(); if(v&&v>TK) onPick(v); };
  pop.addEventListener('click',e=>{ const c=e.target.closest('[data-d]'); if(c) done(c.dataset.d); if(e.target.closest('.dp-go')) done(pop.querySelector('input').value); e.stopPropagation(); });
  pop.querySelector('input').addEventListener('keydown',e=>{ if(e.key==='Enter') done(e.target.value); });
  setTimeout(()=>{ document.addEventListener('click',closeDatePop,{once:true}); },0);
  pop.querySelector('.dp-chips button').focus();
}
function closeDatePop(){ document.querySelectorAll('.datepop').forEach(p=>p.remove()); }
addEventListener('keydown',e=>{ if(e.key==='Escape') closeDatePop(); });
function taskActions(t){
  const on=t.pick===TK;
  return `<button class="tact star" data-star="${t.id}" aria-pressed="${on}" title="${on?'Picked for today':'Pick for today'}" aria-label="${on?'Remove from today':'Pick for today'}">${STAR}</button>`+
         `<button class="tact park" data-park="${t.id}" title="Park for today" aria-label="Park for today">${MOON}</button>`+
         `<button class="tact park" data-parkuntil="${t.id}" title="Park until a date" aria-label="Park until a date">${CAR}</button>`;
}
function setPick(id,on){ const t=S.tasks.find(t=>t.id===id); if(!t) return; if(on){ t.pick=TK; delete t.park; } else delete t.pick; save(); }
const fadeThen=(row,b)=>{ if(reduce||!row) b.render(); else { row.classList.add('leaving'); setTimeout(b.render,280); } };

/* one set of handlers, wired to both boards */
[BOARDS.quests,BOARDS.today].forEach(B=>{
  const el=B.el;
  el.addEventListener('click',e=>{
    const b=B;
    const a=e.target.closest('[data-add]'); if(a){ openAdd=openAdd===a.dataset.add?null:a.dataset.add; b.render(); return; }
    const d=e.target.closest('[data-del]'); if(d){ e.preventDefault(); S.tasks=S.tasks.filter(t=>t.id!==d.dataset.del); save(); b.render(); return; }
    const r=e.target.closest('[data-rmlist]'); if(r){ const l=S.lists.find(l=>l.id===r.dataset.rmlist);
      if(!confirm(`Remove ${l.name} and everything in it?`)) return;
      S.lists=S.lists.filter(x=>x.id!==l.id); S.tasks=S.tasks.filter(t=>t.list!==l.id); save(); b.render(); return; }
    const s=e.target.closest('[data-star]'); if(s){ const t=S.tasks.find(t=>t.id===s.dataset.star), on=t.pick!==TK; setPick(t.id,on);
      if(!on&&b.id==='today') fadeThen(s.closest('.task'),b); else b.render(); return; }
    const p=e.target.closest('[data-park]'); if(p){ const t=S.tasks.find(t=>t.id===p.dataset.park); t.park=TK; delete t.pick; save(); fadeThen(p.closest('.task'),b); return; }
    const u=e.target.closest('[data-unpark]'); if(u){ const t=S.tasks.find(t=>t.id===u.dataset.unpark); delete t.park; delete t.parkUntil; save(); b.render(); return; }
    const pu=e.target.closest('[data-parkuntil]'); if(pu){ e.stopPropagation(); const t=S.tasks.find(t=>t.id===pu.dataset.parkuntil);
      openDatePop(pu,'Park until',v=>{ t.parkUntil=v; delete t.park; delete t.pick; save(); fadeThen(b.el.querySelector(`[data-tid="${t.id}"]`),b); }); return; }
    const lp=e.target.closest('[data-lpark]'); if(lp){ const l=S.lists.find(l=>l.id===lp.dataset.lpark); l.park=TK; delete l.parkUntil; save(); b.render(); return; }
    const lpu=e.target.closest('[data-lparkuntil]'); if(lpu){ e.stopPropagation(); const l=S.lists.find(l=>l.id===lpu.dataset.lparkuntil);
      openDatePop(lpu,`Park ${l.name} until`,v=>{ l.parkUntil=v; delete l.park; save(); b.render(); }); return; }
    const lu=e.target.closest('[data-lunpark]'); if(lu){ const l=S.lists.find(l=>l.id===lu.dataset.lunpark); delete l.park; delete l.parkUntil; save(); b.render(); }
  });
  el.addEventListener('submit',e=>{
    e.preventDefault(); const f=e.target, v=f.querySelector('input').value.trim(); if(!v) return;
    const t={id:uid(),list:f.dataset.addform,text:v,done:false,doneAt:null}; if(B.id==='today') t.pick=TK;
    S.tasks.push(t); save(); B.render();
  });
  el.addEventListener('keydown',e=>{ if(e.key==='Escape'&&e.target.closest('.add')){ openAdd=null; B.render(); }});
  el.addEventListener('change',e=>{
    const id=e.target.dataset.task; if(!id) return;
    const t=S.tasks.find(t=>t.id===id); t.done=true; t.doneAt=Date.now(); save();
    fadeThen(e.target.closest('.task'),B);
  });
  el.addEventListener('toggle',e=>{ const d=e.target.closest&&e.target.closest('[data-parkfold]'); if(!d) return; d.open?openParked.add(d.dataset.parkfold):openParked.delete(d.dataset.parkfold); },true);
  /* double-click (or double-tap) a quest to rename it */
  let lastTap={id:null,t:0};
  el.addEventListener('pointerup',e=>{
    const sp=e.target.closest('.t[data-edit]'); if(!sp||sp.isContentEditable) return;
    const now=Date.now();
    if(lastTap.id===sp.dataset.edit&&now-lastTap.t<400){ lastTap={id:null,t:0}; startEdit(sp,B); }
    else lastTap={id:sp.dataset.edit,t:now};
  });
  taskSort(B); boardDrag(B);
});
function startEdit(sp,b){
  sp.contentEditable='true'; sp.focus();
  const r=document.createRange(); r.selectNodeContents(sp); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const orig=sp.textContent;
  const done=commit=>{
    sp.removeEventListener('blur',onBlur); sp.removeEventListener('keydown',onKey);
    const v=sp.textContent.replace(/\s+/g,' ').trim(), t=S.tasks.find(t=>t.id===sp.dataset.edit);
    if(commit&&v&&t){ t.text=v; save(); }
    b.render();
  };
  const onBlur=()=>done(true);
  const onKey=e=>{ if(e.key==='Enter'){e.preventDefault();done(true);} else if(e.key==='Escape'){e.preventDefault();sp.textContent=orig;done(false);} e.stopPropagation(); };
  sp.addEventListener('blur',onBlur); sp.addEventListener('keydown',onKey);
}

/* drag a quest by its grip to reorder it within its list */
function taskSort(B){
  let st=null;
  B.el.addEventListener('pointerdown',e=>{
    const g=e.target.closest('.tgrip'); if(!g||e.button>0) return;
    e.preventDefault(); st={el:g.closest('.task'),id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,on:false};
  });
  function place(){ const el=st.el; el.style.transform='none'; const r=el.getBoundingClientRect(); el.style.transform=`translate(0px,${st.y-st.gy-r.top}px)`; }
  addEventListener('pointermove',e=>{
    if(!st||e.pointerId!==st.id) return; st.x=e.clientX; st.y=e.clientY;
    if(!st.on){ if(Math.hypot(st.x-st.sx,st.y-st.sy)<4) return;
      st.on=true; const r=st.el.getBoundingClientRect(); st.gy=st.sy-r.top; st.el.classList.add('tdragging'); document.body.classList.add('drag-active');
      try{ navigator.vibrate&&navigator.vibrate(10) }catch(_){} }
    e.preventDefault();
    const parent=st.el.parentNode, others=[...parent.querySelectorAll(':scope > .task')].filter(n=>n!==st.el);
    let before=null; for(const n of others){ const r=n.getBoundingClientRect(); if(st.y<r.top+r.height/2){ before=n; break; } }
    if(before){ if(st.el.nextSibling!==before) parent.insertBefore(st.el,before); }
    else { const last=others[others.length-1]; if(last&&last.nextSibling!==st.el) last.after(st.el); }
    place();
  },{passive:false});
  function end(e){
    if(!st||(e&&e.pointerId!==st.id)) return;
    if(st.on){
      const parent=st.el.parentNode, lid=parent.closest('.list').dataset.list;
      const ids=[...parent.querySelectorAll(':scope > .task')].map(n=>n.dataset.tid);
      // reorder only the quests that were visible, keep every other quest in its slot
      const slots=S.tasks.map((t,i)=>ids.includes(t.id)?i:-1).filter(i=>i>=0);
      const moved=ids.map(id=>S.tasks.find(t=>t.id===id));
      slots.forEach((slot,k)=>{ S.tasks[slot]=moved[k]; }); save();
      document.body.classList.remove('drag-active'); st=null; B.render(); return;
    }
    st=null;
  }
  addEventListener('pointerup',end); addEventListener('pointercancel',end);
}

function renderDone(){
  const done=S.tasks.filter(t=>t.done).sort((a,b)=>b.doneAt-a.doneAt);
  if(!done.length){ doneWrap.innerHTML=`<div class="dayblock" style="padding:18px 16px"><p class="empty" style="margin:0">Nothing finished yet this month. Check off a quest and it lands here.</p></div><p class="done-note">Finished quests clear at the start of each month.</p>`; return; }
  const thisMon=ymd(monday(TODAY)), weeks=new Map();
  done.forEach(t=>{ const d=new Date(t.doneAt), wk=ymd(monday(d)), dk=ymd(d);
    if(!weeks.has(wk)) weeks.set(wk,new Map()); const days=weeks.get(wk); if(!days.has(dk)) days.set(dk,[]); days.get(dk).push(t); });
  let html='';
  weeks.forEach((days,wk)=>{
    const n=[...days.values()].reduce((a,b)=>a+b.length,0);
    const label = wk===thisMon ? `This week: ${n} quest${n>1?'s':''} finished` : `Week of ${new Date(wk+'T00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})}: ${n} finished`;
    html+=`<div class="week-banner ${wk===thisMon?'':'past'}">${label}</div><div class="dayblock">`;
    days.forEach((ts,dk)=>{
      html+=`<div class="daylabel">${new Date(dk+'T00:00').toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</div>`;
      html+=ts.map(t=>{ const l=S.lists.find(l=>l.id===t.list); const sh=l?shadeOf(l):{bg:'#C4D3E4',on:'#231815'};
        return `<div class="done-row"><span class="tick">${CHECK}</span><span>${esc(t.text)}</span><span class="tag" style="--shade:${sh.bg};--on:${sh.on}">${esc(l?l.name:'Removed list')}</span><button class="restore" data-restore="${t.id}">Restore</button></div>`; }).join('');
    });
    html+='</div>';
  });
  doneWrap.innerHTML=html+`<p class="done-note">Finished quests clear at the start of each month.</p>`;
}
doneWrap.addEventListener('click',e=>{const b=e.target.closest('[data-restore]'); if(!b) return; const t=S.tasks.find(t=>t.id===b.dataset.restore); t.done=false; t.doneAt=null; save(); renderDone();});

/* ---------- TODAY page ---------- */
let tdSec=null;
tdSecSeg.addEventListener('click',e=>{const b=e.target.closest('[data-sec]'); if(!b) return; tdSec=b.dataset.sec; renderTodaySection();});
function renderTodaySection(){
  const now=currentSec(); if(!tdSec) tdSec=now;
  tdSecSeg.innerHTML=[...SECS,{id:'all',name:'All'}].map(s=>`<button data-sec="${s.id}" aria-pressed="${s.id===tdSec}">${s.name}</button>`).join('');
  if(tdSec==='all'){
    tdSecName.textContent='All habits'; tdNow.hidden=true;
    const secs=SECS.map(s=>({s,hs:openInSec(s.id)}));
    tdHabits.innerHTML=secs.some(x=>x.hs.length)
      ? secs.map(({s,hs})=>`<div class="hsec" data-sec="${s.id}">${s.name}<span>${hs.length?`${hs.length} left`:'all done'}</span></div>${hs.map(h=>row(h)).join('')}`).join('')
      : `<div class="sec-done">Nothing left between you.</div>`;
    tdHabits.insertAdjacentHTML('beforeend',missedFold('all'));
  } else {
    const sec=SECS.find(s=>s.id===tdSec), hs=openInSec(tdSec);
    tdSecName.textContent=sec.name; tdNow.hidden=tdSec!==now;
    tdHabits.innerHTML=(hs.length?hs.map(h=>row(h)).join(''):`<div class="sec-done">${sec.name}: done.</div>`)+missedFold(tdSec);
  }
  // a device that hasn't connected yet: the habits live in the Sheet, not in this public code
  if(!HABITS.length) tdHabits.innerHTML=`<p class="sp-note" style="margin:6px 2px">Your habits are on their way from your Sheet.</p>`;
  fitDay();
}
tdHabits.addEventListener('click',e=>{
  const m=e.target.closest('[data-miss]'); if(m){ e.preventDefault(); e.stopPropagation(); setMissed(m.dataset.miss,true);
    const row=m.closest('.habit'); if(reduce||!row){renderTodaySection();updateTension();} else { row.classList.add('leaving'); setTimeout(()=>{renderTodaySection();updateTension();},300); } return; }
  const u=e.target.closest('[data-unmiss]'); if(u){ setMissed(u.dataset.unmiss,false); renderTodaySection(); updateTension(); return; }
  const b=e.target.closest('[data-didit]'); if(!b) return; setMissed(b.dataset.didit,false); setDone(b.dataset.didit,TK,true); justCollected=b.dataset.didit; renderTodaySection(); updateTension();
},true);
habPlus.onclick=()=>{
  const open=habForm.hidden; habForm.hidden=!open; habPlus.setAttribute('aria-expanded',open);
  if(open){ const def=tdSec==='all'?currentSec():tdSec;
    habSecOpts.innerHTML=SECS.map(s=>`<label><input type="radio" name="hsec" value="${s.id}" ${s.id===def?'checked':''}><span>${s.name}</span></label>`).join('');
    habName.focus(); }
};
habForm.addEventListener('submit',e=>{
  e.preventDefault(); const name=habName.value.trim(); if(!name) return;
  const sec=habForm.querySelector('input[name=hsec]:checked').value, w=+habFreq.value;
  const h={id:'c_'+uid(),name,icon:'✨',custom:true}; if(w) h.weekly=w;
  S.customHabits.push(h); HABITS.push(h); HMAP[h.id]=h;
  S.habitOrder.push(h.id); S.habitSec[h.id]=sec; save();
  habName.value=''; habFreq.value='0'; habForm.hidden=true; habPlus.setAttribute('aria-expanded','false');
  if(tdSec!=='all') tdSec=sec; renderTodaySection(); updateTension();
});
habForm.addEventListener('keydown',e=>{ if(e.key==='Escape'){ habForm.hidden=true; habPlus.setAttribute('aria-expanded','false'); }});
day.addEventListener('click',e=>{
  const d=e.target.closest('[data-hdel]'); if(!d) return; e.preventDefault(); e.stopPropagation();
  const h=HMAP[d.dataset.hdel]; if(!confirm(`Remove “${h.name}” from your habits?`)) return;
  S.customHabits=S.customHabits.filter(x=>x.id!==h.id); const i=HABITS.indexOf(h); if(i>=0) HABITS.splice(i,1);
  delete HMAP[h.id]; S.habitOrder=S.habitOrder.filter(x=>x!==h.id); delete S.habitSec[h.id]; save();
  renderTodaySection(); updateTension();
},true);
function renderTodayPage(){
  renderTodaySection(); updateTension();
  const picked=S.tasks.filter(t=>!t.done&&t.pick===TK);
  const doneToday=S.tasks.filter(t=>t.done&&t.doneAt&&ymd(new Date(t.doneAt))===TK&&t.pick===TK).length;
  tdCount.hidden=!doneToday; tdCount.textContent=`${doneToday} finished today`;
  if(!picked.length&&!openAdd){
    tdLists.innerHTML='';
    tdEmpty.innerHTML = doneToday
      ? `<div class="td-done">Everything you picked today is done.</div>`
      : `<div class="td-empty"><p>Nothing picked yet. In Quests, tap the <span class="star-inline">${STAR}</span> on anything you're committing to today and it shows up here. Picks clear at midnight, so tomorrow starts fresh.</p><button class="td-go" data-tab="quests">Go to Quests</button></div>`;
    return;
  }
  tdEmpty.innerHTML=''; renderBoard(BOARDS.today);
}

/* ---------- drag to reorder: pills on the phone ---------- */
let suppressClick=false;
function makeSortable(container, itemSel, handleSel, idAttr, holdMs){
  let st=null;
  container.addEventListener('pointerdown',e=>{
    if(e.button>0) return;
    const handle=e.target.closest(handleSel); if(!handle||!container.contains(handle)) return;
    if(e.target.closest('button:not(.pill),input,form')) return;
    const el=handle.closest(itemSel); if(!el) return;
    const touch=e.pointerType!=='mouse';
    st={el,id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,on:false,touch};
    if(touch) st.timer=setTimeout(()=>begin(),holdMs);
  });
  function begin(){
    if(!st||st.on) return;
    st.on=true; const r=st.el.getBoundingClientRect(); st.gx=st.sx-r.left; st.gy=st.sy-r.top;
    st.el.classList.add('dragging'); document.body.classList.add('drag-active');
    try{ navigator.vibrate&&navigator.vibrate(12) }catch(e){}
    place();
  }
  function place(){
    const el=st.el; el.style.transform='none'; const r=el.getBoundingClientRect();
    el.style.transform=`translate(${st.x-st.gx-r.left}px,${st.y-st.gy-r.top}px) ${el.classList.contains('pill')?'scale(1.06)':''}`;
  }
  window.addEventListener('pointermove',e=>{
    if(!st||e.pointerId!==st.id) return;
    st.x=e.clientX; st.y=e.clientY;
    const moved=Math.hypot(st.x-st.sx,st.y-st.sy);
    if(!st.on){
      if(st.touch){ if(moved>10){ clearTimeout(st.timer); st=null; } return; }
      if(moved>5) begin(); else return;
    }
    e.preventDefault();
    const over=document.elementFromPoint(st.x,st.y), target=over&&over.closest(itemSel);
    if(target&&target!==st.el&&target.parentNode===container&&getComputedStyle(target).display!=='none'){
      const items=[...container.querySelectorAll(itemSel)], from=items.indexOf(st.el), to=items.indexOf(target);
      container.insertBefore(st.el, from<to?target.nextSibling:target);
    }
    if(st.y<70) window.scrollBy(0,-12); else if(st.y>innerHeight-90) window.scrollBy(0,12);
    place();
  },{passive:false});
  container.addEventListener('touchmove',e=>{ if(st&&st.on) e.preventDefault(); },{passive:false});
  function end(e){
    if(!st||(e&&e.pointerId!==st.id)) return;
    clearTimeout(st.timer);
    if(st.on){
      st.el.classList.remove('dragging'); st.el.style.transform=''; document.body.classList.remove('drag-active');
      const ids=[...container.querySelectorAll(itemSel)].map(n=>n.getAttribute(idAttr));
      S.lists.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id)); save();
      suppressClick=true; setTimeout(()=>{suppressClick=false},350);
      st=null; renderOpen(); return;
    }
    st=null;
  }
  window.addEventListener('pointerup',end); window.addEventListener('pointercancel',end);
  container.addEventListener('contextmenu',e=>{ if(st) e.preventDefault(); });
}
makeSortable(pills,'.pill','.pill','data-pill',320);

addEventListener('resize',()=>{
  if(current==='quests'&&questView==='open'&&colCount(BOARDS.quests)!==BOARDS.quests.n) renderOpen();
  if(current==='today'&&colCount(BOARDS.today)!==BOARDS.today.n) renderTodayPage();
});
/* free board: each list has a column and an optional gap above it (separately on Quests and on Today) */
function boardDrag(B){
  let st=null; const root=B.el;
  root.addEventListener('pointerdown',e=>{
    if(e.button>0||colCount(B)===1) return;
    const head=e.target.closest('.list-head'); if(!head||e.target.closest('button,input,form')) return;
    st={el:head.closest('.list'),id:e.pointerId,sx:e.clientX,sy:e.clientY,on:false};
  });
  function begin(){
    const el=st.el, r=el.getBoundingClientRect();
    st.gx=st.sx-r.left; st.gy=st.sy-r.top; st.w=r.width; st.h=r.height;
    el.classList.add('lifted'); el.style.width=r.width+'px';
    document.body.classList.add('drag-active');
    const br=root.getBoundingClientRect(), sy=scrollY;
    st.board={top:br.top+sy,left:br.left};
    st.cols=[...root.querySelectorAll('.bcol')].map(c=>{const cr=c.getBoundingClientRect();
      return {el:c,left:cr.left,right:cr.right,top:cr.top+sy,
        items:[...c.querySelectorAll(':scope > .list:not(.lifted)')].map(n=>{const nr=n.getBoundingClientRect();return {id:n.dataset.list,top:nr.top+sy,bottom:nr.bottom+sy};})};});
    st.ghost=document.createElement('div'); st.ghost.className='drop-ghost'; st.ghost.innerHTML='<span class="gap-tag"></span>'; root.appendChild(st.ghost);
    st.on=true; move();
  }
  function target(){
    const x=st.x, cardTop=st.y-st.gy+scrollY;
    let ci=st.cols.findIndex(c=>x>=c.left-8&&x<=c.right+8);
    if(ci<0) ci=x<st.cols[0].left?0:st.cols.length-1;
    const c=st.cols[ci]; let idx=c.items.filter(it=>(it.top+it.bottom)/2<cardTop+st.h*0.25).length;
    const prevBottom=idx===0?c.top:c.items[idx-1].bottom+16;
    let gap=cardTop-prevBottom; gap=gap<24?0:Math.round(gap/8)*8;
    return {ci,idx,gap,top:prevBottom+gap,c};
  }
  function move(){
    const el=st.el; el.style.left=(st.x-st.gx)+'px'; el.style.top=(st.y-st.gy)+'px';
    const t=target(); st.t=t;
    Object.assign(st.ghost.style,{left:(t.c.left-st.board.left)+'px',top:(t.top-st.board.top)+'px',width:(t.c.right-t.c.left)+'px',height:st.h+'px'});
    const tag=st.ghost.firstChild; tag.textContent=t.gap?`${t.gap}px space above`:''; tag.style.display=t.gap?'block':'none';
  }
  addEventListener('pointermove',e=>{
    if(!st||e.pointerId!==st.id) return; st.x=e.clientX; st.y=e.clientY;
    if(!st.on){ if(Math.hypot(st.x-st.sx,st.y-st.sy)>5) begin(); else return; }
    e.preventDefault();
    if(st.y<70) scrollBy(0,-14); else if(st.y>innerHeight-90) scrollBy(0,14);
    move();
  },{passive:false});
  function end(e){
    if(!st||(e&&e.pointerId!==st.id)) return;
    if(!st.on){ st=null; return; }
    const {ci,idx,gap,top,c}=st.t, id=st.el.dataset.list, moving=S.lists.find(l=>l.id===id);
    const below=c.items[idx];
    if(below){ const bl=S.lists.find(l=>l.id===below.id); let g=Math.max(0,Math.round((below.top-(top+st.h)-16)/8)*8); bl[B.gap]=g<24?0:g; }
    moving[B.gap]=gap;
    const order=st.cols.map(col=>col.items.map(it=>it.id)); order[ci].splice(idx,0,id);
    order.forEach((ids,i)=>ids.forEach((x,j)=>{ const l=S.lists.find(l=>l.id===x); l[B.col]=i; if(B.id==='today') l.tord=j; }));
    if(B.id==='quests'){ const flat=order.flat(); S.lists.forEach(l=>{ if(!flat.includes(l.id)) flat.push(l.id); }); S.lists.sort((a,b)=>flat.indexOf(a.id)-flat.indexOf(b.id)); }
    save(); st.ghost.remove(); document.body.classList.remove('drag-active'); st=null; B.render();
  }
  addEventListener('pointerup',end); addEventListener('pointercancel',end);
}

/* ---------- GALLERY: 9 tiles, each on its own clock ---------- */
const POOL=[...ASSETS.photos.map(src=>({src,q:false})), ...ASSETS.quotes.map(src=>({src,q:true}))];
let gTiles=null, gTimers=[];
function buildGallery(){
  const order=[...POOL.keys()].sort(()=>Math.random()-.5);
  gTiles=[...Array(9)].map((_,i)=>({idx:order[i]}));
  gallery.innerHTML=gTiles.map(t=>`<div class="g-tile"><img class="${POOL[t.idx].q?'quote-img':''}" src="${POOL[t.idx].src}" alt=""><img class="out" alt=""></div>`).join('');
}
function swapTile(i){
  const el=gallery.children[i], [a,b]=el.querySelectorAll('img');
  const showing=a.classList.contains('out')?b:a, hidden=showing===a?b:a;
  const used=new Set(gTiles.map(t=>t.idx)); let next;
  do{ next=Math.floor(Math.random()*POOL.length) }while(used.has(next));
  gTiles[i].idx=next; hidden.className=POOL[next].q?'quote-img out':'out'; hidden.src=POOL[next].src;
  const go=()=>{ hidden.classList.remove('out'); showing.classList.add('out'); };
  hidden.decode?hidden.decode().then(go,go):go();
}
function schedule(i){ gTimers[i]=setTimeout(()=>{ if(!document.hidden) swapTile(i); schedule(i); }, 3500+Math.random()*8500); }
function startGallery(){ if(!gTiles) buildGallery(); stopGallery(); gTiles.forEach((_,i)=>schedule(i)); }
function stopGallery(){ gTimers.forEach(clearTimeout); gTimers=[]; }

/* ---------- FOCUS ---------- */
const MODES={focus:{label:'Focus',min:25},short:{label:'Short break',min:5},long:{label:'Long break',min:15}};
let mode='focus', remaining=1500, endAt=null, tick=null, mosaicSeed=DAYNUM;
const ARC=2*Math.PI*92;
function renderMosaic(){ mosaic.innerHTML=pick(ASSETS.photos,mosaicSeed,15).map(s=>`<img src="${s}" alt="">`).join(''); }
renderMosaic();
function renderFocus(){
  modes.innerHTML=Object.entries(MODES).map(([k,m])=>`<button data-mode="${k}" aria-pressed="${k===mode}">${m.label}</button>`).join('');
  drawClock(); const n=S.pomo[TK]||0;
  sessText.textContent=n?`${n} focus session${n>1?'s':''} today`:'No focus sessions yet today';
  pips.innerHTML=[...Array(Math.max(4,n))].map((_,i)=>`<i class="${i<n?'on':''}"></i>`).join('');
}
function drawClock(){
  const total=MODES[mode].min*60, r=Math.max(0,Math.round(remaining));
  fclock.textContent=`${pad(Math.floor(r/60))}:${pad(r%60)}`;
  modeLabel.textContent=mode==='focus'?'focus':'breathe';
  dialArc.setAttribute('stroke-dasharray',`${ARC*(r/total)} ${ARC}`);
  startBtn.textContent=endAt?'Pause':(r<total?'Resume':'Start');
  document.title=endAt?`${fclock.textContent} · ${MODES[mode].label}`:'the sexual tension between me and what I am capable of';
}
modes.addEventListener('click',e=>{const b=e.target.closest('[data-mode]'); if(!b) return; stop(); mode=b.dataset.mode; remaining=MODES[mode].min*60; renderFocus();});
startBtn.onclick=()=>{ if(endAt) stop(); else {endAt=Date.now()+remaining*1000; tick=setInterval(step,250);} drawClock(); };
resetBtn.onclick=()=>{ stop(); remaining=MODES[mode].min*60; drawClock(); };
function stop(){ if(endAt) remaining=(endAt-Date.now())/1000; endAt=null; clearInterval(tick); }
function step(){
  remaining=(endAt-Date.now())/1000;
  if(remaining<=0){ stop(); remaining=0; chime();
    if(mode==='focus'){ S.pomo[TK]=(S.pomo[TK]||0)+1; save(); mode=S.pomo[TK]%4===0?'long':'short'; mosaicSeed++; renderMosaic(); nextFocusQuote(); } else mode='focus';
    remaining=MODES[mode].min*60; renderFocus(); return; }
  drawClock();
}
function chime(){ try{ navigator.vibrate&&navigator.vibrate([200,100,200]);
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  [660,880].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;o.connect(g);g.connect(ctx.destination);
    const t=ctx.currentTime+i*.35;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.25,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.6);o.start(t);o.stop(t+.65);});
}catch(e){} }

/* ---------- sync: another device changed S, so redraw ---------- */
// busy = mid-drag, mid-rename, typing, or a popover open; sync waits rather than redraw under her hands
window.appBusy=()=>{
  if(document.body.classList.contains('drag-active')||document.querySelector('.datepop')) return true;
  const a=document.activeElement; if(!a||a===document.body) return false;
  return a.isContentEditable||(a.matches('input[type=text],input:not([type]),input[type=date]')&&!!a.value);
};
window.refreshFromSync=()=>{
  S.baseHabits ||= []; S.customHabits ||= [];
  loadHabits(); initOrder();
  if(current!=='gallery') show();
};

show();
