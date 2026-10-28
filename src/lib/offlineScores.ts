import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";
import type { Song, UserData } from "../types";
import {ensureOfflineAudio,isOfflineAudioReady,installOfflineAudio} from "./offlineAudio";

const DB = "xiaoma-offline-scores-v1";
const POLICY = "xiaoma-offline-policy-v1";
export const TEMP_BYTES = 16 * 1024 * 1024;
export const PIN_BYTES = 32 * 1024 * 1024;
export type OfflineEntry = {id:string; version:string; asset:string; data:Blob; digest:string; bytes:number; accessed:number; manual:boolean; automatic:boolean; row:Song};
let manual = new Set<string>(), automatic = new Set<string>();
let database: Promise<IDBDatabase> | undefined;
let writes = Promise.resolve();
let rows: Song[] = [];
const loading = new Map<string, Promise<Song>>();
const catalog = new Map<string,Song>();
let warmer:((song:Song,signal:AbortSignal)=>Promise<Song>)|undefined, warming=false;
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("xiaoma-offline-scores")); };
function policy() {
  try { const value=JSON.parse(localStorage.getItem(POLICY)||"{}"); manual=new Set(value.manual||[]); } catch { /* Optional storage. */ }
}
policy();
export function frequentSongIds(records: UserData["records"]) {
  const ranks=new Map<string,{count:number;seconds:number;last:number}>();
  records.forEach((record,index)=>{
    if (!record.songId || record.activeSeconds < 5 || record.mode === "listen") return;
    const old=ranks.get(record.songId)||{count:0,seconds:0,last:index};
    old.count++; old.seconds+=record.activeSeconds; ranks.set(record.songId,old);
  });
  return [...ranks].sort((a,b)=>b[1].count-a[1].count||b[1].seconds-a[1].seconds||a[1].last-b[1].last).slice(0,5).map(([id])=>id);
}
function db() {
  return database ??= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore("scores",{keyPath:"id"});store.createIndex("assetVersion",["asset","version"],{unique:false});store.createIndex("version","version",{unique:false});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{database=undefined;reject(request.error);};
    request.onblocked=()=>{database=undefined;reject(new Error("Local score storage is unavailable"));};
  });
}
async function all():Promise<OfflineEntry[]> {
  const opened=await db();
  return new Promise((resolve,reject)=>{const request=opened.transaction("scores").objectStore("scores").getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function get(id:string):Promise<OfflineEntry|undefined> {
  const opened=await db();
  return new Promise((resolve,reject)=>{const request=opened.transaction("scores").objectStore("scores").get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function find(asset:string,version:string,verified:boolean):Promise<OfflineEntry|undefined> {
  const opened=await db();
  return new Promise((resolve,reject)=>{const store=opened.transaction("scores").objectStore("scores");const request=verified?store.index("version").get(version):store.index("assetVersion").get([asset,version]);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function commit(keep:OfflineEntry[], removed:string[]) {
  const opened=await db();
  await new Promise<void>((resolve,reject)=>{const tx=opened.transaction("scores","readwrite"),store=tx.objectStore("scores");removed.forEach(id=>store.delete(id));keep.forEach(entry=>store.put(entry));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  rows=keep.map(entry=>entry.row);changed();
}
export function trimOfflineEntries(entries:OfflineEntry[]) {
  const pinned=entries.filter(entry=>entry.manual||entry.automatic).sort((a,b)=>Number(b.manual)-Number(a.manual)||b.accessed-a.accessed);
  const kept:OfflineEntry[]=[],removed:string[]=[];let pinnedBytes=0,tempBytes=0,tempCount=0;
  for(const entry of pinned) {
    if(pinnedBytes+entry.bytes>PIN_BYTES){if(entry.manual)throw new Error("Pinned scores exceed 32 MB. Unpin some scores first.");entry.automatic=false;}
    else {pinnedBytes+=entry.bytes;kept.push(entry);}
  }
  for(const entry of entries.filter(entry=>!entry.manual&&!entry.automatic).sort((a,b)=>b.accessed-a.accessed)) {
    if(tempBytes+entry.bytes>TEMP_BYTES||tempCount>=12)removed.push(entry.id);
    else {tempBytes+=entry.bytes;tempCount++;kept.push(entry);}
  }
  return {kept,removed};
}
function enqueue(task:()=>Promise<void>) {const next=writes.then(task);writes=next.catch(()=>{});return next;}
async function reconcile() {
  const entries=await all();entries.forEach(entry=>{entry.manual=manual.has(entry.id);entry.automatic=automatic.has(entry.id);});
  const result=trimOfflineEntries(entries);await commit(result.kept,result.removed);
}
export function syncOfflinePractice(data:Pick<UserData,"records">) {
  const next=frequentSongIds(data.records);const before=[...automatic].join("|");automatic=new Set(next);
  if(before!==next.join("|"))void enqueue(reconcile).catch(()=>{});
  void warmFrequent();
}
export async function initializeOfflineScores() {
  installOfflineAudio();
  try { const entries=await all();entries.filter(entry=>entry.manual).forEach(entry=>manual.add(entry.id));rows=entries.map(entry=>entry.row);const data=JSON.parse(localStorage.getItem("qinban-user-v1")||"{}");syncOfflinePractice({records:data.records||[]}); } catch { /* Network loading remains available. */ }
}
export function registerOfflineCatalog(incoming:Song[],loader:(song:Song,signal:AbortSignal)=>Promise<Song>) {
  incoming.forEach(song=>catalog.set(song.id,song));warmer=loader;void warmFrequent();
}
async function warmFrequent() {
  if(warming||!warmer||typeof navigator!=="undefined"&&navigator.onLine===false)return;
  warming=true;
  try {for(const id of new Set([...automatic,...manual])) {
    const song=catalog.get(id);if(!song?.scoreAsset)continue;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{const full=await warmer(song,controller.signal);await ensureOfflineAudio(full,controller.signal);}catch{/* Retry on the next catalogue refresh. */}finally{clearTimeout(timer);}
  }}finally{warming=false;}
}
export function mergeOfflineRows<T extends {id:string}>(incoming:T[]):T[] {
  const ids=new Set(incoming.map(row=>row.id));return [...incoming,...rows.filter(row=>!ids.has(row.id)) as unknown as T[]];
}
async function hash(data:Uint8Array) {return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(data).buffer)),b=>b.toString(16).padStart(2,"0")).join("");}
function metadata(song:Song,asset:string):Song {const row={...song,scoreAsset:asset,measureCount:song.measures.length,measures:[]};delete row.xml;delete row.tempoMap;return row;}
async function remember(asset:string,version:string,song:Song) {
  const data=gzipSync(strToU8(JSON.stringify(song))),digest=await hash(data);
  const entry:OfflineEntry={id:song.id,version,asset,data:new Blob([new Uint8Array(data).buffer]),digest,bytes:data.byteLength,accessed:Date.now(),manual:manual.has(song.id),automatic:automatic.has(song.id),row:metadata(song,asset)};
  await enqueue(async()=>{const entries=(await all()).filter(item=>item.id!==song.id);entries.push(entry);const result=trimOfflineEntries(entries);await commit(result.kept,result.removed);});
}
/** Cache only after the regular score loader has verified the signed catalogue checksum. */
export async function loadOfflineScore(asset:string,expected:string|undefined,signal:AbortSignal|undefined,network:()=>Promise<Song>):Promise<Song> {
  const version=expected||asset,key=asset+":"+version;
  if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
  try {
    const cached=await Promise.race([find(asset,version,!!expected),new Promise<undefined>(resolve=>setTimeout(resolve,350))]);
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
    const bytes=cached?new Uint8Array(await cached.data.arrayBuffer()):undefined;
    if(cached&&bytes&&await hash(bytes)===cached.digest) {
      const song=JSON.parse(strFromU8(gunzipSync(bytes))) as Song;
      if(song.id===cached.id&&Array.isArray(song.measures)&&song.measures.length) {
        void enqueue(async()=>{const entries=await all();const entry=entries.find(item=>item.id===cached.id&&item.version===version);if(entry)entry.accessed=Date.now();const result=trimOfflineEntries(entries);await commit(result.kept,result.removed);}).catch(()=>{});
        return song;
      }
    }
  } catch {if(signal?.aborted)throw new DOMException("Cancelled","AbortError");}
  // A request with its own cancellation signal must never be shared with another caller.
  if(!signal&&loading.has(key))return loading.get(key)!;
  const request=network().then(song=>{if(!signal?.aborted)void remember(asset,version,song).catch(()=>{});return song;});
  if(!signal)loading.set(key,request);
  try{return await request;}finally{if(!signal)loading.delete(key);}
}
export async function offlineState(id:string) {
  const entry=await get(id);const ready=entry?await isOfflineAudioReady(JSON.parse(strFromU8(gunzipSync(new Uint8Array(await entry.data.arrayBuffer()))))):false;
  return {stored:!!entry,ready,manual:manual.has(id),automatic:!!entry?.automatic};
}
export async function setOfflinePinned(song:Song,enabled:boolean) {
  const before=new Set(manual);
  if(enabled) {
    if(manual.size>=20&&!manual.has(song.id))throw new Error("You can pin up to 20 scores. Unpin some scores first.");
    const entries=await all(),existing=entries.find(entry=>entry.id===song.id);
    const bytes=existing?.bytes??gzipSync(strToU8(JSON.stringify(song))).byteLength;
    if(entries.filter(entry=>manual.has(entry.id)&&entry.id!==song.id).reduce((sum,entry)=>sum+entry.bytes,0)+bytes>PIN_BYTES)throw new Error("Pinned scores exceed 32 MB. Unpin some scores first.");
    await ensureOfflineAudio(song);
    manual.add(song.id);
    try {if(!existing)await remember(song.scoreAsset||`inline:${song.id}`,song.scoreSha256||song.scoreAsset||`inline:${song.id}`,song);await enqueue(reconcile);}
    catch(error){manual=before;throw error;}
    void navigator.storage?.persist?.().catch(()=>{});
  } else {manual.delete(song.id);try{await enqueue(reconcile);}catch(error){manual=before;throw error;}}
  try {localStorage.setItem(POLICY,JSON.stringify({manual:[...manual]}));}catch{/* IndexedDB pin remains for this session. */}
  changed();
}
export async function clearTemporaryScores() {await enqueue(async()=>{const entries=await all();await commit(entries.filter(entry=>entry.manual||entry.automatic),entries.filter(entry=>!entry.manual&&!entry.automatic).map(entry=>entry.id));});}
export async function offlineUsage() {const entries=await all();return {bytes:entries.reduce((sum,e)=>sum+e.bytes,0),pinned:entries.filter(e=>e.manual||e.automatic).length,temporary:entries.filter(e=>!e.manual&&!e.automatic).length};}
