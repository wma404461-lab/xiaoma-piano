import type {Song} from "../types";
import {appAsset} from "./assets";
const CACHE="qinban-samples-v1";
const BASE=typeof document === "undefined" ? "https://example.invalid/" : new URL("./", document.baseURI).href;
const LIMIT=64*1024*1024;
const pending=new Map<string,Promise<Response>>();
const manifests=new Map<string,Promise<Record<string,string[]>>>();
let original:typeof fetch|undefined, writes=Promise.resolve(), inventory:Map<string,number>|undefined;
const samplePath=(value:string)=>{
 try {
  const url=new URL(value,BASE);
  if(url.origin!==new URL(BASE).origin)return null;
  return url.pathname.match(/\/samples\/(yamaha|steinway|fluid)\/([0-9]+(?:-[0-9]+)?-([a-f0-9]{12})\.(?:mp3|wav))$/);
 } catch {return null;}
};
export function currentOfflineVoice() {try{const value=localStorage.getItem("qinban-piano-voice");if(value&&["yamaha","steinway","fluid"].includes(value))return value;}catch{}return "yamaha";}
function canonical(path:RegExpMatchArray) {return BASE+"samples/"+path[1]+"/"+path[2];}
async function checked(response:Response,hash:string) {
  if(!response.ok||response.headers.get("content-type")?.includes("text/html"))throw new Error("Unable to load piano samples. Check your connection.");
  const data=await response.clone().arrayBuffer();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),b=>b.toString(16).padStart(2,"0")).join("");
  if(!actual.startsWith(hash))throw new Error("Piano sample verification failed. Try again online.");
  return {response:new Response(data,{headers:{"content-type":response.headers.get("content-type")||"audio/wav","content-length":String(data.byteLength)}}),bytes:data.byteLength};
}
async function persist(key:string,response:Response) {
  const task=writes.then(async()=>{
    const cache=await caches.open(CACHE);await cache.put(key,response);
    if(!inventory){inventory=new Map();for(const request of await cache.keys()){const value=await cache.match(request);inventory.set(request.url,Number(value?.headers.get("content-length")||0));}}
    inventory.delete(key);inventory.set(key,Number(response.headers.get("content-length")||0));
    let bytes=[...inventory.values()].reduce((sum,size)=>sum+size,0);
    for(const [oldest,size] of inventory){if(bytes<=LIMIT&&inventory.size<=320)break;await cache.delete(oldest);inventory.delete(oldest);bytes-=size;}
  });writes=task.catch(()=>{});await task;
}
export function installOfflineAudio() {
  if(original)return;
  original=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    const match=samplePath(url);
    if(!match||(init?.method||"GET")!=="GET")return original!(input,init);
    const key=canonical(match),signal=init?.signal;
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
    try{
      const cache=await caches.open(CACHE),stored=await cache.match(key);
      if(stored)return (await checked(stored,match[3])).response;
    }catch{/* Storage may be unavailable; retain ordinary audio playback. */}
    if(!signal&&pending.has(key))return (await pending.get(key)!).clone();
    const task=(async()=>{
      let result;
      try{result=await checked(await original!(input,init),match[3]);}
      catch(error){if(signal?.aborted)throw error;result=await checked(await original!(key,{...init,mode:"cors"}),match[3]);}
      try{await persist(key,result.response.clone());}catch{/* Playback remains usable if the disk is full. */}
      return result.response;
    })();
    if(!signal)pending.set(key,task);
    try{return (await task).clone();}finally{if(!signal)pending.delete(key);}
  };
}
async function resources(song:Song,voice=currentOfflineVoice()) {
  let manifest=manifests.get(voice);
  if(!manifest){manifest=fetch(appAsset(`/samples/${voice}/manifest.json`)).then(response=>{if(!response.ok)throw new Error("Unable to load the sample manifest");return response.json();}).catch(error=>{manifests.delete(voice);throw error;});manifests.set(voice,manifest);}
  const map=await manifest;
  const pitches=new Set(song.measures.flatMap(bar=>[...bar.right,...bar.left].flatMap(note=>note.pitches)));
  const anchors=[...pitches].map(pitch=>voice==="fluid"?pitch:Math.max(21,Math.min(108,21+Math.round((pitch-21)/3)*3)));
  return [...new Set(anchors.flatMap(pitch=>map[pitch]||[]))];
}
export async function isOfflineAudioReady(song:Song) {
  try{const list=await resources(song),cache=await caches.open(CACHE);for(const path of list){const match=samplePath(path);if(!match||!await cache.match(canonical(match)))return false;}return list.length>0;}catch{return false;}
}
export async function ensureOfflineAudio(song:Song,signal?:AbortSignal) {
  installOfflineAudio();
  const list=await resources(song);let next=0;
  await Promise.all(Array.from({length:2},async()=>{while(next<list.length){if(signal?.aborted)throw new DOMException("Cancelled","AbortError");const path=list[next++];const response=await fetch(appAsset(path),{signal});if(!response.ok)throw new Error("Unable to save offline samples. Try again online.");}}));
  if(!await isOfflineAudioReady(song))throw new Error("Unable to save samples locally. Check available storage.");
  if(typeof window!=="undefined")window.dispatchEvent(new Event("xiaoma-offline-scores"));
}
