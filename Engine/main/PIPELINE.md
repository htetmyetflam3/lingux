# PIPELINE — the whole circle, function by function (this branch)

Text-only map of who calls whom, which file owns each function, and how the
two loops (runtime + offline build) close. Generated from the live exports —
verify against code before trusting prose.

## 1. THE RUNTIME CIRCLE (full tagger pass)

```
 File/input/input.txt
        │
        ▼  size event (asked first — no bytes of its own)
 [buffer.js]      getReadChunkSize(bytes) · splitBuffer()
        │
        ▼  read event
 [stream.js]      collector(filePath)
        │  (\n-complete blocks, utf8 — cut at \n so no Burmese char is chopped)
        ▼  input face
 [generators/input.js] readAndPrepare(inputFile)      ── normalize / mapperStr via
        │  (ASCII-space text)                            map/loader.js (payload.jsc)
        ▼  SEGMENTOR
 [lexer.js]       runSegmentor(normalizedStream)
        │            ├─ traverser.walk(block,pos)      [grapheme/traverser.js]
        │            └─ emits formatter.toSyllableToken(x)   →  "<ascii>√"
        │               emits formatter.SPACE_TOKEN          →  " √"
        │               emits "\n"  (control signal)
        ▼  assemble event
 [generators/pos-input.js / SfomatterForP.js]   fullstopHolder(seg)             ── 2-။ units; \n → " √" barrier
        │  (sentence-ish unit strings, √-suffixed)
        ▼  TAGGER
 [phonology.js]   runTagger(unitGen, hash)
        │            ├─ formatter.splitSyllables(line)   → tokens[]
        │            ├─ idmapper.burmeseToId(tok)        [map/base] (mapped.txt)
        │            ├─ walkLine()  → traverser.walkPos() → S.loaded.getPosTree()
        │            ├─ classify-number.classifyNumber() → phone/date/year/...
        │            ├─ formatter.asEos("။")             → "။<eos>"
        │            └─ formatter.mergedIds(consumedIds)
        ▼  RULE ENGINE (resolver)
 [Bridge/Ginit.js]   runRuleEngine(taggedLines, hash)
        │            finalPos = rawPos[0];  joinedIds = formatter.mergedIds(ids)
        ▼  write event
 [bridge.js]      bridge(seg, writeFlags, hash, inputPath)
        │            flush cadence ← buffer.getFlushLines(inputPath)
        │   ┌────────┴───────────────────────────────┐
        │   ▼ syllable lines                          ▼ raw-pos lines
 [formatter.js] toBurmeseLine(lineResult)      toBurmeseLineWithPos(lineResult,"rawPos")
        │   └────────┬───────────────────────────────┘
        ▼            ▼
 [disk.js]        createStreamWriter(OutputFile(), "syllable" | "raw_pos", flushLines)
        │            writes  segmented_{hash}_syllable.txt  /  segmented_{hash}_raw_pos.txt
        ▼            into  File/.output/txt/
 ── circle closes: the API reads the files back ──
 [Ginit.js]       invokeWithHash(hash)  /  invokeSyllableWithHash(hash)
        │            ├─ stream.readFileContent(file)   (back through collector)
        │            └─ formatter.toPositions(line) ← isBase()   → {index, syllable[]}
        ▼
   caller gets hash + text/positions
```

## 2. THE SYLLABLE-ONLY PASS (thin sibling)

```
 runSegmentor ──► [generators/pos-input.js / SfomatterForP.js] toLineStrings(seg)          (\n-assembler)
                ──► [disk.js]     writer.consumeSyllable()
                                   └─ formatter.toSyllableLine(line)  (√ → "  ")
                ──► bridge.bridgeSyllable() drives it;  no tagger, no rule engine
```

## 3. THE OFFLINE BUILD LOOP (feeds the circle)

```
 knowledge/isTreasure/master.json
        ├─► [mapbuilder/encrypt.json.js]  →  map/master.json.enc  +  map/secure.js   (reader, key sealed in)
        └─► [mapbuilder/obfuscator.js]    →  map/payload.jsc     +  map/loader.js    (bytecode + key-in-loader)

 [build.js] runBuild(null, treeDir)
        │      └─ S.loaded.loadSyllablesData() → streamSyllables()  (both json shapes;
        │                                        .enc via secure.readSecureText)
        │      └─ disassembler.buildSyllableLookup(syllables)
        ├─► disk.writeTreeToDir()   → File/.tree/syllable.tree.json
        ├─► disk.writeMappedToDir() → File/.tree/syllable.mapped.txt
        ├─► disk.writeRtlToDir()    → File/.tree/rtl-tree.json
        └─► disk.writeRefToDir()    → File/.tree/ref-syllables.json

 [build.js] runBuildPos(treeDir)
        │      └─ S.loaded.loadMappedRows() / S.loaded.parseJson()
        │      └─ disassembler.extractPosData() + buildPosTree()
        └─► File/.tree/pos.tree.json   (+ pos-fail.txt; prunes unmappable lines from master.json)

 runtime read-back (the circle's left shovel):
   lexer/traverser.walk      ← S.loaded.getTree()     ← syllable.tree.json
   phonology/walkPos         ← S.loaded.getPosTree()  ← pos.tree.json
   idmapper.burmeseToId      ← syllable.mapped.txt (via loadMappedRows)
```

