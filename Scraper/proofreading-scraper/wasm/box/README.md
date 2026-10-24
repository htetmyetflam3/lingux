# Required Engine WASM

Production reuses this directory’s `box.wasm` and shared `host.mjs`.
`Engine/MonoSyllabism/map/loader.js` imports `getBox()` from that host; it
does not maintain its own box, host, or build path. `getBox()` returns one
WASM instance per process for all consumers.
There is **no plaintext-JS or JSC fallback**. Production tagging installs the
`runtime-guard.mjs` preload / `runtime-loader.mjs` import hook; the worker
requires it. Plain base-module reads/imports and JSC/bytenode are rejected.
Build/stage-test commands remain separate from this production launch. The four files in
`Engine/MonoSyllabism/mapbuilder/base/` are build/stage-test inputs only.
Their algorithm bodies were not rewritten.

## Rebuild from the repository root

Build tools: Node 22+, Python with `ziglang==0.17.0`, and quickjs-ng v0.17.0.
The checked build used Node 22.22.3, Zig 0.17.0 and QuickJS commit
`6d46d07d04041b40f4f49eaa7fdebe44c314c699`.

```sh
python3 -m pip install ziglang==0.17.0
git clone --depth 1 --branch v0.17.0 https://github.com/quickjs-ng/quickjs.git /tmp/qjs-ng
QJS_SRC=/tmp/qjs-ng npm run build:wasm
```

Use the Python environment's normal install method if the system Python is
externally managed. Only the isolated WASM build package's npm dependencies
are installed, not the old site's dependencies. No Burmese NLP library is used.

The build compiles QuickJS and the C shim, packs the four sources with the
`mapData` section from `Engine/knowledge/isTreasure/master.json`, encrypts the
payload, then embeds it and the obfuscated bootstrap into the WASM capsule.
It writes `build-info.json` with input hashes, tool versions and the final
WASM SHA-256. The production host checks that hash before booting.

## ABI

The scraper ABI remains `alloc`, `boot`, `run`, `outPtr`. Modes 0/1/2 are
normalize/mapperNormalize/myNormalize. Mode 3 is a typed JSON call bridge
for the same sealed mapping/predicate functions and table snapshots needed
by the supplied tagger. Those functions execute **inside** WASM, not on Node.
Host caches store only results returned by WASM.

Plain-source stage parity checks are kept outside the repository. A separate
production check denied reads/imports of all four source files and denied
`bytenode`, while the real Engine bridge/POS builder imported and its map
functions still ran successfully. Missing or modified WASM fails closed.

DOCX extraction/tagging is wired through `uv run format/tag_docx.py`; see the
repository root `TAGGER.md` for outputs and the raw-POS limitations.
