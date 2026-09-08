import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TreeFile } from '../../../Bridge/path.js';

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let posTree = null;

export function loadPosTree() {
  if (!posTree) {
    const treePath = path.join(TreeFile(), 'pos.tree.json');
    posTree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  }
  return posTree;
}

export function walkPos(block, startPos) {
  const tree = loadPosTree();
  const rootTok = block[startPos];
  const rootNode = tree[rootTok];

  if (!rootNode) {
    return { endPos: startPos + 1, lastValidPos: startPos + 1, rawPos: ['?'] };
  }

  let readPos = startPos + 1;
  let step = 1;
  let lastValidPos = startPos + 1;
  let currentPos = Array.isArray(rootNode.x) && rootNode.x.length > 0
    ? rootNode.x
    : ['?'];

  let currentNode = rootNode;

  while (true) {
    const stepKey = `St-${step}`;
    const stepData = currentNode[stepKey];

    if (!stepData || readPos >= block.length) {
      break;
    }

    const nextTok = block[readPos];
    const nextNode = stepData[nextTok];

    if (!nextNode) {
      break;
    }

    readPos++;

    if (Array.isArray(nextNode.x) && nextNode.x.length > 0) {
      lastValidPos = readPos;
      currentPos = nextNode.x;
    }

    currentNode = nextNode;
    step++;
  }

  return {
    endPos: readPos,
    lastValidPos,
    rawPos: currentPos,
  };
}
