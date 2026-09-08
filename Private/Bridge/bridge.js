import { OutputFile } from "./path.js";
import { bridgeStart, bridgeEnd, bridgeLineCount } from "./logen.js";
import { createStreamWriter } from "../Syllable/mapper/context/_writer.js";
import { getBatchSize } from "../Syllable/mapper/context/_file.js";
import * as BurmeseTranslator from "../Syllable/mapper/generator/BurmeseTranslator.js";
import { runTagger } from "../Syllable/main/breaker/tagger.js";
import { runRuleEngine } from "../Syllable/main/endofmain.js";

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

async function* toLineStrings(seg) {
	let buffer = [];
	for await (const item of seg) {
		if (item === "\n") {
			yield buffer.join("√");
			buffer = [];
			continue;
		}
		const s =
			item && typeof item === "object" && item.syllable !== undefined
				? item.syllable
				: typeof item === "string"
					? item
					: null;
		if (s !== null) buffer.push(s);
	}
	if (buffer.length) yield buffer.join("√");
}

async function* batchTagger(lineGen, batchSize, hash) {
	let batch = [];
	for await (const lineStr of lineGen) {
		batch.push(lineStr);
		if (batch.length >= batchSize) {
			yield* runTagger(batch, hash);
			batch = [];
		}
	}
	if (batch.length) {
		yield* runTagger(batch, hash);
	}
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
			writers.syllable.writeLine([BurmeseTranslator.toBurmeseLine(line)]);
		});
	}

	if (writeFlags.rawPos) {
		writers.rawPos = createStreamWriter(OutputFile(), "raw_pos", batchSize);
		hooks.rawPos.tap((line) => {
			writers.rawPos.writeLine([
				BurmeseTranslator.toBurmeseLineWithPos(line, "rawPos"),
			]);
		});
	}

	const lineGen = toLineStrings(seg);
	const taggerGen = batchTagger(lineGen, batchSize, hash);
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

/* Syllable-only sibling of bridge().
   Same generator series, one link long: the writer sits at the
   segmentor instead of after the kernel, so the tagger and the rule
   engine are never constructed. Chosen by flag in runMain(), so this
   is not a second pass — it is the only pass when POS was not asked
   for. Whitespace is filtered here and only here: the √ line keeps
   its space tokens, which is what any later POS chain needs as word
   barriers. */
export async function bridgeSyllable(seg, writeFlags, hash, inputPath) {
	bridgeStart({ file: inputPath, hash });

	const batchSize = getBatchSize(inputPath);
	let writer = null;
	let lineCount = 0;

	if (writeFlags.syllable) {
		writer = createStreamWriter(OutputFile(), "syllable", batchSize);
	}

	for await (const lineStr of toLineStrings(seg)) {
		if (writer) {
			writer.writeLine([
				lineStr
					.split("√")
					.filter((t) => t.trim())
					.join("  "),
			]);
		}
		lineCount++;
		bridgeLineCount(1);
	}

	let syllablePath = null;
	if (writer) {
		writer.flush();
		syllablePath = writer.close();
	}

	bridgeEnd({ file: inputPath, lineCount });

	return { syllablePath, rawPosPath: null, lineCount, hash };
}
