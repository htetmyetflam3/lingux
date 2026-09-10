import { createFsmReadStream } from '../../../Bridge/streamline.js';
import { normalize, mapperStr } from '../map/map-loader.js';
import { InputFile } from '../../../Bridge/path.js';
/**
 * Generator: raw file → normalize → mapperStr (ASCII internal).
 * Yields mapped blocks ready for the segmentor.
 * NOT file writing — belongs to object (memory/mapping).
 */
export async function* readAndPrepare(inputFile = InputFile()) {
  for await (const block of createFsmReadStream(inputFile)) {
    const cleaned = normalize(block);
    const mapped = mapperStr(cleaned);
    yield mapped;
  }
}