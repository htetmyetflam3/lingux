# /// script
# requires-python = ">=3.10"
# dependencies = ["json5>=0.12,<1"]
# ///
"""Read-only rule-aware MT candidate evidence and reference data audit; no API/AI calls."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import os
from difflib import SequenceMatcher

import json5

ROOT = Path(__file__).resolve().parent.parent
VERSION = 2
REFERENCE = ROOT/'content/kmt-pos/ယဲ့နင်.raw_pos.txt'
WORK = ROOT/'content/mtranslate/comparison'
PROFILE = ROOT/'content/analysis/reference-data-audit.json'
GUARD = ROOT/'scraper/wasm/box/runtime-guard.mjs'

class ComparisonError(Exception):
    pass

def identity(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode()).hexdigest()

def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def atomic_json(path, value):
    path=Path(path);path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp=tempfile.mkstemp(prefix='.comparison-',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as stream:
            json.dump(value,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def sequence_catalog(path=ROOT/'Engine/knowledge/isTreasure/mainrules.js'):
    """Extract only the supplied data array, never eval/import JavaScript."""
    text=Path(path).read_text(encoding='utf-8')
    marker=re.search(r'\bconst\s+MYANMAR_GRAMMAR_SEQUENCES\s*=\s*\[',text)
    if not marker: raise ComparisonError('Root mainrules.js has no MYANMAR_GRAMMAR_SEQUENCES data array')
    start=marker.end()-1;depth=0;quote=None;comment=None;i=start;end=None
    while i<len(text):
        c=text[i];n=text[i:i+2]
        if comment=='line':
            if c=='\n':comment=None
        elif comment=='block':
            if n=='*/':comment=None;i+=1
        elif quote:
            if c=='\\':i+=1
            elif c==quote:quote=None
        elif n=='//':comment='line';i+=1
        elif n=='/*':comment='block';i+=1
        elif c in "\"'":quote=c
        elif c=='[':depth+=1
        elif c==']':
            depth-=1
            if depth==0:end=i+1;break
        i+=1
    if end is None:raise ComparisonError('Unclosed rule sequence data array')
    try: rules=json5.loads(text[start:end])
    except ValueError:raise ComparisonError('Rule sequence array must be data-only JSON5, not executable JS') from None
    if not isinstance(rules,list):raise ComparisonError('Rule sequences must be an array')
    for item in rules:
        if not isinstance(item,dict) or not isinstance(item.get('id'),str) or not isinstance(item.get('seq'),list) or not item['seq'] or any(not isinstance(v,str) for v in item['seq']):
            raise ComparisonError('Invalid rule sequence record')
        if 'particle' in item and not isinstance(item['particle'],str):raise ComparisonError('Unsupported particle-guard schema')
    return rules

def knowledge(work=WORK):
    rules=sequence_catalog()
    extra=sorted({r['particle'] for r in rules if 'particle' in r})
    sources=['Engine/knowledge/isTreasure/master.json','Engine/knowledge/isTreasure/mainrules.js',
        'Engine/export-comparison-data.mjs','Engine/MonoSyllabism/graph/disassembler.js',
        'scraper/wasm/box/build-info.json','Engine/MonoSyllabism/map/loader.js',
        'scraper/wasm/box/host.mjs','scraper/wasm/box/runtime-guard.mjs','scraper/wasm/box/runtime-loader.mjs']
    key=identity({'version':VERSION,'sources':{name:file_hash(ROOT/name) for name in sources},'extra':extra})
    destination=Path(work)/'metadata'/f'{key}.json'
    if not destination.exists():
        extra_file=Path(work)/'metadata'/f'{key}-forms.json';atomic_json(extra_file,extra)
        destination.parent.mkdir(parents=True,exist_ok=True)
        temporary=destination.with_suffix('.tmp')
        try:
            subprocess.run(['node','--import',str(GUARD),str(ROOT/'Engine/export-comparison-data.mjs'),str(temporary),str(extra_file)],cwd=ROOT,check=True)
            os.replace(temporary,destination)
        finally: temporary.unlink(missing_ok=True)
    obj=json.loads(destination.read_text())
    obj['sequence_rules']=rules
    obj['knowledge_fingerprint']=identity({'version':VERSION,'data':obj['comparison_data_sha256'],
        'sequences':rules,'wasm':obj['wasm_sha256'],'policy':obj['policy'],
        'pos_codes':obj['pos_codes'],'evaluator':file_hash(Path(__file__))})
    obj['sources']['sequence_notes']='mainrules.js'
    obj['sources']['sequence_notes_sha256']=file_hash(ROOT/'Engine/knowledge/isTreasure/mainrules.js')
    return obj

def read_tagged(text):
    """Decode the owner's two-space raw-POS FORMAT contract, not tokenize Burmese."""
    for line_number,line in enumerate(text.splitlines(),1):
        tokens=[]
        for part in line.split('  '):
            if not part:continue
            match=re.fullmatch(r'(.*)\{([^{}]+)\}',part)
            if match:
                tags=match[2].split(',')
                if not match[1] or any(not value for value in tags):raise ComparisonError(f'Invalid raw-POS token on line {line_number}')
                tokens.append({'surface':match[1],'raw_pos':tags,'boundary':False})
            elif part.endswith('<eos>'):
                tokens.append({'surface':part.removesuffix('<eos>'),'raw_pos':[],'boundary':True})
            else:raise ComparisonError(f'Unrecognized owner raw-POS format on output line {line_number}')
        yield tokens

