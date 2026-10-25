/* stream.js — the STREAM event: reading a file as a flow.

   collector: reads a file in size-tiered chunks (buffer.js tiers), always
   slicing at '\n' so downstream never receives a chopped Burmese character.
   Yields \n-complete text blocks. (Ported from the main branch's
   R_Engine/lib/entry/streamline.js — createFsmReadStream → collector.)

   Chunk sizing is asked from buffer.js; block cutting from buffer.js too.
   This file only moves the bytes.
*/

import fs from "node:fs";
import { resolvePath } from "../../Bridge/path.js";
import { splitBuffer, getReadChunkSize } from "./buffer.js";

/**
 * Async generator: reads a file in tiered chunks, yielding only
 * '\n'-complete blocks.
 *
 * @param {string} filePath
 * @param {number|null} [highWaterMark=null] - override; null = tier by file bytes
 * @returns {AsyncGenerator<string>}
 */
export async function* collector(filePath, highWaterMark = null) {
	/* no explicit size -> tier by file bytes. Unstatable path ->
	   getReadChunkSize falls back on undefined; the open still throws. */
	let knownBytes;
	try {
		knownBytes = fs.statSync(resolvePath(filePath)).size;
	} catch {
		knownBytes = undefined;
	}
	const hwm = highWaterMark ?? getReadChunkSize(knownBytes);
	const resolved = resolvePath(filePath);

	const stream = fs.createReadStream(resolved, {
		encoding: "utf8",
		highWaterMark: hwm,
	});

	let buffer = "";
	for await (const chunk of stream) {
		buffer += chunk;
		const { lines, remainder } = splitBuffer(buffer);
		if (lines !== null) {
			yield lines;
			buffer = remainder;
		}
	}

	if (buffer.length > 0) {
		yield buffer;
	}
}

/**
 * Whole-file text read — the one-shot consumer of collector (Module A in
 * Ginit.js: it reads back the engine's own written output files). Same line
 * rules as the stream path, just concatenated.
 */
export async function readFileContent(filePath) {
	let text = "";
	for await (const chunk of collector(filePath)) {
		text += chunk;
	}
	return text;
}
