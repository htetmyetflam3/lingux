import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createPythonPdfParser } from './pythonPdf.js';
const execAsync = promisify(exec);

/**
 * Default .docx parser — mammoth, server-side.
 *
 * The frontend normally sends the text it already extracted, so this is the
 * fallback for callers that cannot run mammoth in a browser (agents, API
 * clients, or a client-side extraction that failed). mammoth PARSES; it does
 * not validate — the zip signature is checked before we get here, in
 * _file/magic.js.
 */
async function defaultDocxParser(filePath) {
  const { default: mammoth } = await import('mammoth');
  const { value, messages } = await mammoth.extractRawText({ path: filePath });
  if (messages?.length) {
    console.warn('[parser] mammoth warnings:', messages.slice(0, 3));
  }
  return value;
}
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
 * Backend parser.
 *
 * Frontend handles: DOCX (mammoth.js), TXT (FileReader)
 * Backend handles:  TXT, PDF (PRASER/Python — always), DOC (antiword/catdoc),
 *                   DOCX (mammoth, for callers that send no client text)
 *
 * PDF is deliberately absent from the frontend list. A PDF stores glyph ids
 * rather than text, so pdf.js returns Zawgyi/imposter output on exactly the
 * documents this site exists to handle. Server-side extraction is the only
 * authoritative route — see _file/pythonPdf.js.
 */
export function createParser({ saveOriginal, pdfParser, docParser, docxParser } = {}) {
  const _docParser = docParser || defaultDocParser;
  const _pdfParser = pdfParser || createPythonPdfParser();
  const _docxParser = docxParser || defaultDocxParser;
  return async function parseFile(file) {
    const savedPath = await saveOriginal(file);
    const ext = file.originalname.split('.').pop().toLowerCase();
    let textContent;
    if (ext === 'txt') {
      textContent = await fs.readFile(savedPath, 'utf8');
    } else if (ext === 'pdf') {
      textContent = await _pdfParser(savedPath);
    } else if (ext === 'doc') {
      textContent = await _docParser(savedPath);
    } else if (ext === 'docx') {
      textContent = await _docxParser(savedPath);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    return { textContent, savedPath, originalName: file.originalname };
  };
}
