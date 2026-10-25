// PLUGIN — thin child-process entry for the proofreading tagger.
//
// Call chain:
//   Proofreading/main/mt/quality/tag.py  (Python wrapper, stays in Proofreading)
//     -> node child process -> this plugin
//     -> Bridge/proofreading-Bridge/proofreading-tagger.mjs (proofreading-only bridge)
//     -> Engine/main native tagger (runMain / invokeWithHash)
//
// SCRATCH BUILD: every path below is a placeholder. Not wired or executed yet.
//
// usage: node --import <runtime-guard.mjs> proofreading-tag.mjs \
//          SOURCE_TEXT WORK_DIR RESULT_JSON
import fs from 'node:fs';
import path from 'node:path';

// PLACEHOLDER: real target is Bridge/proofreading-Bridge/proofreading-tagger.mjs
const PROOFREADING_BRIDGE = './placeholder/proofreading-tagger.mjs';

const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node proofreading-tag.mjs SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}

// Same guard contract the old tag-both.mjs enforced: tag.py preloads
// runtime-guard.mjs, which sets this symbol. No guard symbol -> refuse to run.
if (globalThis[Symbol.for('proofreading.scraper.wasm-only')] !== true) {
  throw new Error('Required WASM-only production guard is missing');
}

const { tagProofreading } = await import(PROOFREADING_BRIDGE);

// views: 'both' = word (raw POS) + syllable unit view in one native run.
const result = await tagProofreading({
  source: path.resolve(sourceArg),
  work: path.resolve(workArg),
  views: 'both',
});

// result.json contract kept identical to the old tag-both.mjs:
// tag.py only reads meta.raw_pos_path and meta.syllable_path.
fs.writeFileSync(
  path.resolve(resultArg),
  JSON.stringify(
    {
      raw_pos_path: result.rawPosPath,
      syllable_path: result.syllablePath,
      output_units: result.lineCount,
    },
    null,
    2,
  ) + '\n',
);
console.log(`[tagged] ${result.lineCount} units -> ${result.rawPosPath}`);
