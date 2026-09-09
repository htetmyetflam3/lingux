import fs from 'fs/promises';
import path from 'path';
import { MyNormalize, mapperStr } from '../../../../Private/Syllable/mapper/map/map-loader.js';
import { createResponseGenerator } from './responses.js';
async function openFsmConnection({
  formId,
  submitId,
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  userId,
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  sessionId,
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  source,
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  originalPath,
}) {
  return { connected: true, formId, submitId };
}
const BRIDGE_DIR = path.join(process.cwd(), 'Encoding', 'txtinput');
const ORIGINAL_DIR = path.join(process.cwd(), 'Encoding', 'original');
function* readline(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    yield line;
  }
}
async function writeEncodedFile(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let content = '';
  for (const item of readline(text)) {
    content += item + '\n';
  }
  while (/\[([^[\]]+)\]\[([^[\]]+)\]/.test(content)) {
    content = content.replace(/\[([^[\]]+)\]\[([^[\]]+)\]/g, '[$1$2]');
  }
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function createToInputTxt({ fsmEndpoint, fsmKey }) {
  const generator = createResponseGenerator();
  return async function toinputtxt({ formId, textContent, metadata }) {
    const normalized = MyNormalize(textContent, { log: false });
    const encodedText = mapperStr(normalized);
    const { submitId, filename } = generator.generate({
      formId,
      sessionId: metadata.visitorHash,
      originalName: null,
    });
    await fs.mkdir(ORIGINAL_DIR, { recursive: true });
    await fs.writeFile(
      path.join(ORIGINAL_DIR, `${submitId}.original.txt`),
      textContent,
      'utf8',
    );
    const bridgePath = path.join(BRIDGE_DIR, filename);
    await writeEncodedFile(bridgePath, encodedText);
    const fsmHandle = await openFsmConnection({
      formId,
      submitId,
      userId: metadata.userId,
      sessionId: metadata.visitorHash,
      source: metadata.source,
      originalPath: metadata.originalName,
    });
    return { saved: true, bridgePath, submitId, filename, fsmHandle };
  };
}
