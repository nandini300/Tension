/* ---------- sync: this device first, Google Sheets in the background ----------
   app.js keeps working exactly as before on S + localStorage. Every save() calls
   Sync.changed(); we flatten S into one record per row (the Sheet tabs), compare
   with the last snapshot, stamp what changed with updatedAt and push it. Pulls
   bring other devices' rows; per record, the newest updatedAt wins. Deletes are
   tombstones (deleted = true), never removed rows. */
(function(){
const SKEY='tension-sync-v1', PULL_EVERY=60e3;

/* the Sheet tabs. s = text, n = number, b = true/false, j = any value as JSON */
const TABS={
  lists:        {key:['id'],             cols:{id:'s',name:'s',cat:'s',shade:'n',col:'n',gap:'n',tcol:'n',tgap:'n',tord:'n',park:'s',parkUntil:'s',sortIndex:'n'}},
  tasks:        {key:['id'],             cols:{id:'s',list:'s',text:'s',done:'b',doneAt:'n',pick:'s',park:'s',parkUntil:'s',sortIndex:'n'}},
  habit_checks: {key:['date','habitId'], cols:{date:'s',habitId:'s',checkedAt:'n'}},
  habit_missed: {key:['date','habitId'], cols:{date:'s',habitId:'s'}},
  habits:       {key:['id'],             cols:{id:'s',name:'s',icon:'s',weekly:'n',weekdays:'b',section:'s',sortIndex:'n'}},
  habits_custom:{key:['id'],             cols:{id:'s',name:'s',icon:'s',weekly:'n'}},
  habit_layout: {key:['habitId'],        cols:{habitId:'s',section:'s',sortIndex:'n'}},
  pomodoro:     {key:['date'],           cols:{date:'s',sessions:'n'}},
  settings:     {key:['key'],            cols:{key:'s',value:'j'}},
};
const SETTINGS=['start','selList','ordered','prio'];

/* ---------- local state ---------- */
let st; try{ st=JSON.parse(localStorage.getItem(SKEY)) }catch(e){ st=null }
if(!st||typeof st!=='object') st={};
st.snap ||= {}; st.dirty ||= {}; st.inbox ||= []; st.cursor ||= 0;
const persist=()=>{ try{ localStorage.setItem(SKEY,JSON.stringify(st)) }catch(e){ status('error','This device is out of storage space') } };
if('key' in st){ delete st.key; persist(); }   // the old shared passphrase: replaced by a passcode login and a session token
/* unlocked = this device holds a live session token. Without one the app runs in demo mode:
   sample data under its own key, and nothing ever goes to or comes from the Sheet. */
const unlocked=!!(st.token&&st.url&&Number(st.expiresAt)>Date.now());
const on=()=>!!(unlocked&&st.token&&st.joined);

/* one canonical shape per record, so the same data always compares equal */
function canon(tab,o){
  const d={};
  for(const [c,t] of Object.entries(TABS[tab].cols)){
    const v=o[c];
    if(t==='b'){ d[c]=v===true||v==='true'||v==='TRUE'; continue; }
    if(v==null||v==='') continue;
    if(t==='n'){ const n=Number(v); if(!isNaN(n)) d[c]=n; }
    else if(t==='j') d[c]=v;
    else d[c]=String(v);
  }
  return d;
}
const keyOf=(tab,d)=>tab+'|'+TABS[tab].key.map(k=>d[k]).join('|');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Sheet cells are text: values go up as strings and come back through canon()
function toSheet(tab,d){ const r={}; for(const [c,t] of Object.entries(TABS[tab].cols)) if(c in d) r[c]=t==='j'?JSON.stringify(d[c]):String(d[c]); return r; }
function fromSheet(tab,r){ const o={}; for(const [c,t] of Object.entries(TABS[tab].cols)){ let v=r[c]; if(t==='j'&&v!=null&&v!==''){ try{ v=JSON.parse(v) }catch(e){} } o[c]=v; } return canon(tab,o); }

/* sortIndex: keep every old value that is still in order, only renumber what moved.
   A delete or an add then touches one row, not every row after it. */
function ranks(tab,ids){
  const old=ids.map(id=>{ const r=st.snap[tab+'|'+id]; return r&&typeof r.data.sortIndex==='number'?r.data.sortIndex:null; });
  const keep=lis(old), out=new Array(ids.length);
  for(let i=0;i<ids.length;){
    if(keep.has(i)){ out[i]=old[i]; i++; continue; }
    let j=i; while(j<ids.length&&!keep.has(j)) j++;
    const lo=i?out[i-1]:null, hi=j<ids.length?old[j]:null, n=j-i;
    for(let k=0;k<n;k++) out[i+k]= lo==null&&hi==null?k : lo==null?hi-(n-k) : hi==null?lo+1+k : lo+(hi-lo)*(k+1)/(n+1);
    if(lo!=null&&hi!=null&&(hi-lo)/(n+1)<1e-6) return ids.map((_,k)=>k);   // worn too thin: renumber once
    i=j;
  }
  return out;
}
function lis(a){   // indexes of the longest strictly increasing run of known values
  const idx=a.map((v,i)=>i).filter(i=>a[i]!=null), len={}, prev={}; let best=-1;
  idx.forEach((i,p)=>{ len[i]=1; prev[i]=-1; for(let q=0;q<p;q++){ const j=idx[q]; if(a[j]<a[i]&&len[j]+1>len[i]){ len[i]=len[j]+1; prev[i]=j; } } if(best<0||len[i]>len[best]) best=i; });
  const s=new Set(); for(let i=best;i>=0;i=prev[i]) s.add(i); return s;
}

/* S -> records */
function flatten(){
  const out={}, put=(tab,o)=>{ const d=canon(tab,o); out[keyOf(tab,d)]=d; };
  const lr=ranks('lists',S.lists.map(l=>l.id)); S.lists.forEach((l,i)=>put('lists',{...l,sortIndex:lr[i]}));
  const tr=ranks('tasks',S.tasks.map(t=>t.id)); S.tasks.forEach((t,i)=>put('tasks',{...t,sortIndex:tr[i]}));
  for(const date in S.checks) for(const habitId in S.checks[date]) put('habit_checks',{date,habitId,checkedAt:S.checks[date][habitId]});
  for(const date in (S.missed||{})) for(const habitId in S.missed[date]) if(S.missed[date][habitId]) put('habit_missed',{date,habitId});
  const bh=S.baseHabits||[], br=ranks('habits',bh.map(h=>h.id)); bh.forEach((h,i)=>put('habits',{...h,sortIndex:br[i]}));
  (S.customHabits||[]).forEach(h=>put('habits_custom',h));
  const ho=S.habitOrder||[], hr=ranks('habit_layout',ho); ho.forEach((habitId,i)=>put('habit_layout',{habitId,section:(S.habitSec||{})[habitId],sortIndex:hr[i]}));
  for(const date in S.pomo) put('pomodoro',{date,sessions:S.pomo[date]});
  SETTINGS.forEach(key=>{ if(S[key]!==undefined) put('settings',{key,value:S[key]}); });
  return out;
}

/* records -> S, changing S in place so app.js keeps its reference */
function rebuild(){
  const by={}; for(const t in TABS) by[t]=[];
  for(const k in st.snap){ const r=st.snap[k]; if(!r.deleted) by[r.tab].push(r.data); }
  const ord=a=>a.sort((x,y)=>(x.sortIndex??0)-(y.sortIndex??0)||String(x.id||x.habitId).localeCompare(String(y.id||y.habitId)));
  const bare=({sortIndex,...o})=>o;
  S.lists=ord(by.lists).map(bare);
  S.tasks=ord(by.tasks).map(bare);
  S.checks={}; by.habit_checks.forEach(r=>{ (S.checks[r.date] ||= {})[r.habitId]=r.checkedAt||1; });
  S.missed={}; by.habit_missed.forEach(r=>{ (S.missed[r.date] ||= {})[r.habitId]=true; });
  const lay=ord(by.habit_layout);
  S.habitOrder=lay.map(r=>r.habitId); S.habitSec={}; lay.forEach(r=>{ if(r.section) S.habitSec[r.habitId]=r.section; });
  // weekdays:false is the same as no weekday rule; drop it so the app sees the shape it always had
  S.baseHabits=ord(by.habits).map(bare).map(({weekdays,...h})=>weekdays?{...h,weekdays:true}:h);
  S.customHabits=by.habits_custom.map(h=>({...h,custom:true})).sort((a,b)=>S.habitOrder.indexOf(a.id)-S.habitOrder.indexOf(b.id));
  S.pomo={}; by.pomodoro.forEach(r=>{ S.pomo[r.date]=r.sessions||0; });
  SETTINGS.forEach(k=>delete S[k]); by.settings.forEach(r=>{ S[r.key]=r.value; });
}

/* what changed on this device since the last look */
function diff(){
  if(!on()) return;
  const now=Date.now(), flat=flatten(); let n=0;
  const stamp=r=>Math.max(now,r?r.updatedAt+1:0);   // always newer than what it replaces, even if this clock runs slow
  for(const k in flat){ const r=st.snap[k];
    if(!r||r.deleted||!same(r.data,flat[k])){ st.snap[k]={tab:k.split('|')[0],data:flat[k],updatedAt:stamp(r),deleted:false}; st.dirty[k]=1; n++; } }
  for(const k in st.snap){ const r=st.snap[k];
    if(!r.deleted&&!flat[k]){ r.deleted=true; r.updatedAt=stamp(r); st.dirty[k]=1; n++; } }
  if(n) persist();
  return n;
}


/* ---------- talking to the Apps Script: every call carries the session token ---------- */
class SyncError extends Error{}
class AuthError extends SyncError{}
async function call(action,body,url=st.url){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token:st.token,...body})});
  let j; try{ j=await res.json() }catch(e){ throw new SyncError('The script address doesn’t look right') }
  if(!j.ok){
    const e=String(j.error||'');
    if(e==='auth') throw new AuthError('This device was locked. Unlock it again to keep syncing.');
    if(e==='nopasscode') throw new SyncError('No passcode yet. In your Sheet, use the Tension menu → Set passcode.');
    if(e.startsWith('wrong:')){ const n=+e.slice(6); throw new SyncError(`That passcode isn’t right. ${n} ${n===1?'try':'tries'} left before login locks for 15 minutes.`); }
    if(e.startsWith('locked:')){ const m=+e.slice(7); throw new SyncError(`Too many wrong tries. Login is locked for ${m} more minute${m===1?'':'s'}.`); }
    throw new SyncError(e||'The script said no');
  }
  return j;
}
// the Sheet stopped accepting this device's token (expired, or the passcode was changed)
function sessionEnded(msg){ st.token=null; delete st.expiresAt; persist(); status('error',msg); }

