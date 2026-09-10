/*
 * Optional compatibility adapter for callers that want a small API entry.
 * The engine itself remains Syllable.initS.js; this module does not contain
 * pipeline logic and does not run anything during import.
 */
export {
  configure,
  grammarPipeline,
  runBuildPhase,
  runMain,
} from "./Syllable.initS.js";
