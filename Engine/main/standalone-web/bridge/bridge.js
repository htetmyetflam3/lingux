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
//   { signature: 'public', hash }  -> syllable text for that hash
//   { signature: 'site', ...jobFields } -> later: the full Site job field set
//
// The bridge "taps" the handler for that signature; an unknown signature is
// refused. Adding a caller means adding one handler — nothing else changes.
//
// Scope: the bridge returns the SYLLABLE TEXT ONLY, as a bare string. It does
// not shape API responses and it never touches syllable POSITIONS — the
// position derivation (invokeSyllableWithHash / toPositions) is owned by
// tokenizer.js on the other side of this seam.
export class BridgeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

// tokenizer.js is a deployment-side sibling, NOT part of this bridge-only
// package, so there is no static import (a missing sibling must not stop the
// bridge loading). It is fetched lazily on the first public read; until it
// exists, validation and routing still work and only the read reports 503.
let tokenizer = null;
async function loadTokenizer() {
  if (!tokenizer) {
    try {
      // eslint-disable-next-line import/no-unresolved -- deployment seam: sibling supplied outside this package
      tokenizer = await import('../tokenizer.js');
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') {
        throw new BridgeError('bridge: tokenizer.js not installed in this deployment', 503);
      }
      throw err;
    }
  }
  return tokenizer;
}

const handlers = {
  // Public API: one hash minted at handshake, read back in a single request.
  // Returns the syllable text only (bare string). The syllable-position entry
  // point stays in tokenizer.js and is deliberately not reachable from here.
  public: async ({ hash }) => {
    const tk = await loadTokenizer();
    return tk.invokeWithHash(hash);
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
