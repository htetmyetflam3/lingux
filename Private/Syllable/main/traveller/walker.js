/* --- main/traveller/walker.js --- */
import { getStepKey, findEntry, getTree, getRtlTree } from './_walk.js';
import { walkReverse } from './reverse_walker.js';
import {
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  walkerStart, walkerEnd,
  walkStepHit, walkStepEmpty, walkQuit, walkFail, walkOutputSyllables,
} from '../../../Bridge/logen.js';

export function walk(block, startPos) {
  const tree = getTree();
  const reverseTree = getRtlTree();
  const rootTok = block[startPos];
  const rootNode = tree.Root?.[rootTok];

  if (!rootNode) {
    walkFail('no-root-node');
    return { endPos: startPos + 1, lastValidPos: startPos + 1, id: null };
  }

  walkerStart({ pos: startPos, ch: rootTok });

  let readPos = startPos + 1;
  let step = 1;
  let lastSafePos = startPos + 1;
  let currentId = null;
  let emitSyllable = block[startPos];
  let acc = block[startPos];

  while (true) {
    const stepKey = getStepKey(rootNode, step);
    const stepData = rootNode[stepKey];
    const match = findEntry(stepData, block, readPos);

    if (!match) {
      walkQuit('no-match');
      walkOutputSyllables(emitSyllable ? 1 : 0);
      return { endPos: lastSafePos, lastValidPos: lastSafePos, id: currentId };
    }

    const tok = match.tok;
    readPos += match.len;
    acc += tok;

    const ids = match.entry[tok];
    const hasIds = Array.isArray(ids) && ids.length > 0;

    if (hasIds) {
      const rev = walkReverse(reverseTree, acc, rootTok);
      if (rev.action === 'continue' && rev.id) {
        lastSafePos = readPos;
        currentId = rev.id;
        emitSyllable = acc;
      }
    }

    if (hasIds) {
      walkStepHit(rootTok, step);
    } else {
      walkStepEmpty(rootTok, step);
    }

    if (stepKey === 'St-F') {
      walkQuit('stf');
      walkOutputSyllables(emitSyllable ? 1 : 0);
      return { endPos: lastSafePos, lastValidPos: lastSafePos, id: currentId };
    }

    step++;
  }
}
