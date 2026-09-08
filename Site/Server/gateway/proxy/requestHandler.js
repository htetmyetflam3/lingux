/**
 * createreqHandler
 * Chains: validate → hold text → save raw → finalize DB.
 */
export function createInputHandler({ textHolder, metadataGuard, rawSaver }) {
  return async function handleInput({ req, formId, parsedText, quarantinePath }) {
    const source = req.file ? 'file' : 'text';
    const originalName = req.file?.originalname || null;

    // 1) Validate the formId we just created
    await metadataGuard.validateSubmission({
      userId: req.userId,
      formId,
      source,
    });

    // 2) Extract / hold text content
    const textContent = await textHolder({ req, source, parsedText });

    // 3) Save raw text to disk (no encoding, no mapping)
    const result = await rawSaver({
      formId,
      textContent,
      metadata: {
        userId: req.userId,
        visitorHash: req.visitorHash,
        source,
        originalName,
        quarantinePath,   // ← so rawSaver can copy the original file
      },
    });

    // 3b) THE SAVE GATE — and the only one.
    //
    // A submission is recorded and charged when, and only when, the raw .txt
    // exists on disk. Every route converges here, so all of them are treated
    // by the same rule at the same moment:
    //
    //   PDF     → Python extracts → txt saved → recorded + charged
    //   browser → parsed client-side → txt saved → recorded + charged
    //   .doc    → parsed server-side → txt saved → recorded + charged
    //
    // Acting any earlier bills the user for work that may still fail; acting
    // any later means a saved artifact was never paid for. The write above is
    // the first instant where the user provably got something.
    //
    // The row and the charge go in ONE transaction (commitSubmission), so a
    // half-finished submission cannot exist: either the row says 'processed'
    // and the user was charged, or neither happened.
    await metadataGuard.commitSubmission({
      userId: req.userId,
      visitorHash: req.visitorHash,
      formId,
      submitId: result.submitId,
      filename: result.filename,
      bridgePath: result.rawPath,
      originalName,
    });

    return result;
  };
}
