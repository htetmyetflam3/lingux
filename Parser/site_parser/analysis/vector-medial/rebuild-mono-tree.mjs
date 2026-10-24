/* Rebuild MonoSyllabism's File/.tree/ from the encrypted master.
 *
 * Those artifacts are generated, not committed: File/.tree/ holds the
 * syllable tree, the RTL tree, the mapped rows and the reference syllable
 * list, all built by graph/build.js from MonoSyllabism/map/master.json.enc.
 * They are needed by anything that calls runSegmentor.
 *
 *   node analysis/vector-medial/rebuild-mono-tree.mjs [monoRoot]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const monoRoot = path.resolve(process.argv[2] || '.debug/mono');
process.chdir(monoRoot);

const { runBuild } = await import(pathToFileURL(path.join(monoRoot, 'MonoSyllabism/graph/build.js')).href);
const { TreeFile } = await import(pathToFileURL(path.join(monoRoot, 'Bridge/path.js')).href);

const { refArray } = await runBuild(null, TreeFile());
const fs = await import('node:fs');
console.log('built into', path.join(monoRoot, TreeFile()));
for (const f of fs.readdirSync(path.join(monoRoot, TreeFile()))) {
  console.log('  ', f, fs.statSync(path.join(monoRoot, TreeFile(), f)).size.toLocaleString(), 'bytes');
}
if (refArray) console.log('reference syllables:', refArray.length);
