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
const svg=fs.readFileSync(`${OUT}/page-input/bms-page1-a4.svg`,'utf8');
const paths=[...svg.matchAll(/<path data-font="([^"]*)" data-source-code="([^"]*)"[^>]*d="([^"]*)"\/>/g)]
  .map(m=>({code:Number(m[2]),sig:glyphSignature(parsePathData(m[3]).map(c=>c.map(([x,y])=>[x,-y])),{samples:W.samples})}));
const T=(b)=>WININNWA_LEGACY_CODE_PAGE.get(b)??'?';
// full ranking per path
const ranks=paths.map(p=>{
  const per=new Map();
  for(const f of faces){let bb=null,bd=Infinity;
    for(const [code,sg] of f.byByte){const d=contourDistance(p.sig,sg,{topologyPenalty:0.05,stride:1});if(d<bd){bd=d;bb=code;}}
    if(bb===null||bd>0.06)continue;
    if(!per.has(bb))per.set(bb,{votes:0,best:Infinity});const c=per.get(bb);c.votes++;if(bd<c.best)c.best=bd;}
  return {p,rank:[...per].map(([b,c])=>({byte:b,...c})).sort((a,b)=>b.votes-a.votes||a.best-b.best)};
});
const seq=ranks.map(r=>r.rank.length?r.rank[0].byte:-1);
// locate အကီးအကဲ  = bytes 116(အ) 66(္ဘ) 85(္က) 68(ီ) 59(း) 116(အ) 85(္က) 74(�)
const want=[116,66,85,68,59,116,85,74];
let at=-1;
for(let i=0;i+want.length<=seq.length;i++){let ok=true;for(let k=0;k<want.length;k++)if(seq[i+k]!==want[k]){ok=false;break;}
  if(ok){at=i;break;}}
console.log('byte sequence for အကီးအကဲ found at path index:',at);
if(at>=0){
  for(let k=0;k<want.length;k++){
    const {p,rank}=ranks[at+k];
    console.log(`\n  [${k}] code ${String(p.code).padStart(4)}  contours=${p.sig.count}  -> ${JSON.stringify(T(rank[0]?.byte))}`);
    for(const c of rank.slice(0,4))
      console.log(`        byte ${String(c.byte).padStart(3)} ${JSON.stringify(T(c.byte)).padEnd(10)} d=${c.best.toFixed(4)} votes=${c.votes}${T(c.byte).includes('\u103C')?'   <== CONTAINS ြ':''}`);
  }
  // what does a real ြ- syllable look like? find ပြိုင် = ပ(121) ြ(125?) ို င်
  console.log('\n--- control: a word that DOES carry ြ (ပြိုင်) ---');
  const idx=seq.findIndex((b,i)=>b===121);
  for(let k=Math.max(0,idx);k<Math.min(ranks.length,idx+4);k++){
    const {p,rank}=ranks[k];
    if(!rank.length)continue;
    console.log(`  code ${String(p.code).padStart(4)} contours=${p.sig.count} -> ${JSON.stringify(T(rank[0].byte))}  (top: ${rank.slice(0,3).map(c=>`${c.byte}${JSON.stringify(T(c.byte))}@${c.best.toFixed(4)}/${c.votes}v`).join(', ')})`);
  }
}