async function push(){
  for(let guard=0;guard<50;guard++){
    const keys=Object.keys(st.dirty).slice(0,400); if(!keys.length) return;
    const sent=keys.map(k=>{ const r=st.snap[k]; return {k,updatedAt:r.updatedAt,rec:{tab:r.tab,row:toSheet(r.tab,r.data),updatedAt:r.updatedAt,deleted:r.deleted}}; });
    await call('push',{records:sent.map(s=>s.rec)});
    sent.forEach(s=>{ if(st.snap[s.k]&&st.snap[s.k].updatedAt===s.updatedAt) delete st.dirty[s.k]; });   // changed again mid-flight? keep it queued
    persist();
  }
}
async function pull(){
  const j=await call('pull',{since:Math.max(0,st.cursor-5000)});
  if(j.records.length){ st.inbox.push(...j.records); }
  st.cursor=j.cursor; persist();
  absorb();
}
/* fold pulled rows into S, but never under her hands mid-drag or mid-typing */
let absorbTimer=null;
function absorb(){
  clearTimeout(absorbTimer);
  if(!st.inbox.length) return;
  if(window.appBusy&&appBusy()){ absorbTimer=setTimeout(absorb,1500); return; }
  diff();   // capture anything she just did first, so it isn't overwritten
  let changed=false;
  for(const x of st.inbox){
    if(!TABS[x.tab]) continue;
    const data=fromSheet(x.tab,x.row), k=keyOf(x.tab,data), r=st.snap[k], at=Number(x.updatedAt)||0;
    if(!r||at>r.updatedAt){ st.snap[k]={tab:x.tab,data,updatedAt:at,deleted:!!x.deleted}; delete st.dirty[k]; changed=true; }
  }
  st.inbox=[]; persist();
  if(changed){ rebuild(); save(); window.refreshFromSync&&refreshFromSync(); }
}

