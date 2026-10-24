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
const reorder=(s)=>{let out='',i=0;const ch=[...s];
  while(i<ch.length){const c=ch[i];
    if('ြျွှ'.includes(c)&&i+1<ch.length&&/[က-အ]/.test(ch[i+1])){out+=ch[i+1]+c;i+=2;continue;}
    out+=c;i++;}return out;};
const modes={ 'VOTES (shipped)':(a,b)=>b.votes-a.votes||a.best-b.best,
              'DISTANCE':(a,b)=>a.best-b.best||b.votes-a.votes,
              'DIST + votes>=2':(a,b)=>{const av=a.votes>=2?a.best:a.best+0.02,bv=b.votes>=2?b.best:b.best+0.02;return av-bv||b.votes-a.votes;} };
for(const [name,cmp] of Object.entries(modes)){
  let s='';for(const c of claims){if(!c.length){s+='?';continue;}s+=T([...c].sort(cmp)[0].byte);}
  const r=reorder(s);
  const i=r.indexOf('ကီး');
  console.log(`\n${name}`);
  console.log('  around ကီး (reordered):', i>=0?JSON.stringify(r.slice(Math.max(0,i-12),i+12)):'(ကီး not found)');
  const j=r.indexOf('ကြီး');
  console.log('  around ကြီး           :', j>=0?JSON.stringify(r.slice(Math.max(0,j-12),j+12)):'(ကြီး not found)');
}