class Evidence:
    def __init__(self, data):
        self.data=data;self.trie={};self.bindings=data['bindings']
        for index,binding in enumerate(self.bindings):
            text=binding['normalized']
            if not text:continue
            node=self.trie
            for ch in text:node=node.setdefault(ch,{})
            node.setdefault(None,[]).append(index)
        # These describe composition and grammar, not flat aliases to raw POS.
        # A compound-first resolver is intentionally deferred until MT candidates
        # can be reviewed. Do not call n-gram windows resolved compounds/sentences.
        word_results={'compound_noun','compound_verb','compound_adj','compound_adv'}
        self.compound_rules=[r for r in data['sequence_rules'] if r.get('result') in word_results]
        self.clause_compound_rules=[r for r in data['sequence_rules'] if str(r.get('result','')).startswith('compound_') and r.get('result') not in word_results]

    def unit(self,tokens,unit_index=0):
        lexical=[]
        for start,token in enumerate(tokens):
            if token['boundary']:continue
            node=self.trie;surface=''
            for end in range(start,len(tokens)):
                if tokens[end]['boundary']:break
                value=tokens[end]['surface'];valid=True
                for ch in value:
                    if ch not in node:valid=False;break
                    node=node[ch]
                if not valid:break
                surface+=value
                for index in node.get(None,[]):
                    binding=self.bindings[index]
                    code=binding.get('pos_code')
                    lexical.append({'unit_index':unit_index,'token_start':start,'token_end':end+1,
                        'surface':surface,'binding':binding,
                        'raw_pos_support':None if code is None else code in tokens[end]['raw_pos']})
        return lexical

    def analyze(self, raw, *, samples=2, retain=0):
        totals=Counter();binding_counts=Counter();examples=defaultdict(list)
        retained=[]
        for unit_index,tokens in enumerate(read_tagged(raw)):
            totals['tagger_units']+=1
            for token in tokens:
                if token['boundary']:totals['sentence_boundaries']+=1;continue
                totals['tokens']+=1
                if token['raw_pos']==['?']:totals['unknown_tokens']+=1
                if len(token['raw_pos'])>1:totals['ambiguous_tokens']+=1
            hits=self.unit(tokens,unit_index)
            for hit in hits:
                b=hit['binding'];key=(b['source'],b['data_path'],b['normalized'])
                binding_counts[key]+=1
                if len(examples[key])<samples:
                    examples[key].append({'unit_index':unit_index,'token_start':hit['token_start'],
                        'token_end':hit['token_end'],'surface':hit['surface'],
                        'raw_pos_support':hit['raw_pos_support']})
                if len(retained)<retain:retained.append(hit)
            totals['lexical_binding_hits']+=len(hits)
            # No flat POS-window matching is used for grammar resolution.
        entries=[]
        for (source,data_path,form),count in binding_counts.most_common():
            entries.append({'source':source,'data_path':data_path,'normalized_form':form,
                'occurrences':count,'examples':examples[(source,data_path,form)]})
        return {'totals':dict(totals),'binding_occurrences':entries,
            'compound_sentence_style_resolution':'pending; lexical observations only',
            'lexical_evidence':retained,
            'evidence_truncated':totals['lexical_binding_hits']>len(retained) if retain else False}

