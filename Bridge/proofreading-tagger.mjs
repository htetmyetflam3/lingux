// PROOFREADING-SPECIFIC BRIDGE.
//
// Sits next to the core engine bridge (bridge.js) but is intentionally a
// separate module: proofreading-only concerns (cache seeding, master audit,
// both-views stats) never bloat the core bridge. This module's only job is
// to translate the proofreading request onto the NATIVE Engine/main tagger.
//
// SCRATCH BUILD: every path below is a placeholder. Not wired or executed yet.

// PLACEHOLDER: native tagger entry points
//   runMain       -> Engine/main/init/cli.js
//   invokeWithHash -> Engine/main/init/initS.js
const NATIVE_TAGGER = './placeholder/Engine/main/init/cli.js';
const NATIVE_READER = './placeholder/Engine/main/init/initS.js';

// PLACEHOLDER: proofreading data inputs (final layout TBD — see the
// .cache-tree / CACHE-SOURCE.json hash mismatch noted during study)
const MASTER_JSON = './placeholder/master.json';
const CACHE_TREE = './placeholder/.cache-tree';
const CACHE_SOURCE = './placeholder/CACHE-SOURCE.json';

async function seedCache(work) {
  // TODO(real wiring): verify each CACHE_TREE file against CACHE_SOURCE.sha256,
  // copy them into work/tree, copy MASTER_JSON into work/data/master.json —
  // the setup the old Proofreading tag-both.mjs performed per run.
  return work;
}

/**
 * @param {{source:string, work:string, views?:'both'|'syllable'}} request
 * @returns {Promise<{hash:string, rawPosPath:string|null, syllablePath:string, lineCount:number}>}
 */
export async function tagProofreading({ source, work, views = 'both' }) {
  await seedCache(work);

  const { runMain } = await import(NATIVE_TAGGER);
  const { invokeWithHash } = await import(NATIVE_READER);

  // Native tagger flag mapping:
  //   views 'both'     -> writePos:true  (raw POS word view + syllables)
  //   views 'syllable' -> writePos:false (old units.mjs behavior, tagger never built)
  const writePos = views === 'both';

  const [hash] = await runMain({
    srcPath: source,
    writeSyllable: true,
    writePos,
  });

  return {
    hash,
    rawPosPath: writePos ? await invokeWithHash(hash) : null,
    // PLACEHOLDER: native syllable output read-back (reader TBD during wiring)
    syllablePath: `./placeholder/segmented_${hash}_syllable.txt`,
    // TODO(real wiring): take lineCount from the native run result
    lineCount: 0,
  };
}
