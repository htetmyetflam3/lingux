// Engine Bridge entry — temporary home inside the standalone-web plugin's
// bridge/ dir, mirroring the future Engine/main/Bridge/ layout.
//
// The real Engine/main/Bridge (path.js / logen.js / Ginit.js plus this entry)
// is built later; this file is the entry that will merge into it. The plugin is
// a small, removable directory, so nothing here edits engine-core files. When
// the real Bridge lands this moves verbatim into Engine/main/Bridge/.
//
// Caller routing — every call carries `signature`, the field that tells the
// bridge WHO is calling, plus that caller's own fields:
//
//   { signature: 'public', hash, mode }  -> tokenizer read-back (this plugin)
//   { signature: 'site',   ...jobFields } -> later: the full Site job field set
//
// The bridge "taps" the handler for that signature; an unknown signature is
// refused. Adding a caller means adding one handler — nothing else changes.
import { invokeWithHash, invokeSyllableWithHash } from '../tokenizer.js';

export class BridgeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

const handlers = {
  // Public API: one hash minted at handshake, read back in a single request.
  public: async ({ hash, mode = 'raw' }) => {
    if (mode === 'raw') {
      return { mode, text: await invokeWithHash(hash) };
    }
    if (mode === 'syllable') {
      return { mode, positions: await invokeSyllableWithHash(hash) };
    }
    throw new BridgeError(`unknown public bridge mode: ${String(mode)}`);
  },
  // Site calls arrive later with the full job metadata field set
  // (jobToken, formId, submitId, userId, ...). Registered when that lands.
};

/**
 * Single bridge entry point. Callers pass their signature + fields and await
 * the result; read-back happens inside, so the caller's await resumes with
 * the finished payload.
 */
export async function bridgeInvoke({ hash, signature, ...fields } = {}) {
  if (typeof hash !== 'string' || !hash) {
    throw new BridgeError('bridge: hash is required');
  }
  if (typeof signature !== 'string' || !signature) {
    throw new BridgeError('bridge: signature is required');
  }
  const handler = handlers[signature];
  if (!handler) {
    throw new BridgeError(`bridge: unknown signature '${signature}'`, 404);
  }
  return handler({ hash, ...fields });
}
