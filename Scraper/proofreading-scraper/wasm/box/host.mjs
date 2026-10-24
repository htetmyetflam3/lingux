// Required scraper WASM host. The four map sources are NEVER imported here.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WASI } from 'node:wasi';
import { isDeepStrictEqual } from 'node:util';

export class WasmBox {
  constructor(file = new URL('./box.wasm', import.meta.url),
    manifest = new URL('./build-info.json', import.meta.url)) {
    if (!fs.existsSync(file) || !fs.existsSync(manifest)) {
      throw new Error('Required rebuilt WASM is missing. Run the scraper WASM build; there is no JS/JSC fallback.');
    }
    const bytes = fs.readFileSync(file);
    const info = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== info.box_sha256) {
      throw new Error('WASM hash does not match build-info.json; rebuild WASM. No fallback is allowed.');
    }
    const module = new WebAssembly.Module(bytes);
    const loader = WebAssembly.Module.customSections(module, 'linga.loader');
    const payload = WebAssembly.Module.customSections(module, 'linga.payload');
    if (loader.length !== 1 || payload.length !== 1) throw new Error('Invalid WASM box sections');
    this.wasi = new WASI({version: 'preview1', args: [], env: {}, preopens: {}, returnOnExit: true});
    const instance = new WebAssembly.Instance(module, {wasi_snapshot_preview1: this.wasi.wasiImport});
    this.api = instance.exports;
    if (typeof this.api._start === 'function') this.wasi.start(instance);
    else this.wasi.initialize(instance);
    for (const name of ['alloc', 'boot', 'run', 'outPtr']) {
      if (typeof this.api[name] !== 'function') throw new Error(`WASM ABI is missing ${name}`);
    }
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder('utf-8', {fatal: true});
    const lb = new Uint8Array(loader[0]), pb = new Uint8Array(payload[0]);
    const status = this.api.boot(this.write(lb), lb.length, this.write(pb), pb.length);
    if (status !== 0) throw new Error(`Required WASM boot failed (${status}): ${this.error()}`);
    this.ptr = 0;
    this.capacity = 0;
  }

  write(bytes) {
    const ptr = this.api.alloc(Math.max(bytes.length, 1));
    if (!ptr) throw new Error('WASM allocation failed');
    new Uint8Array(this.api.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  }

  error() {
    const ptr = this.api.outPtr();
    if (!ptr) return 'no error details';
    const bytes = new Uint8Array(this.api.memory.buffer, ptr,
      Math.min(1200, this.api.memory.buffer.byteLength - ptr));
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  }

  run(mode, text) {
    if (![0, 1, 2, 3].includes(mode)) throw new Error(`Unknown WASM mode ${mode}`);
    const bytes = this.encoder.encode(text);
    if (bytes.length > this.capacity) {
      this.capacity = Math.max(4096, bytes.length, this.capacity * 2);
      this.ptr = this.api.alloc(this.capacity);
      if (!this.ptr) throw new Error('WASM input allocation failed');
    }
    new Uint8Array(this.api.memory.buffer, this.ptr, bytes.length).set(bytes);
    const length = this.api.run(mode, this.ptr, bytes.length);
    if (length < 0) throw new Error(`Required WASM call failed (${length}): ${this.error()}`);
    return this.decoder.decode(new Uint8Array(this.api.memory.buffer, this.api.outPtr(), length));
  }

  call(method, ...args) {
    if (['normalize', 'mapperNormalize', 'myNormalize'].includes(method)) {
      if (typeof args[0] !== 'string') throw new TypeError(`${method} requires a string`);
      // Same NFC boundary as the scraper's WASM host, not a normalizer fallback.
      args[0] = args[0].normalize('NFC');
    }
    return JSON.parse(this.run(3, JSON.stringify({method, args})));
  }
}

// One shared instance per process; consumers never create an Engine-local box.
let sharedBox;
export function getBox() {
  return sharedBox ??= new WasmBox();
}

// Compare only the map tables actually used by the sealed normalizer. Changes
// to dictionary/top/resolution do not change the compiled map algorithms.
export function assertMapData(mapData) {
  if (!mapData?.MMap || !mapData?.NewMap) throw new Error('Master is missing mapData');
  const actual = getBox().call('tables');
  const sets = new Set(['PUNCTUATION','Glue','ENGLISH_DIGITS','BURMESE_DIGITS','BLOCK_PUNCT']);
  for (const [key, value] of Object.entries(mapData)) {
    const left = sets.has(key) ? new Set(actual[key]) : actual[key];
    const right = sets.has(key) ? new Set(value) : value;
    if (!isDeepStrictEqual(left, right)) {
      throw new Error(`Master mapData.${key} differs from the built WASM. Rebuild WASM; no fallback.`);
    }
  }
}
