import fs from 'node:fs';
import {parsePathData} from '../snapshot/linga/Parsed/parser/shape/svg.mjs';
import {glyphSignature,contourDistance} from '../snapshot/linga/Parsed/parser/shape/contour.mjs';
import {WININNWA_LEGACY_CODE_PAGE} from '../snapshot/linga/Parsed/parser/codepage/registry.mjs';
import {OUT} from './paths.mjs';
const W=JSON.parse(fs.readFileSync(`${OUT}/corrected-witnesses.json`,'utf8'));
function unpack(v){const b=Buffer.from(v.p,'base64'),u=new Uint16Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),points=[];let j=0;
 for(let c=0;c<v.c;c++){const a=[];for(let i=0;i<W.samples;i++)a.push([u[j++]/1000,u[j++]/1000]);points.push(a);}
 return{count:v.c,aspect:v.r/1000,areas:v.a.map(x=>x/1000),points};}
const faces=W.faces.map(f=>({name:f.name,byByte:new Map(Object.entries(f.bytes).map(([b,v])=>[Number(b),unpack(v)]))}));
// which wininnwa bytes carry U+103C ?
const raBytes=[...WININNWA_LEGACY_CODE_PAGE].filter(([,s])=>s.includes('\u103C'));
console.log('WinInnwa bytes containing U+103C (ြ):', raBytes.map(([b,s])=>`${b}:${JSON.stringify(s)}`).join('  '));
const svg=fs.readFileSync(`${OUT}/page-input/bms-page1-a4.svg`,'utf8');
const paths=[...svg.matchAll(/<path data-font="([^"]*)" data-source-code="([^"]*)"[^>]*d="([^"]*)"\/>/g)]
  .map(m=>({code:Number(m[2]),sig:glyphSignature(parsePathData(m[3]).map(c=>c.map(([x,y])=>[x,-y])),{samples:W.samples})}));
// score every byte for every path, collect best distance per byte
const table=new Map();
for(const p of paths){
  const per=new Map();
  for(const f of faces){let bb=null,bd=Infinity;
    for(const [code,sg] of f.byByte){const d=contourDistance(p.sig,sg,{topologyPenalty:0.05,stride:1});if(d<bd){bd=d;bb=code;}}
    if(bb===null||bd>0.06)continue;
    if(!per.has(bb))per.set(bb,{votes:0,best:Infinity});const c=per.get(bb);c.votes++;if(bd<c.best)c.best=bd;}
  table.set(p,[...per].map(([b,c])=>({byte:b,...c})).sort((a,b)=>b.votes-a.votes||a.best-b.best));
}
console.log('\npaths:',paths.length,'  contour-count histogram:',JSON.stringify(paths.reduce((m,p)=>(m[p.sig.count]=(m[p.sig.count]||0)+1,m),{})));
console.log('\n=== for each path: winning byte, its text, and the best RA-bearing byte ===');
let n=0;
for(const [p,rank] of table){
  if(!rank.length)continue;
  const win=rank[0], txt=WININNWA_LEGACY_CODE_PAGE.get(win.byte)??'?';
  const ra=rank.find(x=>raBytes.some(([b])=>b===x.byte));
  if(ra&&!txt.includes('\u103C')){
    n++;
    if(n<=12)console.log(`  code ${String(p.code).padStart(4)}  winner byte ${String(win.byte).padStart(3)} ${JSON.stringify(txt)} d=${win.best.toFixed(4)} votes=${win.votes}   || RA byte ${String(ra.byte).padStart(3)} ${JSON.stringify(WININNWA_LEGACY_CODE_PAGE.get(ra.byte))} d=${ra.best.toFixed(4)} votes=${ra.votes}  gap=${(ra.best-win.best).toFixed(4)}`);
  }
}
console.log('\npaths where a RA-bearing byte was in the top-5 but did NOT win:',n);
