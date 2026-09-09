"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface ResultPayload {
  formId?: string;
  status?: string;
  source?: string;
  fileName?: string | null;
  text?: string;
  grammarIssues?: string[];
  createdAt?: string | null;
}

interface ToastItem {
  id: number;
  type: "success" | "error" | "warning" | "info";
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(str: string | null | undefined): string {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m] ?? m
  );
}

function formatBurmeseText(text: string): string {
  if (!text) return "";
  text = text.replace(/^\s*[\r\n]/gm, "");
  text = text.replace(/\s+/g, " ");
  text = text.replace(/([\u1000-\u109F])\s+([\u1000-\u109F])/g, "$1$2");
  text = text.replace(/([\u1000-\u109F])([^\u1000-\u109F\s])/g, "$1 $2");
  text = text.replace(/([^\u1000-\u109F\s])([\u1000-\u109F])/g, "$1 $2");
  text = text.replace(/။(?!\s)/g, "။ ");
  return text.trim();
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = [".txt", ".doc", ".docx", ".pdf"];

// ── Toast hook ───────────────────────────────────────────────────────────────
let _toastId = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback(
    (type: ToastItem["type"], message: string, duration = 3000) => {
      const id = ++_toastId;
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    []
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}

// ── Script loader ────────────────────────────────────────────────────────────
const loadedScripts: Record<string, Promise<void>> = {};

function loadScript(src: string, globalCheck?: string): Promise<void> {
  if (globalCheck && (window as unknown as Record<string, unknown>)[globalCheck]) {
    return Promise.resolve();
  }
  const cached = loadedScripts[src];
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
  loadedScripts[src] = p;
  return p;
}

async function extractTxt(file: File): Promise<string> {
  return file.text();
}

async function extractDocx(file: File): Promise<string> {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
    "mammoth"
  );
  const mammoth = (window as unknown as { mammoth: { extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string; messages: unknown[] }> } }).mammoth;
  if (!mammoth) throw new Error("Mammoth failed to load");
  const ab = await file.arrayBuffer();
  const bytes = new Uint8Array(ab, 0, 2);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Not a valid .docx file — if this is an old .doc, convert it first.");
  }
  const result = await mammoth.extractRawText({ arrayBuffer: ab });
  return result.value;
}

async function extractPdf(
  file: File,
  onProgress?: (v: number) => void
): Promise<string> {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "pdfjsLib"
  );
  const pdfjsLib = (window as unknown as {
    pdfjsLib: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: { str: string }[] }>;
        }>;
      }> };
    };
  }).pdfjsLib;

  if (!pdfjsLib) throw new Error("PDF.js failed to load");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
    onProgress?.(i / pdf.numPages);
  }
  return text;
}

