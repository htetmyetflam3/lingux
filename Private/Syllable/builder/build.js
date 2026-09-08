/* --- builder/build.js --- */
import fs from 'fs';
import { buildStart, buildEnd, buildFail, treeBuilt } from '../../Bridge/logen.js';
import { Bb, buildSyllableLookup, buildPosTree } from './builders.js';
import { TreeFile, joinPath, DataFile } from '../../Bridge/path.js';
import { getStep, loadSyllablesData } from './_build.js';
import {
  writeTreeToDir,
  writeMappedToDir,
  writeRtlToDir,
  writeRefToDir,
} from '../mapper/context/_writer.js';
import { parseJson } from '../helper/utilities.js';

export async function runBuild(sourceData, outputDir = TreeFile()) {
  buildStart({ outputDir });

  try {
    let lookupData = sourceData;

    if (!lookupData) {
      const syllables = await loadSyllablesData();
      const result = buildSyllableLookup(syllables);
      lookupData = result.lookupData;

      writeMappedToDir(result.mappedLines, outputDir);
      writeRtlToDir(result.rtlGrouped, outputDir);
      writeRefToDir(result.refArray, outputDir);
    }

    const built = Bb(lookupData, { getStep });
    writeTreeToDir(built.data, outputDir);

    treeBuilt({ roots: Object.keys(built.data.Root).length, outputFile: outputDir });
    buildEnd({ roots: Object.keys(built.data.Root).length, outputFile: outputDir });

    return built.data;
  } catch (err) {
    buildFail({ error: err.message });
    throw err;
  }
}

export async function runBuildPos(outputDir = TreeFile()) {
  console.log(`[POS-BUILD] start: ${outputDir}`);

  try {
    const mappedPath = joinPath(outputDir, 'syllable.mapped.txt');
    if (!fs.existsSync(mappedPath)) {
      throw new Error(`Mapped file not found: ${mappedPath}. Run syllable build first.`);
    }

    const sylToId = new Map();
    fs.readFileSync(mappedPath, 'utf-8')
      .replace(/^\uFEFF/, '')
      .split('\n')
      .forEach((line, lineNum) => {
        line = line.trim();
        if (!line) return;
        const parts = line.split(':').map((p) => p.trim().replace(/^"|"$/g, ''));
        if (parts.length < 3) {
          console.error(`  Warning: Could not parse line ${lineNum + 1}: ${line}`);
          return;
        }
        const [syl, , id] = parts;
        if (!sylToId.has(syl)) {
          sylToId.set(syl, id);
        }
      });

    console.log(`[POS-BUILD] Loaded ${sylToId.size} mappings`);

    const masterPath = joinPath(DataFile(), 'master.json');
    const masterData = parseJson(masterPath);

    const posData = {};
    const source = masterData.dictionary || masterData;
    for (const [key, value] of Object.entries(source)) {
      if (key === 'syllables' || key === 'SPLIT') continue;
      if (Array.isArray(value)) posData[key] = value;
    }

    const { tree, failedEntries } = buildPosTree(sylToId, posData);

    if (failedEntries.length > 0) {
      const failPath = joinPath(outputDir, 'pos-fail.txt');
      const failLines = failedEntries.map(
        (e) => `[${e.pos}] "${e.line}" | missing: ${e.missing.join(', ')}`
      );
      fs.writeFileSync(failPath, failLines.join('\n') + '\n', 'utf8');
      console.log(`[POS-BUILD] Wrote ${failedEntries.length} failures to: ${failPath}`);
    }

    let cleaned = 0;
    const byKey = {};
    for (const e of failedEntries) {
      if (!byKey[e.jsonKey]) byKey[e.jsonKey] = new Set();
      byKey[e.jsonKey].add(e.line);
    }

    for (const [jsonKey, failedSet] of Object.entries(byKey)) {
      const originalArray = source[jsonKey];
      if (!Array.isArray(originalArray)) continue;

      const before = originalArray.length;
      const cleanedArray = originalArray.filter((line) => !failedSet.has(line));
      cleaned += (before - cleanedArray.length);
      source[jsonKey] = cleanedArray;
    }

    if (cleaned > 0) {
      fs.writeFileSync(masterPath, JSON.stringify(masterData, null, 2), 'utf8');
      console.log(`[POS-BUILD] Removed ${cleaned} failed entries from ${masterPath}`);
    }

    const posPath = joinPath(outputDir, 'pos.tree.json');
    fs.writeFileSync(posPath, JSON.stringify(tree, null, 2), 'utf8');

    console.log(`[POS-BUILD] Wrote: ${posPath}`);
    return tree;
  } catch (err) {
    console.error(`[POS-BUILD] fail: ${err.message}`);
    throw err;
  }
}
