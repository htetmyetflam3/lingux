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
const claims=paths.map(p=>{const per=new Map();
  for(const f of faces){let bb=null,bd=Infinity;
    for(const [code,sg] of f.byByte){const d=contourDistance(p.sig,sg,{topologyPenalty:0.05,stride:1});if(d<bd){bd=d;bb=code;}}
    if(bb===null||bd>0.06)continue;
    if(!per.has(bb))per.set(bb,{votes:0,best:Infinity});const c=per.get(bb);c.votes++;if(bd<c.best)c.best=bd;}
  return [...per].map(([byte,c])=>({byte,...c}));});
const MED='ြျွှ', VIR='္';
function fix(s){
  const ch=[...s];let out='',i=0;
  while(i<ch.length){
    const c=ch[i];
    // medial + virama + consonant  ->  consonant + medial  (WinInnwa pre-base stack)
    if(MED.includes(c)&&ch[i+1]===VIR&&/[က-အ]/.test(ch[i+2]||'')){out+=ch[i+2]+c;i+=3;continue;}
    // medial + consonant -> consonant + medial
    if(MED.includes(c)&&/[က-အ]/.test(ch[i+1]||'')){out+=ch[i+1]+c;i+=2;continue;}
    out+=c;i++;
  }
  return out;
}
const modes={'VOTES (shipped)':(a,b)=>b.votes-a.votes||a.best-b.best,'DISTANCE':(a,b)=>a.best-b.best||b.votes-a.votes};
for(const [name,cmp] of Object.entries(modes)){
  let s='';for(const c of claims){if(!c.length){s+='?';continue;}s+=T([...c].sort(cmp)[0].byte);}
  const r=fix(s);
  const cnt=(w,x)=>x.split(w).length-1;
  console.log(`\n### ${name}  (+ pre-base fix)`);
  console.log('  ကြီး='+cnt('ကြီး',r)+'   ကီး='+cnt('ကီး',r)+'   ြ='+cnt('ြ',r)+'   ္='+cnt('္',r));
  const j=r.indexOf('ကြီး');
  if(j>=0)console.log('  span: '+JSON.stringify(r.slice(Math.max(0,j-16),j+16)));
}
const cur=fs.readFileSync('/home/user/linga/output/ယဲ့နင် စာစဉ် a ၁.merged.merged.txt','utf8').split('--- Page 2 ---')[0];
console.log('\n### CURRENT cmap (page 1)');
console.log('  ကြီး='+(cur.split('ကြီး').length-1)+'   ကီး='+(cur.split('ကီး').length-1)+'   ြ='+(cur.split('ြ').length-1));
