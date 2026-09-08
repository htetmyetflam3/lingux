// FILE: Server/log/httpLog.js
//
// Morgan, wearing the engine's colours.
//
// The Site was printing morgan's stock "dev" format while everything else in
// the system — every logen line the engine and the API emit — used the badge
// palette. Two visual languages in one terminal, so HTTP traffic read as
// foreign noise instead of part of the same run.
//
// This renders access lines through logen's own exports (palette, badges,
// timestamp), so there is ONE definition of the colours. Change a code in
// logen and this follows automatically.
//
// Shape matches logen exactly:
//
//   {timestamp}  HTTP    SUCCESS  GET /api/quota | 200 | 2ms | 92B
//   └ dim grey   └ badge └ status └ method+path  └ coloured by status class

import morgan from 'morgan';
import { palette as C, moduleBadges, statusColors, stamp } from '../../../Private/Bridge/logen.js';

// Honour the de-facto standard, but default to colour: logen colours
// unconditionally and this is meant to sit in the same stream.
const useColor = !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `${code}${text}${C.rst}` : String(text));

/** HTTP status class → the same level vocabulary logen already uses. */
function levelFor(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (status >= 300) return 'info';
  if (status >= 200) return 'success';
  return 'processing';
}

/** Method gets its own tint so GET/POST are scannable at a glance. */
const METHOD_COLOR = {
  GET: C.method,
  POST: C.string,
  PUT: C.warn,
  PATCH: C.warn,
  DELETE: C.err,
  OPTIONS: C.comment,
  HEAD: C.comment,
};

function humanSize(bytes) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Console access logger in logen's style.
 * Drop-in replacement for morgan('dev').
 */
export function createHttpConsoleLogger() {
  return morgan((tokens, req, res) => {
    const status = Number(tokens.status(req, res)) || 0;
    const level = levelFor(status);
    const clr = statusColors[level] || C.info;

    const badge = moduleBadges.HTTP || moduleBadges.SYSTEM;
    const badgeStr = useColor
      ? `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`
      : `[${badge.label}]`;

    const method = tokens.method(req, res) || '-';
    const url = tokens.url(req, res) || '-';
    const ms = Number(tokens['response-time'](req, res));
    const len = Number(tokens.res(req, res, 'content-length'));

    // Slow requests earn the warn tint even when they succeeded — a 200 that
    // took two seconds is the thing worth spotting in a wall of green.
    const timeColor = ms >= 1000 ? C.err : ms >= 250 ? C.warn : C.num;
    const bar = paint(C.op, '|');

    return [
      paint(C.comment, stamp()),
      badgeStr,
      paint(`${clr}${C.bold}`, level.toUpperCase().padEnd(7)),
      paint(METHOD_COLOR[method] || C.var, method),
      paint(C.string, url),
      bar,
      paint(clr, status || '---'),
      bar,
      paint(timeColor, Number.isFinite(ms) ? `${ms.toFixed(1)}ms` : '-'),
      bar,
      paint(C.comment, humanSize(len)),
    ].join(' ');
  });
}

/**
 * File access logger — plain 'combined', never coloured.
 * ANSI escapes in a log file are noise for grep and for anything that parses
 * it later, so the colours stop at the terminal.
 */
export function createHttpFileLogger(stream) {
  return morgan('combined', { stream });
}
