// Native engine boundary for the standalone web plugin.
//
// Everything web/queue lives in this plugin; the actual segmentation/tagging
// stays in Engine/main and is reached through ONE dynamic import below.
//
// SCRATCH: the specifier is an obviously-named placeholder. Real wiring in a
// later turn points it at Engine/main/init/cli.js (grammarPipeline/runMain) +
// Engine/main/init/initS.js (invokeSyllableWithHash), the same pair
// Bridge/api-server.js already drives. No path gymnastics until the dirs stop
// moving.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// PLACEHOLDER: native Engine/main entry (real target: init/cli.js + init/initS.js)
const NATIVE_ENGINE = './placeholderFor-Engine-main-native-tagger.js';

// RESULT_MIME on the Site side (analysisFinalize.js):
//   txt -> text/plain | docx -> wordprocessingml.document | pdf -> application/pdf
// The engine emits checked/segmented text, so its artifact is always txt.
const RESULT_EXTENSION = 'txt';
const RESULT_MIME = 'text/plain';

function safeStem(filename) {
  // Site result-name gate: /^[A-Za-z0-9][A-Za-z0-9._ -]{0,250}$/ and no '..'
  const stem = path.basename(String(filename ?? 'answer')).replace(/\.[^.]*$/, '');
  const cleaned = stem.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'answer';
  return cleaned;
}

/**
 * Run the native pipeline over pulled source text and return a Site-ready
 * artifact. The temp .txt is the engine-local input shape /process already
 * uses; outputs are read back by hash and deleted before return.
 */
export async function runEngineJob({ record, sourceText }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-web-'));
  const input = path.join(tmpDir, `${crypto.randomBytes(8).toString('hex')}.txt`);
  try {
    fs.writeFileSync(input, sourceText, 'utf8');

    const { grammarPipeline } = await import(NATIVE_ENGINE);
    const results = await grammarPipeline({ srcPath: input, hash: record.submitId });
    const hash = results?.[0]?.hash ?? null;
    if (!hash) throw new Error('native engine returned no result hash');

    // PLACEHOLDER reader: real target is invokeSyllableWithHash(hash) from
    // Engine/main/init/initS.js — positions/text read-back of segmented_{hash}_*
    const { readEngineResult } = await import(NATIVE_ENGINE);
    const outputText = String(await readEngineResult(hash));

    const bytes = Buffer.from(outputText, 'utf8');
    return {
      filename: `${safeStem(record.filename)}.${RESULT_EXTENSION}`,
      extension: RESULT_EXTENSION,
      mime: RESULT_MIME,
      bytes,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
