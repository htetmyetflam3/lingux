import fs from 'node:fs';
import {parsePathData} from '../snapshot/linga/Parsed/parser/shape/svg.mjs';
import {glyphSignature,contourDistance} from '../snapshot/linga/Parsed/parser/shape/contour.mjs';
import {WININNWA_LEGACY_CODE_PAGE as T0} from '../snapshot/linga/Parsed/parser/codepage/registry.mjs';
import {OUT} from './paths.mjs';
const W=JSON.parse(fs.readFileSync(`${OUT}/corrected-witnesses.json`,'utf8'));
function unpack(v){const b=Buffer.from(v.p,'base64'),u=new Uint16Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),points=[];let j=0;
 for(let c=0;c<v.c;c++){const a=[];for(let i=0;i<W.samples;i++)a.push([u[j++]/1000,u[j++]/1000]);points.push(a);}
 return{count:v.c,aspect:v.r/1000,areas:v.a.map(x=>x/1000),points};}
const faces=W.faces.map(f=>({name:f.name,byByte:new Map(Object.entries(f.bytes).map(([b,v])=>[Number(b),unpack(v)]))}));
const svg=fs.readFileSync(`${OUT}/page-input/bms-page1-a4.svg`,'utf8');
const paths=[...svg.matchAll(/<path data-font="([^"]*)" data-source-code="([^"]*)"[^>]*d="([^"]*)"\/>/g)]
  .map(m=>({code:Number(m[2]),sig:glyphSignature(parsePathData(m[3]).map(c=>c.map(([x,y])=>[x,-y])),{samples:W.samples})}));
const T=(b)=>T0.get(b)??'';
// per path: every byte claim with its best distance + votes
const claims=paths.map(p=>{
  const per=new Map();
  for(const f of faces){let bb=null,bd=Infinity;
    for(const [code,sg] of f.byByte){const d=contourDistance(p.sig,sg,{topologyPenalty:0.05,stride:1});if(d<bd){bd=d;bb=code;}}
    if(bb===null||bd>0.06)continue;
    if(!per.has(bb))per.set(bb,{votes:0,best:Infinity});const c=per.get(bb);c.votes++;if(bd<c.best)c.best=bd;}
  return [...per].map(([byte,c])=>({byte,...c}));
});
const modes={
  'current (votes, distance tiebreak)': (a,b)=>b.votes-a.votes||a.best-b.best,
  'distance first'                    : (a,b)=>a.best-b.best||b.votes-a.votes,
  'distance, votes>=2 required'       : (a,b)=>{const av=a.votes>=2?a.best:a.best+0.02,bv=b.votes>=2?b.best:b.best+0.02;return av-bv||b.votes-a.votes;},
};
for(const [name,cmp] of Object.entries(modes)){
  let s='';
  for(const c of claims){if(!c.length){s+='?';continue;}s+=T([...c].sort(cmp)[0].byte);}
  const cnt=(w)=>s.split(w).length-1;
  console.log(`\n### ${name}`);
  console.log('  ြ='+cnt('ြ')+'  ကြီး='+cnt('ကြီး')+'  ကီး='+cnt('ကီး')+'  ္က='+cnt('္က')+'  ္ဘ='+cnt('္ဘ')+'  ှ='+cnt('ှ')+'  ွ='+cnt('ွ'));
  const i=s.indexOf('ကြီး');
  console.log('  ...'+(i>=0?s.slice(Math.max(0,i-14),i+14):s.slice(150,200))+'...');
}
console.log('\ncurrent cmap output for the same span:');
const cur=fs.readFileSync('/home/user/linga/output/ယဲ့နင် စာစဉ် a ၁.merged.merged.txt','utf8');
const j=cur.indexOf('အကီးအကဲ'); console.log('  ...'+cur.slice(j-14,j+16)+'...');

console.log('\n=== the အကီး/အကြီး span, per mode (WinInnwa pre-base order) ===');
for(const [name,cmp] of Object.entries(modes)){
  let s='';
  for(const c of claims){if(!c.length){s+='?';continue;}s+=T([...c].sort(cmp)[0].byte);}
  const k=s.indexOf('ီး');
  console.log(`\n${name}`);
  console.log('  raw      : ...'+s.slice(Math.max(0,k-10),k+10)+'...');
  // pre-base reorder: move U+103C/103B/103D/103E behind the consonant that follows
  let out='',i=0;const ch=[...s];
  while(i<ch.length){
    const c=ch[i];
    if('ြျွှ'.includes(c)&&i+1<ch.length&&/[က-အ]/.test(ch[i+1])){out+=ch[i+1]+c;i+=2;continue;}
    out+=c;i++;
  }
  console.log('  reordered: ...'+out.slice(Math.max(0,out.indexOf('ီး')-10),out.indexOf('ီး')+10)+'...');
  const cnt=(w)=>out.split(w).length-1;
  console.log('  after reorder -> ကြီး='+cnt('ကြီး')+'  ကီး='+cnt('ကီး')+'  ြ total='+cnt('ြ'));
}
