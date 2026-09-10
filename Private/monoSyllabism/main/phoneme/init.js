/* --- main/phoneme/init.js --- */
import { readAndPrepare } from '../../mapper/object/BurmeseToAscii.js';
import { runSegmentor } from './lexer.js';
import { setHash } from '../../mapper/context/disk.js';
import { pipelineStart, pipelineError } from '../../../Bridge/logen.js';

let currentHash = null;
export function getCurrentHash() { return currentHash; }

/**
 * Init a single file → segmentor generator.
 * @param {string} inputPath — single resolved file path
 * @param {string} hash — session hash
 * @returns {AsyncGenerator} segmentor generator
 */
export function init(inputPath, hash = null) {
  try {
    currentHash = hash;
    setHash(hash);
    pipelineStart({ inputFile: inputPath });
    return runSegmentor(readAndPrepare(inputPath));
  } catch (err) {
    pipelineError({ message: err.message, file: inputPath });
    throw err;
  }
}
