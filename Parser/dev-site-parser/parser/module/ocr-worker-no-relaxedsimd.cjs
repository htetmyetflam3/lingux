'use strict';

/**
 * tesseract.js worker entry point, patched to skip the WASM "relaxed SIMD"
 * core on Node.
 *
 * tesseract.js 7's relaxedsimd core has a broken/unlinked reference to
 * `tesseract::DotProductSSE` on the FLOAT LSTM path (the "best"-quality
 * traineddata this repo bundles, module/model/ocr/mya.traineddata.gz, is a
 * float model) — Emscripten replaces the missing symbol with an aborting
 * stub, so recognition crashes with:
 *
 *   RuntimeError: Aborted(missing function: _ZN9tesseract13DotProductSSEEPKfS1_i)
 *
 * Integer ("_best_int") models are unaffected (see naptha/tesseract.js#1080)
 * — this only bites float models, which is exactly the kind bundled here for
 * accuracy. There is no public API to pick a non-relaxed-SIMD core and no
 * Node 22 flag to turn relaxed SIMD off at the engine level, so the
 * documented workaround is applied here instead: hide `relaxedSimd` support
 * from `wasm-feature-detect` (by pre-seeding the require cache) before the
 * real worker-script loads and picks a core, so it falls back to the plain
 * SIMD core, which does not have this bug.
 */
const path = require('node:path');

const originalWorker = require.resolve('tesseract.js/src/worker-script/node/index.js');
const detectPath = require.resolve('wasm-feature-detect', { paths: [path.dirname(originalWorker)] });
const detect = require(detectPath);

// Must run before getCore.js is loaded — it destructures wasm-feature-detect
// at require time, so the patched cache entry has to exist first.
require.cache[detectPath].exports = { ...detect, relaxedSimd: async () => false };

require(originalWorker);
