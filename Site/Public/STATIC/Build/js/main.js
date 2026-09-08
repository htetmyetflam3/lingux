// progressbar.js loads from the CDN script tag in index.html (UMD bundle —
// it has no ESM exports, so a local import always failed). It sets
// window.ProgressBar, which initProgressBar() uses below.
import { logger } from "./logger.js";
import "../scss/main.scss";
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
import { Dropdown, Modal, Collapse, Offcanvas, Popover } from "bootstrap";

(function () {
	"use strict";

	const API_BASE = "/api";
	const MAX_FILE_SIZE = 10 * 1024 * 1024;
	const notyf =
		typeof Notyf !== "undefined"
			? new Notyf({
					duration: 3000,
					position: { x: "right", y: "top" },
					types: [
						{ type: "info", background: "#0d6efd", icon: false },
						{ type: "success", background: "#198754", icon: false },
						{ type: "warning", background: "#ffc107", icon: false },
						{ type: "error", background: "#dc3545", icon: false },
					],
				})
			: {
					success: (m) => console.log("[Notyf success]", m),
					error: (m) => console.log("[Notyf error]", m),
					warning: (m) => console.log("[Notyf warning]", m),
					open: (o) => console.log("[Notyf info]", o.message || o),
				};
	const ui = {
		textarea: document.getElementById("textInput"),
		emptyState: document.getElementById("emptyState"),
		fileInput: document.getElementById("hiddenFileInput"),
		browseButton: document.getElementById("browseFileButton"),
		pasteBtn: document.getElementById("pasteClipboardButton"),
		clearBtn: document.getElementById("clearButton"),
		cleanBtn: document.getElementById("formatButton"),
		checkBtn: document.getElementById("checkButton"),
		overlay: document.getElementById("dragDropOverlay"),
		uploadSection: document.getElementById("textEditorSection"),
		charCount: document.getElementById("characterCount"),
		wordCount: document.getElementById("wordCount"),
		resultsPanel: document.getElementById("resultsPanel"),
		resultsBadge: document.getElementById("resultStatusBadge"),
		resultsContent: document.getElementById("resultsContent"),
	};
	console.log("[main.js] DOM refs:", {
		textarea: !!ui.textarea,
		emptyState: !!ui.emptyState,
		fileInput: !!ui.fileInput,
		browseButton: !!ui.browseButton,
		pasteBtn: !!ui.pasteBtn,
		clearBtn: !!ui.clearBtn,
		cleanBtn: !!ui.cleanBtn,
		checkBtn: !!ui.checkBtn,
		overlay: !!ui.overlay,
		uploadSection: !!ui.uploadSection,
	});
	if (!ui.textarea || !ui.emptyState || !ui.fileInput || !ui.browseButton) {
		logger.log("ERROR:", "[main.js] Critical DOM elements missing. Aborting.");
		return;
	}
	let currentFile = null;
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	let extractedText = "";
	let isSubmitting = false;
	const pollTimer = null;
	let dragDepth = 0;
	function hasText() {
		return ui.textarea.value.trim().length > 0;
	}
	function hasFile() {
		return currentFile !== null;
	}
	function updateEmptyState() {
		const showEmpty = !hasText() && !hasFile();
		ui.emptyState.classList.toggle("d-none", !showEmpty);
	}
	function hideOverlay() {
		dragDepth = 0;
		ui.overlay.classList.add("d-none");
		ui.uploadSection.classList.remove("drag-active");
	}
	function showOverlay() {
		if (hasText() || hasFile()) {
			hideOverlay();
			return;
		}
		ui.overlay.classList.remove("d-none");
		ui.uploadSection.classList.add("drag-active");
	}
	function updateCounters() {
		const text = ui.textarea.value;
		ui.charCount.textContent = `${text.length} chars`;
		const words = text.trim() ? text.trim().split(/\s+/).length : 0;
		ui.wordCount.textContent = `${words} words`;
	}
	function refreshUI() {
		updateCounters();
		updateEmptyState();
		if (hasText() || hasFile()) {
			hideOverlay();
		}
	}
	function hideResults() {
		ui.resultsPanel.classList.add("d-none");
		ui.resultsContent.innerHTML = "";
	}
	async function copyToClipboard(text) {
		try {
			await navigator.clipboard.writeText(text);
			notyf.success("Copied to clipboard!");
		// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
		} catch (err) {
			notyf.error("Copy failed");
		}
	}
	function esc(str) {
		if (!str) return "";
		return String(str).replace(
			/[&<>"']/g,
			(m) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&#39;",
				})[m],
		);
	}
	function fileBadgeHtml(name) {
		return `
            <div class="d-flex align-items-center gap-2 p-2 mb-3 rounded bg-light border w-fit">
                <i class="bi bi-file-earmark-text text-primary"></i>
                <span class="text-truncate small fw-medium">${esc(name)}</span>
            </div>
        `;
	}
	let extractBar = null;
	function initProgressBar() {
		if (typeof ProgressBar === "undefined") {
			extractBar = null;
			return;
		}
		if (extractBar) extractBar.destroy();
		extractBar = new ProgressBar.Line("#progress-container", {
			strokeWidth: 3,
			easing: "easeInOut",
			duration: 300,
			color: "#0d6efd",
			trailColor: "#e9ecef",
			trailWidth: 3,
			svgStyle: { width: "100%", height: "6px", display: "block" },
		});
	}
	function setProgress(v) {
		if (extractBar) extractBar.set(v);
	}
	function animateProgress(v) {
		if (extractBar) extractBar.animate(v);
	}
	if (!document.getElementById("progress-container") && ui.uploadSection) {
		const wrap = document.createElement("div");
		wrap.id = "progress-container";
		wrap.style.marginTop = "0.5rem";
		ui.uploadSection.appendChild(wrap);
		initProgressBar();
	}
	function formatBurmeseText(text) {
		if (!text) return "";
		text = text.replace(/^\s*[\r\n]/gm, "");
		text = text.replace(/\s+/g, " ");
		text = text.replace(/([\u1000-\u109F])\s+([\u1000-\u109F])/g, "$1$2");
		text = text.replace(/([\u1000-\u109F])([^\u1000-\u109F\s])/g, "$1 $2");
		text = text.replace(/([^\u1000-\u109F\s])([\u1000-\u109F])/g, "$1 $2");
		text = text.replace(/။(?!\s)/g, "။ ");
		return text.trim();
	}
	function resizeTextarea() {
		const isDesktop = window.innerWidth >= 992;
		if (isDesktop) {
			ui.textarea.style.height = window.innerHeight * 0.5 + "px";
		} else {
			const remaining = window.innerHeight - 250;
			ui.textarea.style.height = Math.max(remaining, 150) + "px";
		}
	}
	const loadedScripts = {};
	function loadScript(src, globalCheck = null) {
		if (globalCheck && window[globalCheck]) return Promise.resolve();
		if (loadedScripts[src]) return loadedScripts[src];
		const p = new Promise((resolve, reject) => {
			const s = document.createElement("script");
			s.src = src;
			s.async = true;
			s.onload = resolve;
			s.onerror = () => reject(new Error("Failed to load " + src));
			document.head.appendChild(s);
		});
		loadedScripts[src] = p;
		return p;
	}
	async function extractTxt(file) {
		return await file.text();
	}
	async function extractDocx(file) {
		await loadScript(
			"https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
			"mammoth",
		);
		const mammoth = window.mammoth;
		if (!mammoth) throw new Error("Mammoth failed to load");

		const arrayBuffer = await new Promise((resolve, reject) => {
			if (file.arrayBuffer) {
				file.arrayBuffer().then(resolve).catch(reject);
			} else {
				const r = new FileReader();
				r.onload = () => resolve(r.result);
				r.onerror = () => reject(new Error("Failed to read file"));
				r.readAsArrayBuffer(file);
			}
		});
		const bytes = new Uint8Array(arrayBuffer, 0, 2);
		if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
			throw new Error(
				"Not a valid .docx file (missing ZIP header). If this is an old .doc renamed to .docx, convert it first.",
			);
		}
		const result = await mammoth.extractRawText({ arrayBuffer });
		if (result.messages?.length)
			console.warn("Mammoth warnings:", result.messages);
		return result.value;
	}
	async function extractPdf(file) {
		await loadScript(
			"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
			"pdfjsLib",
		);
		const pdfjsLib = window.pdfjsLib;
		if (!pdfjsLib) throw new Error("PDF.js failed to load");

		if (pdfjsLib.GlobalWorkerOptions) {
			pdfjsLib.GlobalWorkerOptions.workerSrc =
				"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
		}
		const arrayBuffer = await new Promise((resolve, reject) => {
			if (file.arrayBuffer) {
				file.arrayBuffer().then(resolve).catch(reject);
			} else {
				const r = new FileReader();
				r.onload = () => resolve(r.result);
				r.onerror = () => reject(new Error("Failed to read PDF"));
				r.readAsArrayBuffer(file);
			}
		});
		const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
		let text = "";
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			text += content.items.map((it) => it.str).join(" ") + "\n";
			animateProgress(i / pdf.numPages);
		}
		return text;
	}
	async function extractText(file) {
		const ext = file.name.split(".").pop().toLowerCase();
		switch (ext) {
			case "txt":
				return await extractTxt(file);
			case "docx":
				return await extractDocx(file);
			case "pdf":
				return await extractPdf(file);
			case "doc":
				return null;
			default:
				throw new Error("Unsupported file type");
		}
	}
	async function handleFile(file) {
		if (file.size > MAX_FILE_SIZE) {
			notyf.error("File too large. Maximum 10 MB allowed.");
			return;
		}
		currentFile = file;
		const ext = file.name.split(".").pop().toLowerCase();
		const progressContainer = document.getElementById("progress-container");
		if (progressContainer) progressContainer.style.display = "block";
		initProgressBar();
		setProgress(0);
		try {
			if (ext === "doc") {
				notyf.success(`${file.name} ready. Server will parse .doc.`);
				ui.textarea.value = "";
				animateProgress(1.0);
			} else {
				const text = await extractText(file);
				extractedText = text;
				ui.textarea.value = formatBurmeseText(text);
				notyf.success(`${file.name} loaded. Click Check to submit.`);
				animateProgress(1.0);
			}
			refreshUI();
		} catch (e) {
			logger.log("ERROR:", e);
			notyf.error(e.message || "Extraction failed");
			currentFile = null;
			refreshUI();
		} finally {
			setTimeout(() => {
				if (progressContainer) progressContainer.style.display = "none";
			}, 600);
		}
	}
	function resetAll() {
		currentFile = null;
		extractedText = "";
		clearTimeout(pollTimer);
		ui.textarea.value = "";
		hideResults();
		refreshUI();
		isSubmitting = false;
		ui.checkBtn.disabled = false;
	}
	async function submitText(text, originalName) {
		const res = await fetch(`${API_BASE}/submit`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text, originalName }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Submit failed");
		}
		return res.json();
	}
	async function submitFile(file, clientText) {
		const fd = new FormData();
		fd.append("file", file);
		// Browser-parsed text (mammoth / pdf.js / FileReader) travels with the
		// file so the server can skip re-parsing — the original is still
		// uploaded and silently kept for reference.
		if (clientText) fd.append("text", clientText);
		const res = await fetch(`${API_BASE}/submit`, {
			method: "POST",
			body: fd,
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Upload failed");
		}
		return res.json();
	}
	async function pollResult(formId, retries = 60) {
		if (retries <= 0) throw new Error("Result timeout");
		const res = await fetch(`${API_BASE}/result`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ formId }),
		});
		if (res.status === 404) {
			notyf.open({
				type: "info",
				message: `Processing… ${retries} attempts remaining`,
				duration: 1500,
			});
			await new Promise((r) => setTimeout(r, 2000));
			return pollResult(formId, retries - 1);
		}
		if (!res.ok) throw new Error("Result fetch failed");
		return res.json();
	}
	function renderResult(data) {
		const payload = data.data || data;
		let html = "";
		if (currentFile?.name || payload.fileName) {
			html += fileBadgeHtml(currentFile?.name || payload.fileName);
		}
		if (payload.status) {
			html += `<p class="mb-1"><strong>Status:</strong> <span class="badge bg-secondary">${esc(payload.status)}</span></p>`;
		}
		if (payload.source) {
			html += `<p class="mb-1"><strong>Source:</strong> ${esc(payload.source)}</p>`;
		}
		if (payload.createdAt) {
			html += `<p class="mb-1"><strong>Created:</strong> ${esc(payload.createdAt)}</p>`;
		}
		if (payload.grammarIssues && payload.grammarIssues.length) {
			html +=
				'<h6 class="mt-3">Issues Found:</h6><ul class="list-group list-group-flush">';
			payload.grammarIssues.forEach((issue) => {
				html += `<li class="list-group-item text-danger">${esc(issue)}</li>`;
			});
			html += "</ul>";
		} else if (payload.text) {
			html += `
                <div class="d-flex align-items-center justify-content-between mt-3 mb-2">
                    <h6 class="mb-0">Processed Text</h6>
                    <button class="btn btn-sm btn-outline-primary copy-result-btn">
                        <i class="bi bi-clipboard me-1"></i> Copy
                    </button>
                </div>
            `;
			html += `<pre id="result-text" class="bg-light p-3 rounded border">${esc(payload.text)}</pre>`;
		} else {
			html += `<pre class="bg-light p-3 rounded border mt-2">${esc(JSON.stringify(payload, null, 2))}</pre>`;
		}
		ui.resultsContent.innerHTML = html;
		const copyBtn = ui.resultsContent.querySelector(".copy-result-btn");
		if (copyBtn && payload.text) {
			copyBtn.addEventListener("click", () => copyToClipboard(payload.text));
		}
		ui.resultsBadge.className = "badge bg-success";
		ui.resultsBadge.textContent = "Done";
		ui.resultsPanel.classList.remove("d-none");
		notyf.success("Result ready!");
	}
	ui.browseButton.addEventListener("click", () => {
		logger.log("[main.js] Browse clicked");
		ui.fileInput.click();
	});
	ui.pasteBtn.addEventListener("click", async () => {
		logger.log("[main.js] Paste clicked");
		try {
			const text = await navigator.clipboard.readText();
			ui.textarea.value = text;
			refreshUI();
			notyf.success("Pasted from clipboard");
		} catch {
			notyf.error("Clipboard access denied. Paste manually (Ctrl+V).");
		}
	});
	ui.clearBtn.addEventListener("click", () => {
		logger.log("[main.js] Clear clicked");
		resetAll();
		notyf.success("Cleared");
	});
	ui.cleanBtn.addEventListener("click", () => {
		logger.log("[main.js] Format clicked");
		if (!ui.textarea.value) {
			notyf.warning("Nothing to format");
			return;
		}
		ui.textarea.value = formatBurmeseText(ui.textarea.value);
		refreshUI();
		notyf.success("Text formatted");
	});
	ui.checkBtn.addEventListener("click", async () => {
		console.log("[checkBtn] clicked, isSubmitting:", isSubmitting);
		try {
			if (isSubmitting) {
				logger.log("[checkBtn] blocked, already submitting");
				return;
			}
			const text = ui.textarea.value.trim();
			console.log(
				"[checkBtn] text length:",
				text.length,
				"currentFile:",
				!!currentFile,
			);
			if (!text && !currentFile) {
				logger.log("[checkBtn] blocked, no content");
				notyf.warning("Please type text or drop a file first.");
				return;
			}
			clearTimeout(pollTimer);
			isSubmitting = true;
			ui.checkBtn.disabled = true;
			hideResults();
			logger.log("[checkBtn] calling notyf.open...");
			notyf.open({ type: "info", message: "Submitting…", duration: 2000 });
			logger.log("[checkBtn] notyf.open done");
			let formId;
			let data;
			if (currentFile) {
				// ALWAYS upload the original file — even when the browser
				// parsed it client-side (docx/pdf/txt) — so the server
				// silently keeps a reference copy. The extracted text is
				// sent along in the 'text' field; only .doc (which the
				// browser cannot parse) goes without it.
				logger.log("[checkBtn] submitting file (+client text)...");
				data = await submitFile(currentFile, text || null);
				formId = data.formId;
			} else if (text) {
				logger.log("[checkBtn] submitting text...");
				data = await submitText(text, currentFile?.name || null);
				formId = data.formId;
			} else {
				throw new Error("Nothing to submit");
			}
			// Populate textarea with server-returned text (for .doc uploads)
			if (data?.text) {
				ui.textarea.value = formatBurmeseText(data.text);
				refreshUI();
			}
			console.log("[checkBtn] got formId:", formId);
			notyf.open({
				type: "info",
				message: `Submitted (ID: ${formId})`,
				duration: 2000,
			});
			logger.log("[checkBtn] polling result...");
			const result = await pollResult(formId);
			console.log("[checkBtn] result:", result);
			renderResult(result);
		} catch (e) {
			logger.log("ERROR:", "[checkBtn] CRASH:", e);
			logger.log("ERROR:", "[checkBtn] stack:", e.stack);
			notyf.error(e.message || "Submission failed");
			ui.resultsBadge.className = "badge bg-danger";
			ui.resultsBadge.textContent = "Error";
		} finally {
			isSubmitting = false;
			ui.checkBtn.disabled = false;
			logger.log("[checkBtn] finally, reset state");
		}
	});
	ui.textarea.addEventListener("input", () => {
		refreshUI();
	});
	ui.fileInput.addEventListener("change", async (event) => {
		const file = event.target.files?.[0];
		if (!file) return;
		currentFile = file;
		hideOverlay();
		refreshUI();
		await handleFile(file);
		event.target.value = "";
	});
	["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
		document.addEventListener(eventName, (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
	});
	document.addEventListener("dragenter", () => {
		dragDepth++;
		if (!hasText() && !hasFile()) {
			showOverlay();
		}
	});
	document.addEventListener("dragleave", () => {
		dragDepth--;
		if (dragDepth <= 0) {
			hideOverlay();
		}
	});
	document.addEventListener("drop", async (event) => {
		hideOverlay();
		const file = event.dataTransfer.files?.[0];
		if (!file) return;
		currentFile = file;
		refreshUI();
		await handleFile(file);
	});
	window.addEventListener("resize", resizeTextarea);
	refreshUI();
	resizeTextarea();
	logger.log("[main.js] Initialized successfully. All listeners attached.");
})();