def build_profile(data, reference=REFERENCE, destination=PROFILE):
    engine=Evidence(data)
    analysis=engine.analyze(Path(reference).read_text(encoding='utf-8'))
    report_path=Path(reference).with_name(Path(reference).name.removesuffix('.raw_pos.txt')+'.report.json')
    provenance={'status':'no matching tagger report'}
    if report_path.is_file() and report_path.resolve()!=Path(reference).resolve():
        ref_report=json.loads(report_path.read_text())
        provenance={'tag_data_match':ref_report.get('tag_data_sha256')==data['tag_data_sha256'],
            'wasm_match':ref_report.get('wasm_sha256')==data['wasm_sha256'],
            'raw_text_hash_match':ref_report.get('raw_pos_sha256')==file_hash(reference)}
        provenance['status']='matching current annotation frame' if all(provenance.values()) else 'reference frame differs or lacks metadata; observations are not a quality score'
    result={'schema_version':VERSION,'knowledge_fingerprint':data['knowledge_fingerprint'],
        'reference':str(Path(reference).resolve().relative_to(ROOT)) if Path(reference).resolve().is_relative_to(ROOT) else str(reference),
        'reference_sha256':file_hash(reference),'reference_provenance':provenance,'sources':data['sources'],
        'wasm_sha256':data['wasm_sha256'],'analysis':analysis,
        'catalog':{'grammar_sections':data['grammar_section_sizes'],'grammar_records':len(data['grammar_rules']),
            'top_bindings':sum(b['source']=='top' for b in data['bindings']),
            'rule_lexical_bindings':sum(b['source']=='rules' for b in data['bindings']),
            'resolution_single_entries':len(data['resolution']['single']),
            'sequence_records':len(data['sequence_rules']),
            'word_compound_rule_records':len(engine.compound_rules),
            'clause_compound_rule_records':len(engine.clause_compound_rules),
            'compound_rule_result_counts':dict(Counter(r['result'] for r in engine.compound_rules)),
            'sequence_evaluation':'deferred: requires compound composition before outer sentence interpretation',
            'unresolved_forms':data['unresolved']},
        'policy':data['policy'],
        'limitations':['Counts are lexical/candidate observations, not grammar judgments or accuracy.',
            'No automatic POS resolution, style substitution or rewriting was performed.',
            'Style contract: default LSE prose; quoted character speech LSN. Contextual application is pending.',
            'Sequence labels describe the composition/grammar layer; raw tag renaming is not the resolution model.',
            'No flat sequence-window counts are treated as compounds or sentence parses.',
            'Word-order constraints require governing-role analysis; not asserted as violations.',
            'No live MT, API-key configuration, phrase alignment or AI call was performed by this data audit.']}
    atomic_json(destination,result)
    return result

def surface_diff(left,right):
    changes=[]
    for op,a,b,c,d in SequenceMatcher(None,left,right,autojunk=False).get_opcodes():
        if op!='equal':changes.append({'operation':op,'direct_span':[a,b],
            'pivot_span':[c,d],'direct_text':left[a:b],'pivot_text':right[c:d]})
    return {'kind':'literal Burmese surface diff, not a semantic verdict','changed':bool(changes),'changes':changes}


