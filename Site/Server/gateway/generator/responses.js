import crypto from 'crypto';
import path from 'path';
/**
 * Pure generator module.
 * Creates submitId and deterministic filename for disk saves.
 * submitId only exists once save succeeds.
 * No side effects. No HTTP routes.
 */
export function createResponseGenerator() {
  return {
    /**
     * Generate submitId + filename for a saved upload.
     * @param {Object} opts
     * @param {string} opts.formId      - The request identifier (from incoming.js)
     * @param {string} opts.sessionId   - Visitor hash / session id
     * @param {string} [opts.originalName] - Original uploaded filename
     * @returns {{ submitId: string, filename: string }}
     */
    // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
    generate({ formId, sessionId, originalName }) {
      const submitId = crypto.randomUUID();
      let ext = '';
      if (originalName && typeof originalName === 'string') {
        const parsed = path.parse(originalName);
        if (parsed.ext && parsed.ext.length > 1) {
          ext = parsed.ext;
        }
      }
      const filename = `${submitId}${ext}`;
      return { submitId, filename };
    },
  };
}
