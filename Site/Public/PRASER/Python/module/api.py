"""Bare JSON API (Flask) — meant to be called by a Node.js backend.

    GET  /health                                            -> {"ok": true}
    POST /api/preview   multipart: file=<pdf>               -> JSON preview
    POST /api/finalize  form: job_id=..., apply=0|1, fmt=txt|docx|pdf -> download

The preview returns per-page detection info plus a list of cleanup changes
(original vs suggested with inline HTML diff).  The Node backend forwards this
JSON to the frontend; the user's single apply/skip choice comes back to
/api/finalize as apply=1|0.
"""

import os
import uuid
import tempfile
import threading

from pipeline import load_detector, process_pdf_bytes, build_final_pages, render_texts

_JOBS = {}
_JOBS_LOCK = threading.Lock()
_JOBS_MAX = 50


def create_app():
    from flask import Flask, request, jsonify, send_file

    app = Flask(__name__)
    detector = load_detector()

    def _store_job(job):
        jid = uuid.uuid4().hex
        with _JOBS_LOCK:
            _JOBS[jid] = job
            # keep only the newest _JOBS_MAX jobs
            if len(_JOBS) > _JOBS_MAX:
                for old in list(_JOBS.keys())[:- _JOBS_MAX]:
                    _JOBS.pop(old, None)
        return jid

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/api/preview")
    def preview():
        f = request.files.get("file")
        if f is None or not f.filename:
            return jsonify({"error": "multipart field 'file' is required"}), 400
        if not f.filename.lower().endswith(".pdf"):
            return jsonify({"error": "only .pdf files are supported"}), 400

        try:
            job = process_pdf_bytes(f.read(), detector, filename=f.filename,
                                    log=lambda m: None)
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400

        jid = _store_job(job)
        return jsonify({
            "job_id": jid,
            "filename": job["filename"],
            "pages": len(job["reports"]),
            "counts": job["counts"],
            "metadata": job["metadata"],
            "total_changes": len(job["changes"]),
            "changes": job["changes"],
        })

    @app.post("/api/finalize")
    def finalize():
        jid = (request.form.get("job_id") or "").strip()
        apply_raw = (request.form.get("apply") or "0").strip().lower()
        fmt = (request.form.get("fmt") or "txt").strip().lower().lstrip(".")
        apply_cleanup = apply_raw in ("1", "true", "yes", "y", "apply")

        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if job is None:
            return jsonify({"error": "unknown or expired job_id"}), 404
        if fmt not in ("txt", "docx", "pdf"):
            return jsonify({"error": "fmt must be one of txt|docx|pdf"}), 400

        base = os.path.splitext(job["filename"])[0] or "output"
        tmp = tempfile.NamedTemporaryFile(suffix=f".{fmt}", delete=False)
        tmp.close()
        try:
            pages = build_final_pages(job, apply_cleanup)
            render_texts(tmp.name, pages, job["counts"], job["filename"])
        except Exception as e:  # noqa: BLE001
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            return jsonify({"error": str(e)}), 400

        download_name = f"{base}_cleaned.{'docx' if fmt == 'docx' else fmt}"
        return send_file(tmp.name, as_attachment=True, download_name=download_name)

    return app