async function extractText(
  file: File,
  onProgress?: (v: number) => void
): Promise<string | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "txt":
      return extractTxt(file);
    case "docx":
      return extractDocx(file);
    case "pdf":
      return extractPdf(file, onProgress);
    case "doc":
      return null; // server handles
    default:
      throw new Error("Unsupported file type");
  }
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function HomePage() {
  const { toasts, push, dismiss } = useToast();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultStatus, setResultStatus] = useState<"none" | "processing" | "done" | "error">("none");
  const [resultData, setResultData] = useState<ResultPayload | null>(null);

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const hasContent = text.trim().length > 0 || currentFile !== null;

  // ── File handling ──
  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        push("error", "File too large. Maximum 10 MB allowed.");
        return;
      }
      setCurrentFile(file);
      setShowProgress(true);
      setProgress(0);
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      try {
        if (ext === "doc") {
          push("info", `${file.name} ready. Server will parse .doc.`);
          setText("");
          setProgress(100);
        } else {
          const extracted = await extractText(file, (v) =>
            setProgress(Math.round(v * 90))
          );
          setText(formatBurmeseText(extracted ?? ""));
          setProgress(100);
          push("success", `${file.name} loaded. Click Check to submit.`);
        }
      } catch (e) {
        push("error", (e as Error).message || "Extraction failed");
        setCurrentFile(null);
      } finally {
        setTimeout(() => setShowProgress(false), 700);
      }
    },
    [push]
  );

  const removeFile = useCallback(() => {
    setCurrentFile(null);
    setText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Drag & drop ──
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", prevent);
    return () => {
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", prevent);
    };
  }, []);

  const handleDragEnter = useCallback(() => {
    setDragDepth((d) => {
      const next = d + 1;
      if (!hasContent) setIsDragOver(true);
      return next;
    });
  }, [hasContent]);

  const handleDragLeave = useCallback(() => {
    setDragDepth((d) => {
      const next = d - 1;
      if (next <= 0) setIsDragOver(false);
      return Math.max(next, 0);
    });
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setDragDepth(0);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await handleFile(file);
    },
    [handleFile]
  );

  // ── Clipboard ──
  const handlePaste = useCallback(async () => {
    try {
      const t = await navigator.clipboard.readText();
      setText(t);
      push("success", "Pasted from clipboard");
    } catch {
      push("error", "Clipboard access denied. Paste manually (Ctrl+V).");
    }
  }, [push]);

  const handleCopy = useCallback(async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      push("success", "Copied to clipboard!");
    } catch {
      push("error", "Copy failed");
    }
  }, [push]);

  // ── Reset ──
  const handleClear = useCallback(() => {
    setCurrentFile(null);
    setText("");
    setResultStatus("none");
    setResultData(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    push("info", "Cleared");
  }, [push]);

  // ── Format ──
  const handleFormat = useCallback(() => {
    if (!text) { push("warning", "Nothing to format"); return; }
    setText(formatBurmeseText(text));
    push("success", "Text formatted");
  }, [text, push]);

  // ── Submit ──
  const handleCheck = useCallback(async () => {
    if (isSubmitting) return;
    const trimmedText = text.trim();
    if (!trimmedText && !currentFile) {
      push("warning", "Please type text or drop a file first.");
      return;
    }

    setIsSubmitting(true);
    setResultStatus("processing");
    setResultData(null);
    push("info", "Submitting…", 2000);

    try {
      let formId: string;
      let serverText: string | undefined;

      if (currentFile) {
        const fd = new FormData();
        fd.append("file", currentFile);
        if (trimmedText) fd.append("text", trimmedText);
        const res = await fetch("/api/submit", { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Upload failed");
        }
        const data = await res.json() as { formId: string; text?: string };
        formId = data.formId;
        serverText = data.text;
      } else {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmedText }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Submit failed");
        }
        const data = await res.json() as { formId: string; text?: string };
        formId = data.formId;
        serverText = data.text;
      }

      if (serverText) setText(formatBurmeseText(serverText));

      push("info", `Submitted (ID: ${formId})`, 2000);

      // Poll
      let retries = 30;
      let result: { data: ResultPayload } | null = null;
      while (retries-- > 0) {
        const res = await fetch("/api/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formId }),
        });
        if (res.status === 404) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        if (!res.ok) throw new Error("Result fetch failed");
        result = await res.json() as { data: ResultPayload };
        break;
      }

      if (!result) throw new Error("Result timeout");

      setResultData(result.data);
      setResultStatus("done");
      push("success", "Result ready!");
    } catch (e) {
      push("error", (e as Error).message ?? "Submission failed");
      setResultStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, text, currentFile, push]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toast container */}
      <div className="pf-toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pf-toast ${t.type}`}
            onClick={() => dismiss(t.id)}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="pf-header">
        <div className="pf-logo">
          <div className="pf-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <path d="M9 15l2 2 4-4"/>
            </svg>
          </div>
          paperflow
        </div>
        <div className="pf-badge">
          <span className="pf-badge-dot" />
          Free to try · no account
        </div>
      </header>

      {/* Hero */}
      <section className="pf-hero">
        {/* Left */}
        <div className="pf-hero-left">
          <div className="pf-hero-label">Myanmar Grammar, Checked Properly</div>
          <h1 className="pf-hero-title">
            Make paper<br />
            <span className="move">move.</span>
          </h1>
          <p className="pf-hero-desc">
            Drop a document or type Burmese text — Paperflow cleans, formats, and checks your grammar in seconds.
          </p>
          <div className="pf-social-proof">
            <div className="pf-avatars">
              <div className="pf-avatar">AK</div>
              <div className="pf-avatar">JM</div>
              <div className="pf-avatar">RS</div>
            </div>
            <span className="pf-social-text">Loved by people who care about good writing.</span>
          </div>
        </div>

        {/* Right — Editor */}
        <div className="pf-editor-section">
          <div
            className={`pf-editor-card${isDragOver ? " drag-active" : ""}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            {/* Drag overlay */}
            <div className={`pf-drag-overlay${isDragOver ? " visible" : ""}`}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div className="pf-drag-overlay-text">Drop file here</div>
            </div>

            {/* Empty state — shown when no text and no file */}
            {!hasContent && (
              <div className="pf-empty-state">
                <div className="pf-upload-icon-wrap">
                  <div className="pf-upload-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                </div>
                <h3 className="pf-empty-title">Drop or paste your text</h3>
                <p className="pf-empty-subtitle">
                  Drag &amp; drop a file, browse, or paste text<br />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "var(--text-light)" }}>
                    Supported: .txt · .docx · .pdf · .doc
                  </span>
                </p>
                <div className="pf-btn-row">
                  <button
                    className="pf-btn-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Browse file
                  </button>
                  <button className="pf-btn-secondary" onClick={handlePaste}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                    </svg>
                    Paste
                  </button>
                </div>
                <p className="pf-upload-hint">Max 10 MB · .txt .docx .pdf .doc</p>
              </div>
            )}

            {/* File badge */}
            {currentFile && (
              <div className="pf-file-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span className="pf-file-badge-name">{currentFile.name}</span>
                <button className="pf-file-badge-remove" onClick={removeFile} title="Remove file">×</button>
              </div>
            )}

            {/* Progress bar */}
            {showProgress && (
              <div className="pf-progress-wrap">
                <div className="pf-progress-bar" style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Textarea */}
            <div className="pf-textarea-wrap">
              <textarea
                ref={textareaRef}
                className="pf-textarea"
                placeholder="Type or paste text here… or drop a file above."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            {/* Toolbar */}
            <div className="pf-toolbar">
              <div className="pf-toolbar-left">
                <button
                  className="pf-tool-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Browse file"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Upload
                </button>
                <button className="pf-tool-btn" onClick={handlePaste} title="Paste clipboard">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                  Paste
                </button>
                <button className="pf-tool-btn" onClick={handleFormat} title="Format Burmese text">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="21" y1="10" x2="7" y2="10"/>
                    <line x1="21" y1="6" x2="3" y2="6"/>
                    <line x1="21" y1="14" x2="3" y2="14"/>
                    <line x1="21" y1="18" x2="7" y2="18"/>
                  </svg>
                  Format
                </button>
                <button className="pf-tool-btn danger" onClick={handleClear} title="Clear all">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6"/>
                    <path d="M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                  Clear
                </button>
              </div>
              <button
                className="pf-check-btn"
                onClick={handleCheck}
                disabled={isSubmitting || !hasContent}
              >
                {isSubmitting ? (
                  <>Checking…</>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Check
                  </>
                )}
              </button>
            </div>

            {/* Stats */}
            <div className="pf-stats">
              <span>{charCount} chars</span>
              <span>·</span>
              <span>{wordCount} words</span>
            </div>
          </div>

          {/* Results */}
          {resultStatus !== "none" && (
            <div className="pf-results">
              <div className="pf-results-header">
                <span className="pf-results-title">Grammar Check Result</span>
                <span
                  className={`pf-results-badge ${
                    resultStatus === "processing"
                      ? "processing"
                      : resultStatus === "done"
                      ? "done"
                      : "error"
                  }`}
                >
                  {resultStatus === "processing"
                    ? "Processing…"
                    : resultStatus === "done"
                    ? "Done"
                    : "Error"}
                </span>
              </div>

              {resultData && (
                <div className="pf-results-body">
                  {/* File badge */}
                  {(currentFile?.name || resultData.fileName) && (
                    <div className="pf-result-file-badge">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span>{esc(currentFile?.name ?? resultData.fileName ?? "")}</span>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="pf-result-meta" style={{ marginBottom: 16 }}>
                    {resultData.status && (
                      <p>
                        <strong>Status:</strong>{" "}
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            background: "var(--teal)",
                            color: "white",
                            borderRadius: 20,
                            fontSize: 12,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {esc(resultData.status)}
                        </span>
                      </p>
                    )}
                    {resultData.source && (
                      <p style={{ marginTop: 6 }}>
                        <strong>Source:</strong> {esc(resultData.source)}
                      </p>
                    )}
                    {resultData.createdAt && (
                      <p style={{ marginTop: 6 }}>
                        <strong>Created:</strong>{" "}
                        {new Date(resultData.createdAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {/* Issues */}
                  {resultData.grammarIssues && resultData.grammarIssues.length > 0 ? (
                    <>
                      <h6
                        style={{
                          fontFamily: "'DM Serif Display', serif",
                          fontSize: 18,
                          marginBottom: 10,
                          color: "var(--text-dark)",
                        }}
                      >
                        Issues Found
                      </h6>
                      <ul className="pf-issues-list">
                        {resultData.grammarIssues.map((issue, i) => (
                          <li key={i}>{esc(issue)}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {/* Processed text */}
                  {resultData.text && (
                    <>
                      <div className="pf-result-text-wrap" style={{ marginTop: resultData.grammarIssues?.length ? 20 : 0 }}>
                        <span className="pf-result-text-label">Processed Text</span>
                        <button
                          className="pf-result-copy-btn"
                          onClick={() => handleCopy(resultData.text ?? "")}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                          </svg>
                          Copy
                        </button>
                      </div>
                      <pre className="pf-result-pre">{resultData.text}</pre>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Formats Section */}
      <section className="pf-formats-section">
        <div className="pf-formats-header">
          <h2 className="pf-formats-title">
            One document.<br />Four good directions.
          </h2>
          <p className="pf-formats-desc">
            No settings maze. Just clean, checked text ready to get on with the rest of your work.
            Supports .txt, .docx, .pdf, and legacy .doc files.
          </p>
        </div>
        <div className="pf-format-grid">
          <div className="pf-format-card active">
            <div className="pf-format-label">Most Loved</div>
            <div className="pf-format-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div className="pf-format-name">DOCX</div>
            <div className="pf-format-desc">For edits, comments, and making it yours.</div>
          </div>
          <div className="pf-format-card">
            <div className="pf-format-label">Keep Writing</div>
            <div className="pf-format-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div className="pf-format-name">DOC</div>
            <div className="pf-format-desc">The classic, still dependable.</div>
          </div>
          <div className="pf-format-card">
            <div className="pf-format-label">Just the Words</div>
            <div className="pf-format-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7V4h16v3"/>
                <path d="M9 20h6"/>
                <path d="M12 4v16"/>
              </svg>
            </div>
            <div className="pf-format-name">TXT</div>
            <div className="pf-format-desc">Simple text. Zero distractions.</div>
          </div>
          <div className="pf-format-card">
            <div className="pf-format-label">Stay Portable</div>
            <div className="pf-format-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <path d="M9 13h6"/>
                <path d="M9 17h6"/>
              </svg>
            </div>
            <div className="pf-format-name">PDF</div>
            <div className="pf-format-desc">All the shape, none of the locked-in.</div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="pf-footer">
        <span>Made carefully for Myanmar text. © {new Date().getFullYear()}</span>
        <div className="pf-footer-links">
          <a href="#">Privacy, in plain English</a>
          <a href="#">Need a hand?</a>
        </div>
      </footer>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          await handleFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}