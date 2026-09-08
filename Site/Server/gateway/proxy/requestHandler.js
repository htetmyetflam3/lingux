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

    // 4) Finalize submissions row
    await metadataGuard.finalizeUpload({
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
