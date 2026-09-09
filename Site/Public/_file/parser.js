import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
/**
 * Default .doc parser using antiword.
 * Falls back to catdoc if antiword is not installed.
 */
async function defaultDocParser(filePath) {
  try {
    const { stdout } = await execAsync(`antiword "${filePath}"`, {
      timeout: 30000,
    });
    return stdout;
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  } catch (antiwordErr) {
    try {
      const { stdout } = await execAsync(`catdoc "${filePath}"`, {
        timeout: 30000,
      });
      return stdout;
    } catch (catdocErr) {
      throw new Error(
        'Failed to parse .doc file. Install antiword: apt install antiword',
        { cause: catdocErr },
      );
    }
  }
}
/**
 * Backend parser for formats that cannot be handled client-side.
 *
 * Frontend handles: DOCX (mammoth.js), PDF (PDF.js), TXT (FileReader)
 * Backend handles:  TXT (fallback), PDF (fallback), DOC (antiword/catdoc)
 */
export function createParser({ saveOriginal, pdfParser, docParser } = {}) {
  const _docParser = docParser || defaultDocParser;
  return async function parseFile(file) {
    const savedPath = await saveOriginal(file);
    const ext = file.originalname.split('.').pop().toLowerCase();
    let textContent;
    if (ext === 'txt') {
      textContent = await fs.readFile(savedPath, 'utf8');
    } else if (ext === 'pdf') {
      if (!pdfParser) throw new Error('PDF parser not configured');
      textContent = await pdfParser(savedPath);
    } else if (ext === 'doc') {
      textContent = await _docParser(savedPath);
    } else if (ext === 'docx') {
      throw new Error(
        'DOCX parsing moved to frontend. Parse it client-side with mammoth.js ' +
          'and submit the file together with the extracted "text" field to /api/submit.',
      );
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    return { textContent, savedPath, originalName: file.originalname };
  };
}
