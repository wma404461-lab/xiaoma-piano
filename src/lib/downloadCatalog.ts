import type { Song } from '../types';
import { appAsset } from './assets';
function catalogBase(value: string): string {
 try {
  if (!value.trim()) return '';
  const url = new URL(value.trim().endsWith('/') ? value.trim() : value.trim() + '/');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
  return url.href;
 } catch { return ''; }
}
const BASE = catalogBase(import.meta.env.VITE_PIANO_CATALOG_BASE ?? '');
const CACHE='xiaoma-public-catalog-v1:' + BASE;
function bytes(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export async function verifyDownloadCatalog(value:unknown,pem:string):Promise<Song[]>{
 if (!BASE) throw Error('No catalog endpoint configured');
 if(!value||typeof value!=='object')throw Error('Invalid catalog envelope');
 const e=value as {payload?:unknown;signature?:unknown};
 if(typeof e.payload!=='string'||typeof e.signature!=='string'||e.payload.length>24*1024*1024||e.signature.length>8192)throw Error('Invalid catalog signature');
 const key=await crypto.subtle.importKey('spki',bytes(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const payload=bytes(e.payload);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(e.signature),payload))throw Error('Catalog signature verification failed');
 const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
 if(d.schemaVersion!==1||d.kind!=='xiaoma-local-piano-catalog'||!Array.isArray(d.rows)||d.rows.length>20000)throw Error('Invalid catalog format');
 const ids=new Set<string>();
 return d.rows.map((v:Song)=>{
  if(!v||typeof v!=='object'||typeof v.id!=='string'||!/^disk-[a-f0-9]{16}(?:-m\d+)?$/.test(v.id)||ids.has(v.id))throw Error('Invalid catalog entry');
  ids.add(v.id);
  if(typeof v.title!=='string'||!v.title.trim()||v.title.length>300||typeof v.composer!=='string'||typeof v.subtitle!=='string'||!Array.isArray(v.skills)||v.skills.some(s=>typeof s!=='string')||![1,2,3].includes(v.level)||v.category!=='My scores'||!Number.isFinite(v.tempo)||v.tempo<=0||!Number.isFinite(v.meter)||v.meter<=0||typeof v.key!=='string'||typeof v.scoreAsset!=='string'||!v.scoreAsset.startsWith(BASE+'scores/')||!/^disk-[a-f0-9]{16}(?:-m\d+)?-[a-f0-9]{12}\.json\.gz$/.test(v.scoreAsset.slice((BASE+'scores/').length))||!v.scoreSha256||!/^[a-f0-9]{64}$/.test(v.scoreSha256))throw Error('Invalid catalog content');
  return {...v,measures:[],xml:undefined};
 });
}
export function mergeDownloadCatalog(bundled:Song[],remote:Song[],personal:Song[]=[]){
 const map=new Map(bundled.map(s=>[s.id,s]));
 for(const s of remote){const old=map.get(s.id);if(!old||old.scoreSha256!==s.scoreSha256)map.set(s.id,s);}
 for(const s of personal)map.set(s.id,s);
 return [...map.values()];
}
export async function loadDownloadCatalog(signal?:AbortSignal):Promise<Song[]>{
 if (!BASE) return [];
 const key=await fetch(appAsset('/updates/qinban_update_public.pem'),{signal});
 if(!key.ok)throw Error('Catalog verification key unavailable');const pem=await key.text();
 try{
  const response=await fetch(BASE+'catalog.json?t='+Math.floor(Date.now()/300000),{signal,cache:'no-store'});
  if(!response.ok)throw Error('Catalog unavailable');
  const text=await response.text();if(text.length>24*1024*1024)throw Error('Catalog exceeds size limit');
  const envelope=JSON.parse(text),songs=await verifyDownloadCatalog(envelope,pem);
  try{if(text.length<3*1024*1024)localStorage.setItem(CACHE,text);}catch{/* optional offline index */}
  return songs;
 }catch(error){
  if(signal?.aborted)throw error;
  try{const saved=localStorage.getItem(CACHE);if(saved)return await verifyDownloadCatalog(JSON.parse(saved),pem);}catch{/* retain bundled catalog */}
  throw error;
 }
}
