// Preloaded with Node --import BEFORE the production worker's import graph.
// Four plain map sources are build/stage-test inputs only, never production code.
import fs from 'node:fs';
import { register, syncBuiltinESMExports } from 'node:module';

register(new URL('./runtime-loader.mjs', import.meta.url));

function check(file) {
  const name = String(file).replaceAll('\\', '/');
  if (name.includes('/mapbuilder/base/') || /\.jsc(?:$|[?#])/.test(name)) {
    throw new Error('WASM-only production: reading plain Engine map sources or JSC is forbidden');
  }
}

for (const name of ['readFileSync', 'readFile', 'createReadStream']) {
  const original = fs[name];
  fs[name] = function(file, ...args) {
    check(file);
    return Reflect.apply(original, this, [file, ...args]);
  };
}
const readFile = fs.promises.readFile;
fs.promises.readFile = async function(file, ...args) {
  check(file);
  return Reflect.apply(readFile, this, [file, ...args]);
};
syncBuiltinESMExports();
Object.defineProperty(globalThis, Symbol.for('proofreading.scraper.wasm-only'), {
  value: true, configurable: false, writable: false,
});