/* ---------- the loop ---------- */
let running=false, again=false, pushTimer=null, retryTimer=null, fails=0, lastOk=0;
async function sync(){
  if(!on()) return status();
  if(running){ again=true; return; }
  running=true; clearTimeout(retryTimer); status('syncing');
  try{ diff(); await push(); await pull(); fails=0; lastOk=Date.now(); status('synced'); }
  catch(e){
    if(e instanceof AuthError) sessionEnded(e.message);
    else {
      fails++; status(navigator.onLine===false||!(e instanceof SyncError)?'offline':'error',e instanceof SyncError?e.message:'');
      retryTimer=setTimeout(sync,Math.min(5*60e3,5e3*2**Math.min(fails,6)));
    }
  }
  running=false;
  if(again){ again=false; sync(); }
}
function changed(){
  if(!on()) return;
  clearTimeout(pushTimer); pushTimer=setTimeout(()=>{ if(diff()) sync(); },1200);
}
addEventListener('focus',()=>sync());
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) sync(); });
addEventListener('online',()=>sync());
addEventListener('offline',()=>{ if(on()) status('offline'); });
setInterval(()=>{ if(!document.hidden) sync(); },PULL_EVERY);

/* ---------- unlock, first join, lock ---------- */
async function unlock(url,passcode){
  const j=await call('login',{passcode},url);
  if(st.url&&st.url!==url) st={snap:{},dirty:{},inbox:[],cursor:0};   // a different Sheet: this device starts over against it
  st.url=url; st.token=j.token; st.expiresAt=j.expiresAt;
  if(!st.joined) st.needsJoin=true;
  persist(); location.reload();   // reopen on her real data instead of the demo
}
/* first time this device is unlocked: take what's in the Sheet, add what only this device has */
async function join(){
  const j=await call('pull',{since:0});
  const server={};
  j.records.forEach(x=>{ if(!TABS[x.tab]) return; const data=fromSheet(x.tab,x.row); server[keyOf(x.tab,data)]={tab:x.tab,data,updatedAt:Number(x.updatedAt)||0,deleted:!!x.deleted}; });
  st.snap={}; st.dirty={}; st.inbox=[]; st.cursor=j.cursor; st.joined=true; delete st.needsJoin;
  const local=flatten();   // st.snap is empty, so this is everything on this device, in order
  if(!Object.keys(server).length){
    // the Sheet is empty: this device is the first, so everything here goes up (the one-time migration)
    diff(); persist(); sync(); return 'uploaded';
  }
  st.snap=server;
  const live={}, gone={};
  for(const r of Object.values(server)) if(r.tab==='lists') (r.deleted?gone:live)[r.data.cat+'|'+r.data.name.toLowerCase()]=r.data.id;
  const remap={}, dropList=new Set();
  for(const [k,d] of Object.entries(local)) if(k.startsWith('lists|')){
    const nk=d.cat+'|'+d.name.toLowerCase();
    if(live[nk]&&live[nk]!==d.id) remap[d.id]=live[nk];   // same list on both: merge into the Sheet's copy
    else if(!live[nk]&&gone[nk]&&!Object.values(local).some(t=>t.list===d.id&&!t.done)) dropList.add(d.id);   // deleted elsewhere, empty here
  }
  const top={}; for(const r of Object.values(server)) if(typeof r.data.sortIndex==='number') top[r.tab]=Math.max(top[r.tab]??-1,r.data.sortIndex);
  const now=Date.now();
  for(const [k0,d0] of Object.entries(local)){
    const tab=k0.split('|')[0];
    if(tab==='lists'&&(remap[d0.id]||dropList.has(d0.id))) continue;
    if(tab==='tasks'&&dropList.has(d0.list)) continue;
    const d=tab==='tasks'&&remap[d0.list]?{...d0,list:remap[d0.list]}:{...d0};
    const k=keyOf(tab,d), s=server[k];
    if(s){ if(tab==='pomodoro'&&!s.deleted&&d.sessions>(s.data.sessions||0)){ st.snap[k]={tab,data:d,updatedAt:Math.max(now,s.updatedAt+1),deleted:false}; st.dirty[k]=1; } continue; }
    if('sortIndex' in d) d.sortIndex+=(top[tab]??-1)+1;   // this device's extras go after the Sheet's
    st.snap[k]={tab,data:d,updatedAt:now,deleted:false}; st.dirty[k]=1;
  }
  rebuild(); persist(); save();
  return 'merged';
}
/* Lock: send what's unsent, end the session, and wipe her data from this device */
async function lockDevice(){
  const wait=(p,ms)=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('slow')),ms))]);
  if(on()){ try{ diff(); await wait(push(),8000); }catch(e){} }
  const left=Object.keys(st.dirty).length;
  if(left&&!confirm(`${left} change${left===1?'':'s'} on this device haven’t reached your Sheet yet (are you offline?). Lock anyway and lose ${left===1?'it':'them'}?`)) return;
  if(st.token){ try{ await wait(call('logout',{}),4000); }catch(e){} }
  try{ localStorage.removeItem('tension-dashboard-v1'); }catch(e){}
  st={url:st.url}; persist();   // only the script address stays, so unlocking again is just the passcode
  location.reload();
}

