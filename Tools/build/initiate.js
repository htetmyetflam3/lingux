#!/usr/bin/env node
/**
 * Tools/build/initiate.js
 *
 * Convenience wrapper to run Lingux pipeline bootstrapping from Tools/build:
 *   lingux/Tools/build $ node initiate.js ../../mymap/
 *   lingux/Tools/build $ node ../../initiate.js
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_INITIATE = path.resolve(__dirname, "../../initiate.js");

import(ROOT_INITIATE);
