import { OutputFile } from "./path.js";
import { bridgeStart, bridgeEnd, bridgeLineCount } from "./logen.js";
import { createStreamWriter } from "./store.js";
import { getBatchSize } from "../monoSyllabism/main/grapheme/loaded.js";
import { toBurmeseLine, toBurmeseLineWithPos, toLineStrings } from "./readable.js";
import { runTagger } from "../monoSyllabism/main/phoneme/phonology.js";
import { runRuleEngine } from "../monoSyllabism/main/endofmain.js";

class Hook {
	constructor(name) {
		this.name = name;
		this.taps = [];
	}
	tap(fn) {
		this.taps.push(fn);
	}
	async call(data) {
		for (const fn of this.taps) {
			await fn(data);
		}
	}
}

class BridgeHooks {
	constructor() {
		this.syllable = new Hook("syllable");
		this.rawPos = new Hook("rawPos");
	}
}

/* Holder behind the segmentor (tagger path only): pieces arrive
   √-suffixed from the segmentor — pure concat, no array, no join.
   A unit completes at the SECOND ။ core (suffix stripped before the
   test, so a ။ inside a masked {...} span can't split early). \n
   becomes a " √" barrier (never a boundary). Trailing fragment
   without two stops still emits at EOF; a barrier-only tail is out. */
async function* fullstopHolder(seg) {
	let unit = "";
	let stops = 0;
	let hasContent = false;
	for await (const item of seg) {
		if (item === "\n") {
			unit += " √";
			continue;
		}
		if (typeof item !== "string") continue;
		unit += item;
		const core = item.endsWith("√") ? item.slice(0, -1) : item;
		if (core === "။") {
			stops++;
			hasContent = true;
			if (stops >= 2) {
				yield unit;
				unit = "";
				stops = 0;
				hasContent = false;
			}
		} else if (core.trim() !== "") {
			hasContent = true;
		}
	}
	if (unit && hasContent) yield unit;
}

export async function bridge(seg, writeFlags, hash, inputPath) {
	bridgeStart({ file: inputPath, hash });

	const batchSize = getBatchSize(inputPath);
	const hooks = new BridgeHooks();
	const writers = {};
	let lineCount = 0;

	if (writeFlags.syllable) {
		writers.syllable = createStreamWriter(OutputFile(), "syllable", batchSize);
		hooks.syllable.tap((line) => {
			writers.syllable.writeLine([toBurmeseLine(line)]);
		});
	}

	if (writeFlags.rawPos) {
		writers.rawPos = createStreamWriter(OutputFile(), "raw_pos", batchSize);
		hooks.rawPos.tap((line) => {
			writers.rawPos.writeLine([
				toBurmeseLineWithPos(line, "rawPos"),
			]);
		});
	}

	const unitGen = fullstopHolder(seg);
	const taggerGen = runTagger(unitGen, hash);
	const kernelGen = runRuleEngine(taggerGen, hash);

	for await (const lineResult of kernelGen) {
		await hooks.syllable.call(lineResult);
		await hooks.rawPos.call(lineResult);

		lineCount++;
		bridgeLineCount(1);
	}

	const paths = {};
	for (const [name, writer] of Object.entries(writers)) {
		writer.flush();
		paths[`${name}Path`] = writer.close();
	}

	bridgeEnd({ file: inputPath, lineCount });

	return {
		syllablePath: paths.syllablePath ?? null,
		rawPosPath: paths.rawPosPath ?? null,
		lineCount,
		hash,
	};
}

/* Syllable-only sibling of bridge(). Thin by design: the writer consumes
   the segmentor generator directly (store.js consumeSyllable, formatting
   in readable.js) — the tagger and the rule engine are never constructed.
   Assembly differs on purpose: \n lines here vs two-fullstop units in
   bridge() (fullstopHolder) — the tagger needs sentence boundaries, the
   syllable file mirrors input lines. Chosen by flag in runMain(), so this
   is not a second pass — it is the only pass when POS was not asked
   for. Whitespace is filtered in toSyllableLine and only there. */
export async function bridgeSyllable(seg, writeFlags, hash, inputPath) {
	bridgeStart({ file: inputPath, hash });

	const batchSize = getBatchSize(inputPath);
	let syllablePath = null;
	let lineCount = 0;

	if (writeFlags.syllable) {
		const writer = createStreamWriter(OutputFile(), "syllable", batchSize);
		lineCount = await writer.consumeSyllable(seg);
		syllablePath = writer.close();
	} else {
		/* No writer: still drain the segmentor so lineCount stays honest. */
		for await (const line of toLineStrings(seg)) {
			if (typeof line === "string") lineCount++;
		}
	}

	bridgeLineCount(lineCount);
	bridgeEnd({ file: inputPath, lineCount });

	return { syllablePath, rawPosPath: null, lineCount, hash };
}