/* ---------- the corner: Demo + Unlock, or sync status + Lock ---------- */
let state='syncing', detail='';
const WORDS={syncing:'syncing',synced:'synced',offline:'offline',error:'sync problem'};
function status(s,msg){
  if(!unlocked) return;
  if(s!==undefined){ state=s; detail=msg||''; }
  const el=document.getElementById('syncStat'); if(!el) return;
  const queued=Object.keys(st.dirty).length;
  el.dataset.s=state;
  el.querySelector('span').textContent=WORDS[state]+(state==='offline'&&queued?' · saved here':'');
  el.title=detail||(lastOk?`Last synced ${new Date(lastOk).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'');
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const okUrl=u=>/^https:\/\/script\.google(usercontent)?\.com\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u);
function openPanel(anchor){
  if(document.querySelector('.datepop.syncpop')){ closePanel(); return; }
  document.querySelectorAll('.datepop').forEach(p=>p.remove());
  const pop=document.createElement('div'); pop.className='datepop syncpop'; pop.setAttribute('role','dialog');
  pop.setAttribute('aria-label',unlocked?'Sync':'Unlock');
  let askUrl=!st.url;
  const draw=(msg='')=>{
    pop.innerHTML=unlocked
      ? `<p class="dp-title">Synced with your Sheet</p><p class="sp-note">${esc(detail||(state==='offline'?'Offline. Changes are saved on this device and go up when you’re back online.':lastOk?`Last synced ${new Date(lastOk).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`:'Connected.'))}</p>
         <button class="dp-go" data-act="now">Sync now</button><button class="sp-off" data-act="lock">Lock this device</button>`
      : `<p class="dp-title">Unlock</p><p class="sp-note">This is a demo. Unlock to see your own habits and quests.</p>
         <form data-act="unlock">
         ${askUrl?`<label class="dp-pick">Script address<input type="url" id="spUrl" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false"></label>`:''}
         <label class="dp-pick">Passcode<input type="password" id="spPass" autocomplete="current-password"></label>
         ${msg?`<p class="sp-note sp-err">${esc(msg)}</p>`:''}<button class="dp-go" type="submit">Unlock</button>
         ${askUrl?'':`<button class="sp-off" type="button" data-act="addr">Use a different script address</button>`}</form>`;
    (pop.querySelector('input')||pop.querySelector('button')).focus();
  };
  draw();
  document.body.appendChild(pop);
  const r=anchor.getBoundingClientRect(), w=pop.offsetWidth;
  pop.style.top=(r.bottom+scrollY+6)+'px'; pop.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left))+'px';
  pop.addEventListener('click',e=>{
    e.stopPropagation();
    const b=e.target.closest('[data-act]'); if(!b) return;
    if(b.dataset.act==='now'){ closePanel(); sync(); }
    if(b.dataset.act==='lock'){ closePanel(); askLock(); }
    if(b.dataset.act==='addr'){ askUrl=true; draw(); }
  });
  pop.addEventListener('submit',async e=>{
    e.preventDefault();
    const url=askUrl?pop.querySelector('#spUrl').value.trim():st.url, pass=pop.querySelector('#spPass').value;
    if(!okUrl(url)) return draw('That address should start with https://script.google.com/');
    if(!pass) return draw('Type your passcode.');
    const b=pop.querySelector('.dp-go'); b.disabled=true; b.textContent='Unlocking…';
    try{ await unlock(url,pass); }
    catch(err){ draw(err instanceof SyncError?err.message:'Couldn’t reach the script. Check the address and that you’re online.'); if(askUrl) pop.querySelector('#spUrl').value=url; }
  });
  setTimeout(()=>document.addEventListener('click',outside),0);
}
function askLock(){ if(confirm('Lock this device? Your data stays safe in your Sheet. This device goes back to the demo until you unlock it.')) lockDevice(); }
function outside(e){ if(!e.target.closest('.syncpop')&&!e.target.closest('.acct')) closePanel(); }
function closePanel(){ document.querySelectorAll('.syncpop').forEach(p=>p.remove()); document.removeEventListener('click',outside); }
addEventListener('keydown',e=>{ if(e.key==='Escape') closePanel(); });

window.Sync={unlocked,changed,sync,status:()=>({state,detail,queued:Object.keys(st.dirty).length,on:on(),unlocked})};

addEventListener('DOMContentLoaded',()=>{
  const $=id=>document.getElementById(id);
  $('syncStat').hidden=$('lockBtn').hidden=!unlocked;
  $('demoChip').hidden=$('unlockBtn').hidden=unlocked;
  $('syncStat').addEventListener('click',e=>{ e.stopPropagation(); openPanel($('syncStat')); });
  $('unlockBtn').addEventListener('click',e=>{ e.stopPropagation(); openPanel($('unlockBtn')); });
  $('lockBtn').addEventListener('click',e=>{ e.stopPropagation(); askLock(); });
  if(!unlocked) return;
  status(navigator.onLine===false?'offline':'syncing');
  if(st.needsJoin){
    join().then(how=>{ persist(); if(how==='merged') location.reload(); })
      .catch(e=>{ if(e instanceof AuthError) sessionEnded(e.message); else status(navigator.onLine===false||!(e instanceof SyncError)?'offline':'error',e instanceof SyncError?e.message:''); });
  } else if(on()) sync();
});

/* ---------- installable app: cache the shell and photos for offline ---------- */
if('serviceWorker' in navigator&&location.protocol!=='file:') addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();