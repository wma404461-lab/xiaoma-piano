// Generate an offline shell from this build only. No user files or external URLs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dist = path.resolve(__dirname, '../dist');
const files = ['index.html'];
if (fs.existsSync(path.join(dist,'icon.svg'))) files.push('icon.svg');
function walk(folder) {
  if (!fs.existsSync(folder)) return;
  for (const item of fs.readdirSync(folder, {withFileTypes:true})) {
    const full = path.join(folder,item.name);
    if (item.isDirectory()) walk(full);
    else if (/\.(?:js|css|json|wav)$/.test(item.name)) files.push(path.relative(dist,full).split(path.sep).join('/'));
  }
}
walk(path.join(dist,'assets')); walk(path.join(dist,'samples')); walk(path.join(dist,'scans')); files.sort();
const hash=crypto.createHash('sha256');
for(const file of files) {hash.update(file);hash.update(fs.readFileSync(path.join(dist,file)));}
const cache='xiaoma-piano-source-shell-'+hash.digest('hex').slice(0,16);
const worker=`// Original offline shell for Xiaoma Piano source edition.
const PREFIX="xiaoma-piano-source-shell-"+encodeURIComponent(self.registration.scope)+"-";
const CACHE=PREFIX+${JSON.stringify(cache)};
const FILES=${JSON.stringify(files)};
const ROOT=new URL('./',self.registration.scope);
const URLS=FILES.map(file=>new URL(file,ROOT).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 if(request.mode==='navigate') {
  event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match(new URL('index.html',ROOT).href)).then(response=>response||Response.error())));return;
 }
 if(!URLS.includes(url.href))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(request)).then(response=>response||fetch(request)));
});
`;
fs.writeFileSync(path.join(dist,'sw.js'),worker);
console.log('Offline shell: '+files.length+' build assets, '+cache);