## 4. FILE → FUNCTION TABLE

| File | Functions | Seat in the circle |
| --- | --- | --- |
| `MonoSyllabism/utilities/stream.js` | `collector`, `readFileContent` | read event: file → \n-complete blocks; whole-file read |
| `MonoSyllabism/utilities/buffer.js` | `splitBuffer`, `getReadChunkSize` (256K/512K/1M), `getFlushLines` (∞/1000/2500/5000) | size event: the only sizing tables |
| `MonoSyllabism/utilities/formatter.js` | contracts `DELIM`, `SYLLABLE_SUFFIX`(√), `SPACE_TOKEN`( √), `EOS_MARK`(<eos>) + `toSyllableToken`, `splitSyllables`, `toSyllableLine`, `asEos`, `isEosToken`, `tokenBurmese`, `tokenId`, `tokenIsBoundary`, `mergedIds`, `toBurmeseLine`, `toBurmeseLineWithPos`, `isBase`, `toPositions` | format event: every text shape in the circle |
| `MonoSyllabism/generators/pos-input.js` | `fullstopHolder`, `toLineStrings` | assemble event: piece-stream → units/lines |
| `MonoSyllabism/utilities/disk.js` | `setHash`, `resetHash` (session hash via `logen.getDateTimeHash`), `createStreamWriter`(+`consumeSyllable`), `writeTreeToDir`, `writeMappedToDir`, `writeRtlToDir`, `writeRefToDir`, `readFile`, `fileExists`, `writeFile`, `writeJson`, `appendFile`, `readLines`, `readInput` | write event: every byte that lands on disk |
| `MonoSyllabism/map/base/generators/input.js` | `readAndPrepare` | input face: normalize + ASCII-map the read blocks |
| `MonoSyllabism/main/phoneme/lexer.js` | `runSegmentor` | SEGMENTOR core (generator) |
| `MonoSyllabism/main/grapheme/traverser.js` | `walk`, `walkPos` | tree walkers used by segmentor/tagger |
| `MonoSyllabism/main/phoneme/phonology.js` | `runTagger` (private `walkLine`) | TAGGER core (generator) |
| `MonoSyllabism/main/phoneme/classify-number.js` | `classifyNumber` | number shaping for the tagger (sole copy) |
| `Bridge/Ginit.js` | `runRuleEngine` | RULE ENGINE (resolver) — pipeline-shaped, stays in Bridge |
| `Bridge/bridge.js` | `bridge`, `bridgeSyllable` | pipeline assembly: wires cores → formatters → writers |
| `MonoSyllabism/main/grapheme/Tree.loaded.js` | tree cache: `getTree`/`getRtlTree`/`getPosTree` + resets; steps: `getStepKey`, `findEntry`, `getPosStepKey`, `getPosStepData`, `hasPosStep`; readers: `streamSyllables`, `loadSyllablesData`, `loadMappedRows`, `parseJson` (secure-json wrapper) | tree-load event: everything the engine reads back |
| `MonoSyllabism/graph/disassembler.js` | `buildSyllableLookup`, `extractPosData`, `buildPosTree`, `finalizeRootSteps`, `Bb` | build math (offline) |
| `MonoSyllabism/graph/build.js` | `runBuild`, `runBuildPos` | build phase driver (offline) |
| `MonoSyllabism/map/base/generators/idmap.js` | `burmeseToId` | surface → tree id |
| `generators/input.js + lexer (kick inlined in cli.js)` | `init(inputPath, hash)`, `getCurrentHash` | kicks: `readAndPrepare → runSegmentor`; sets hash |
| `init/cli.js` | `configure`, `runBuildPhase`, `runMain`, `grammarPipeline` | entry assembly: build phase → engine → read-back |
| `init/initS.js` | `invokeWithHash`, `invokeSyllableWithHash`, `hashKind` | close of the circle: output files → API answer |
| `Bridge/logen.js` | loggers + `getDateTimeHash` (engine-hash minter) | observability + hash |
| `Bridge/path.js` | `InputFile`, `OutputFile`, `TreeFile`, `DataFile`, `MasterFile`, `resolvePath`, … | the ONLY path map (all constants live here) |
| `MonoSyllabism/mapbuilder/obfuscator.js` | (script) | seals map sources → `payload.jsc` + `loader.js` |
| `MonoSyllabism/mapbuilder/encrypt.json.js` | (script) | seals master.json → `.enc` + `secure.js` |
| `MonoSyllabism/map/loader.js`, `map/secure.js` | generated doors | gitignored; rebuild with the two scripts above |

## 5. ONE-LINE CIRCLE

`collector → readAndPrepare → runSegmentor → fullstopHolder → runTagger → runRuleEngine → bridge → (toBurmeseLine / toBurmeseLineWithPos) → createStreamWriter → segmented_{hash}_*.txt → invokeWithHash → readFileContent → toPositions → caller` — while offline `runBuild`/`runBuildPos` (fed by `loadSyllablesData` out of the sealed master) write the trees that `walk`/`walkPos` read back inside the circle.
