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
  habits_custom:{key:['id'],             cols:{id:'s',name:'s',icon:'s',weekly:'n'}},
  habit_layout: {key:['habitId'],        cols:{habitId:'s',section:'s',sortIndex:'n'}},
  pomodoro:     {key:['date'],           cols:{date:'s',sessions:'n'}},
  settings:     {key:['key'],            cols:{key:'s',value:'j'}},
};
const SETTINGS=['start','selList','ordered'];

/* ---------- local state ---------- */
let st; try{ st=JSON.parse(localStorage.getItem(SKEY)) }catch(e){ st=null }
if(!st||typeof st!=='object') st={};
st.snap ||= {}; st.dirty ||= {}; st.inbox ||= []; st.cursor ||= 0;
const persist=()=>{ try{ localStorage.setItem(SKEY,JSON.stringify(st)) }catch(e){ status('error','This device is out of storage space') } };
const on=()=>!!(st.url&&st.key&&st.joined);

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

/* ---------- talking to the Apps Script ---------- */
async function call(action,body){
  const res=await fetch(st.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,key:st.key,...body})});
  let j; try{ j=await res.json() }catch(e){ throw new SyncError('The script address doesn’t look right') }
  if(!j.ok) throw new SyncError(j.error==='wrong passphrase'?'The passphrase doesn’t match the script':j.error||'The script said no');
  return j;
}
class SyncError extends Error{}

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
    fails++; status(navigator.onLine===false||!(e instanceof SyncError)?'offline':'error',e instanceof SyncError?e.message:'');
    retryTimer=setTimeout(sync,Math.min(5*60e3,5e3*2**Math.min(fails,6)));
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
addEventListener('offline',()=>status('offline'));
setInterval(()=>{ if(!document.hidden) sync(); },PULL_EVERY);

/* ---------- first run: join this device to the Sheet ---------- */
async function connect(url,key){
  const prev={url:st.url,key:st.key};
  st.url=url; st.key=key; st.joined=false;
  let j;
  try{ j=await call('pull',{since:0}); }
  catch(e){ Object.assign(st,prev); throw e; }
  const server={};
  j.records.forEach(x=>{ if(!TABS[x.tab]) return; const data=fromSheet(x.tab,x.row); server[keyOf(x.tab,data)]={tab:x.tab,data,updatedAt:Number(x.updatedAt)||0,deleted:!!x.deleted}; });
  st.snap={}; st.dirty={}; st.inbox=[]; st.cursor=j.cursor; st.joined=true;
  const local=flatten();   // st.snap is empty, so this is everything on this device, in order
  if(!Object.keys(server).length){
    // the Sheet is empty: this device is the first, so everything here goes up (the one-time migration)
    diff(); persist(); sync(); return 'uploaded';
  }
  // the Sheet already has data: keep it, and add only what this device has that the Sheet doesn't
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
function disconnect(){ st={snap:{},dirty:{},inbox:[],cursor:0}; persist(); status(); }

/* ---------- the quiet status line + its setup popover ---------- */
let state='off', detail='';
const WORDS={off:'sync off',syncing:'syncing',synced:'synced',offline:'offline',error:'sync problem'};
function status(s,msg){
  if(s===undefined) s=on()?state==='off'?'synced':state:'off';
  state=s; detail=msg||'';
  const el=document.getElementById('syncStat'); if(!el) return;
  const queued=Object.keys(st.dirty).length;
  el.dataset.s=s;
  el.querySelector('span').textContent=WORDS[s]+(s==='offline'&&queued?' · saved here':'');
  el.title=s==='off'?'Set up sync':detail||(lastOk?`Last synced ${new Date(lastOk).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'');
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function openPanel(anchor){
  if(document.querySelector('.datepop.syncpop')){ closePanel(); return; }
  document.querySelectorAll('.datepop').forEach(p=>p.remove());
  const pop=document.createElement('div'); pop.className='datepop syncpop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','Sync');
  const draw=(msg='')=>{
    pop.innerHTML=on()
      ? `<p class="dp-title">Synced with your Sheet</p><p class="sp-note">${esc(state==='error'?detail:state==='offline'?'Offline. Changes are saved on this device and go up when you’re back online.':lastOk?`Last synced ${new Date(lastOk).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`:'Connected.')}</p>
         <button class="dp-go" data-act="now">Sync now</button><button class="sp-off" data-act="off">Turn off sync on this device</button>`
      : `<p class="dp-title">Sync with Google Sheets</p><p class="sp-note">Paste the two things from the setup guide. You only do this once on each device.</p>
         <label class="dp-pick">Script address<input type="url" id="spUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(st.url||'')}" autocomplete="off" spellcheck="false"></label>
         <label class="dp-pick">Passphrase<input type="password" id="spKey" autocomplete="off"></label>
         ${msg?`<p class="sp-note sp-err">${esc(msg)}</p>`:''}<button class="dp-go" data-act="connect">Connect</button>`;
  };
  draw();
  document.body.appendChild(pop);
  const r=anchor.getBoundingClientRect(), w=pop.offsetWidth;
  pop.style.top=(r.bottom+scrollY+6)+'px'; pop.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left))+'px';
  pop.addEventListener('click',async e=>{
    e.stopPropagation();
    const b=e.target.closest('[data-act]'); if(!b) return;
    if(b.dataset.act==='now'){ closePanel(); sync(); }
    if(b.dataset.act==='off'){ if(confirm('Stop syncing on this device? Everything stays here and in your Sheet.')){ disconnect(); closePanel(); } }
    if(b.dataset.act==='connect'){
      const url=pop.querySelector('#spUrl').value.trim(), key=pop.querySelector('#spKey').value;
      if(!/^https:\/\/script\.google(usercontent)?\.com\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return draw('That address should start with https://script.google.com/');
      if(!key) return draw('Type the passphrase you put in the script.');
      b.disabled=true; b.textContent='Connecting…';
      try{ const how=await connect(url,key); closePanel();
        if(how==='merged') location.reload(); }
      catch(err){ draw(err instanceof SyncError?err.message:'Couldn’t reach the script. Check the address and that you’re online.'); pop.querySelector('#spUrl').value=url; }
    }
  });
  pop.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.matches('input')){ e.preventDefault(); pop.querySelector('[data-act=connect]')?.click(); } });
  setTimeout(()=>document.addEventListener('click',outside),0);
  (pop.querySelector('input')||pop.querySelector('button')).focus();
}
function outside(e){ if(!e.target.closest('.syncpop')&&!e.target.closest('#syncStat')) closePanel(); }
function closePanel(){ document.querySelectorAll('.syncpop').forEach(p=>p.remove()); document.removeEventListener('click',outside); }
addEventListener('keydown',e=>{ if(e.key==='Escape') closePanel(); });

window.Sync={changed,sync,status:()=>({state,detail,queued:Object.keys(st.dirty).length,on:on()})};

addEventListener('DOMContentLoaded',()=>{
  const el=document.getElementById('syncStat');
  el.addEventListener('click',e=>{ e.stopPropagation(); openPanel(el); });
  status(on()?(navigator.onLine===false?'offline':'syncing'):'off');
  if(on()) sync();
});

/* ---------- installable app: cache the shell and photos for offline ---------- */
if('serviceWorker' in navigator&&location.protocol!=='file:') addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