def tag_burmese(text,data,work=WORK):
    # Rule/top/resolution edits invalidate comparison, not translations or POS cache.
    scripts=['Engine/tag-text.mjs','Engine/CACHE-SOURCE.json',
        'scraper/wasm/box/host.mjs','scraper/wasm/box/runtime-guard.mjs','scraper/wasm/box/runtime-loader.mjs']
    scripts += sorted(str(p.relative_to(ROOT)) for folder in ('Engine/Bridge','Engine/MonoSyllabism')
        for p in (ROOT/folder).rglob('*.js') if '/mapbuilder/' not in str(p))
    key=identity({'text':text,'tag_data':data['tag_data_sha256'],'wasm':data['wasm_sha256'],
        'scripts':{name:file_hash(ROOT/name) for name in scripts},'version':VERSION})
    cache=Path(work)/'annotations'/f'{key}.json'
    if cache.exists():
        saved=json.loads(cache.read_text())
        if saved.get('key')!=key or not isinstance(saved.get('raw_pos'),str):raise ComparisonError('Invalid annotation cache')
        return saved,True
    folder=Path(work)/'.work'/key;folder.mkdir(parents=True,exist_ok=True)
    source=folder/'burmese.txt';source.write_text(text,encoding='utf-8')
    stats=folder/'result.json'
    subprocess.run(['node','--import',str(GUARD),str(ROOT/'Engine/tag-text.mjs'),str(source),str(folder),str(stats)],cwd=ROOT,check=True)
    metadata=json.loads(stats.read_text());raw=Path(metadata['raw_pos_path']).read_text()
    value={'key':key,'raw_pos':raw,'wasm_sha256':metadata['wasm_sha256'],
        'runtime_guard':metadata['runtime_guard'],'rejected_dictionary_entries':metadata['rejected_dictionary_entries']}
    atomic_json(cache,value)
    return value,False

