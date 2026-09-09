import fs from 'fs/promises';
import path from 'path';
import { createResponseGenerator } from './responses.js';
import { RAW_TXT_DIR, ORIGINAL_DIR } from '../../../Site/Public/_file/paths.js';

// Raw text + original copies land inside the PRASER python project
// (.../PRASER/Python/.output/txt and .../.output/original — leading dot on
// purpose, matching the private engine's path constants) — the engine pulls
// them via /api/hidden/raw/:submitId.
export function createRawSaver() {
  const generator = createResponseGenerator();

  return async function saveRaw({ formId, textContent, metadata }) {
    const { submitId, filename } = generator.generate({
      formId,
      sessionId: metadata.visitorHash,
      originalName: metadata.originalName,
    });

    await fs.mkdir(RAW_TXT_DIR, { recursive: true });
    await fs.mkdir(ORIGINAL_DIR, { recursive: true });

    // raw extracted text
    const rawPath = path.join(RAW_TXT_DIR, `${submitId}.txt`);
    await fs.writeFile(rawPath, textContent, 'utf8');

    // original upload (copy from quarantine)
    let originalPath = null;
    if (metadata.originalName) {
      originalPath = path.join(ORIGINAL_DIR, `${submitId}_${metadata.originalName}`);
      if (metadata.quarantinePath) {
        await fs.copyFile(metadata.quarantinePath, originalPath);
      }
    }

    return {
      saved: true,
      rawPath,
      originalPath,
      submitId,
      filename,
      rawUrlPath: `/api/hidden/raw/${submitId}`,
    };
  };
}
