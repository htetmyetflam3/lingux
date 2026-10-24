import { ValueError } from './pylib.mjs';

export function positiveLimit(name, fallback, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(String(raw))) {
    throw new ValueError(`${name} must be a positive integer`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ValueError(`${name} must be between 1 and ${maximum}`);
  }
  return value;
}

export const MAX_INPUT_MB = positiveLimit('UPLOAD_MAX_MB', 64, 256);
export const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
export const MAX_PAGES = positiveLimit('PRASER_MAX_PAGES', 2000, 10000);
export const MAX_TEXT_CHARS = positiveLimit('PRASER_MAX_TEXT_CHARS', 20_000_000, 100_000_000);
export const WORKER_TIMEOUT_MS = positiveLimit('PRASER_TIMEOUT_MS', 120_000, 600_000);
export const WORKER_HEAP_MB = positiveLimit('PRASER_WORKER_HEAP_MB', 384, 1024);
export const MAX_OCR_PIXELS = positiveLimit('PRASER_MAX_OCR_PIXELS', 40_000_000, 100_000_000);
