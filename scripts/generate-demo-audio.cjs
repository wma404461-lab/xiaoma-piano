// Original additive-synthesis practice tones. No recordings or downloaded soundfonts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../public/samples'), rate = 16000, seconds = 1.5;
const voices = {yamaha:[1,0.22,0.06],steinway:[1,0.38,0.18,0.08],fluid:[1,0.12]};
let count=0,bytes=0;
for (const [bank,harmonics] of Object.entries(voices)) {
 const dir=path.join(root,bank);fs.mkdirSync(dir,{recursive:true});const manifest={};
 for(let pitch=21;pitch<=108;pitch+=(bank==='fluid'?1:3)) {
  const frequency=440*2**((pitch-69)/12), frames=Math.round(rate*seconds), wav=Buffer.alloc(44+frames*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++) {const t=i/rate;let value=0;for(let h=0;h<harmonics.length;h++)if(frequency*(h+1)<rate/2)value+=harmonics[h]*Math.sin(2*Math.PI*frequency*(h+1)*t);const envelope=Math.min(1,t/0.008)*Math.exp(-2.4*t)*Math.min(1,(seconds-t)/0.08);wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value*envelope*0.45))*32767),44+i*2);}
  const hash=crypto.createHash('sha256').update(wav).digest('hex').slice(0,12),name=`${pitch}-${hash}.wav`,url=`/samples/${bank}/${name}`;fs.writeFileSync(path.join(dir,name),wav);manifest[pitch]=bank==='fluid'?[url]:[url,url,url];count++;bytes+=wav.length;
 }
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
}
console.log(JSON.stringify({generated:true,files:count,bytes,rate,seconds,kind:'original synthesized practice tones'}));
