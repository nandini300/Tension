/* offline: the app shell and every photo live in a cache, so the app opens with no signal.
   Shell files show the cached copy instantly and refresh it in the background,
   so an update shows up the second time the app is opened. */
importScripts('assets.js');   // ASSETS: the photo and quote list
const CACHE='tension-v2', FONTS='tension-fonts';   // bump to make every device drop its old copy
const SHELL=['./','index.html','styles.css','assets.js','sync.js','app.js','manifest.webmanifest',
  'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'];

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})));   // straight from the server, not the browser's copy
    await Promise.allSettled([...ASSETS.photos,...ASSETS.quotes].map(u=>c.add(u)));   // one missing photo shouldn't block install
    self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()) if(k!==CACHE&&k!==FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',e=>{
  const req=e.request, url=new URL(req.url);
  if(req.method!=='GET') return;   // sync calls to Google go straight through
  if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com') return e.respondWith(fresh(req,FONTS));
  if(url.origin!==location.origin) return;
  if(url.pathname.includes('/assets/')) return e.respondWith(cacheFirst(req));
  if(req.mode==='navigate') return e.respondWith(fresh(req,CACHE,'index.html'));
  e.respondWith(fresh(req,CACHE));
});

async function cacheFirst(req){
  const hit=await caches.match(req);
  if(hit) return hit;
  const res=await fetch(req);
  if(res.ok){ const c=await caches.open(CACHE); c.put(req,res.clone()); }
  return res;
}
// stale-while-revalidate: answer from cache now, update it for next time
async function fresh(req,name,fallback){
  const c=await caches.open(name);
  const hit=await c.match(req,{ignoreSearch:true})||(fallback&&await c.match(fallback));
  const net=fetch(req).then(res=>{   // refresh the copy we answered from, so the app address and index.html both stay current
    if(res.ok||res.type==='opaque'){ c.put(req,res.clone()); if(fallback) c.put(fallback,res.clone()); }
    return res;
  });
  if(hit){ net.catch(()=>{}); return hit; }
  return net.catch(async()=>(fallback&&await c.match(fallback))||Response.error());
}