def compare_record(record,data,evidence,profile,work=WORK):
    try:
        unit=record['unit'];source=unit['text'];offset=unit['start'];end=unit['end']
        language=record['chinese_language']
        if language not in ('zh-Hant','zh-Hans'):raise ValueError
        if (not isinstance(source,str) or not source.strip() or type(offset) is not int or type(end) is not int
                or offset<0 or end-offset!=len(source) or not isinstance(unit['id'],str) or not unit['id']):raise ValueError
        pairs={'zh_my':(language,'my'),'zh_en':(language,'en'),'en_my':('en','my')}
        translations={leg:record[leg]['text'] for leg in pairs}
        if any(not isinstance(v,str) or not v.strip() for v in translations.values()):raise ValueError
        for leg,(src,dst) in pairs.items():
            if record[leg]['source_language']!=src or record[leg]['target_language']!=dst:raise ValueError
    except (KeyError,TypeError,ValueError):raise ComparisonError('Input must contain Chinese→Burmese, Chinese→English and English→Burmese legs') from None
    reference_counts={(row['source'],row['data_path'],row['normalized_form']):row['occurrences']
        for row in profile['analysis']['binding_occurrences']}
    candidates={}
    for name,leg in [('direct','zh_my'),('english_pivot','en_my')]:
        annotation,hit=tag_burmese(translations[leg],data,work)
        analyzed=evidence.analyze(annotation['raw_pos'],samples=1,retain=80)
        observations=[{**row,'reference_occurrences':reference_counts.get((row['source'],row['data_path'],row['normalized_form']),0),
            'interpretation':'literal observations only, not resolved grammar/style'} for row in analyzed['binding_occurrences']]
        candidates[name]={'text':translations[leg],'raw_pos':annotation['raw_pos'],
            'raw_component_analysis':analyzed,'annotation_cache_hit':hit,
            'reference_observations':observations}
    return {'unit':unit,'translations':translations,'provider':record.get('provider'),
        'pipeline':'direct-vs-english-pivot','knowledge_fingerprint':data['knowledge_fingerprint'],
        'reference_profile_sha256':identity(profile),'candidates':candidates,
        'burmese_surface_diff':surface_diff(translations['zh_my'],translations['en_my']),
        'provider_alignment':{leg:record[leg].get('alignment_projection') for leg in translations},
        'style_policy':data['policy'].get('style_policy'),
        'compound_sentence_style_resolution':'pending: component tags must be composed before outer grammar',
        'word_order_constraints':'not evaluated without composed units and governing roles',
        'phrase_alignment_status':'not_established',
        'ai':{'requests':0,'eligible':False,'reason':'Compound/context resolution and validated 1:1 phrase alignment are pending'},
        'automatic_replacements':False}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--profile',action='store_true',help='Audit the reference and supplied rule data; this is not compound/sentence resolution')
    source.add_argument('--input',type=Path,help='MT candidate JSONL; the three-route zh_my/en_my producer (init/initmt.py) is retired')
    parser.add_argument('--reference',type=Path,default=REFERENCE)
    parser.add_argument('--reference-profile',type=Path,default=PROFILE)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--work',type=Path,default=WORK)
    args=parser.parse_args(argv)
    temporary=None
    try:
        protected={args.reference.resolve(),
            ROOT/'Engine/knowledge/isTreasure/mainrules.js',ROOT/'Engine/knowledge/isTreasure/master.json'}
        protected.update(p.resolve() for p in (ROOT/'input').glob('*') if p.is_file())
        if args.input:protected.add(args.input.resolve())
        proposed=(args.output or args.reference_profile) if args.profile else (args.output or ROOT/'output/mt'/f'{args.input.stem}-comparison.jsonl')
        if proposed.resolve() in protected or args.reference_profile.resolve() in protected:
            raise ComparisonError('Analysis output must not replace source data')
        data=knowledge(args.work)
        if args.profile:
            output=(args.output or args.reference_profile).resolve()
            protected=[args.reference.resolve(),ROOT/'Engine/knowledge/isTreasure/mainrules.js',ROOT/'Engine/knowledge/isTreasure/master.json']
            if output in protected:raise ComparisonError('Profile output must not replace source data')
            result=build_profile(data,args.reference,output)
            print(f'[profile] {output}')
            print(json.dumps(result['analysis']['totals'],ensure_ascii=False,indent=2))
            return 0
        profile_path=args.reference_profile.resolve()
        profile=json.loads(profile_path.read_text()) if profile_path.exists() else None
        if not profile or profile.get('knowledge_fingerprint')!=data['knowledge_fingerprint'] or profile.get('reference_sha256')!=file_hash(args.reference):
            profile=build_profile(data,args.reference,profile_path)
        output=(args.output or ROOT/'output/mt'/f'{args.input.stem}-comparison.jsonl').resolve()
        if output in [args.input.resolve(),args.reference.resolve(),profile_path]:raise ComparisonError('Comparison output must not replace its inputs')
        output.parent.mkdir(parents=True,exist_ok=True)
        engine=Evidence(data);count=0
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=output.parent,prefix='.compare-',delete=False) as out:
            temporary=Path(out.name)
            with args.input.open(encoding='utf-8') as stream:
                for line in stream:
                    if not line.strip():continue
                    result=compare_record(json.loads(line),data,engine,profile,args.work)
                    out.write(json.dumps(result,ensure_ascii=False)+'\n');out.flush();count+=1
            if not count:raise ComparisonError('MT input contains no records')
            os.fsync(out.fileno())
        os.replace(temporary,output);temporary=None
        print(f'[comparison] {count} MT units -> {output}; API/AI requests: 0')
        return 0
    except (ComparisonError,OSError,ValueError,subprocess.CalledProcessError) as error:
        print(f'error: {error}',file=sys.stderr);return 1
    finally:
        if temporary is not None:temporary.unlink(missing_ok=True)

if __name__=='__main__':raise SystemExit(main())
