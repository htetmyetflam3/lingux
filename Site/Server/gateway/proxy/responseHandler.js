export function createOutgoingResponseHandler({ pool }) {
  return async function buildOutgoingResponse({ formId, userId }) {
    const [rows] = await pool.query(
      `SELECT submission_id, status, file_name, source, created_at, submit_id, bridge_path
			FROM submissions
			WHERE submission_id = ? AND user_id = ?`,
      [formId, userId],
    );
    if (!rows.length) return null;
    const meta = rows[0];
    return {
      formId: meta.submission_id,
      status: meta.status,
      fileName: meta.file_name,
      source: meta.source,
      createdAt: meta.created_at,
    };
  };
}
