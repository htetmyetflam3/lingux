/**
 * Parser filesystem layout.
 *
 * Everything resolves from import.meta.url, never process.cwd():
 *
 *   Parsed/
 *     fonts/Unicode/       input/detection fonts
 *     fonts/used/          fonts embedded in generated files
 *     upload/input/        runtime input
 *     .output/             runtime output
 *     parser/
 *       module/            executable modules (this directory)
 *       map/               JSON normalization/decoding maps
 *       model/             detector and OCR models
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PARSER_DIR = path.dirname(MODULE_DIR);
export const PARSED_ROOT = path.dirname(PARSER_DIR);

// Backward-compatible names used by older parser modules.
export const PORT_DIR = PARSER_DIR;
export const PRASER_ROOT = PARSED_ROOT;

export const UPLOAD_DIR = path.join(PARSED_ROOT, "upload");
export const INPUT_DIR = path.join(UPLOAD_DIR, "input");

export const MAP_DIR = path.join(PARSER_DIR, "map");
export const MODEL_DIR = path.join(PARSER_DIR, "model");
export const DEFAULT_MODEL_PATH = path.join(MODEL_DIR, "zawgyiUnicodeModel.dat");
export const OCR_MODEL_DIR = MODEL_DIR;

export const FONT_DIR = path.join(PARSED_ROOT, "fonts", "Unicode");
export const OUTPUT_FONT_DIR = path.join(PARSED_ROOT, "fonts", "used");
export const DEFAULT_MYANMAR_FONT = path.join(OUTPUT_FONT_DIR, "MyanmarSagar.ttf");

export const DEFAULT_OUTPUT_DIR = path.join(PARSED_ROOT, ".output");

const LATIN_FONT_CANDIDATES = [
  path.join(OUTPUT_FONT_DIR, "AnonymousPro-Regular.ttf"),
  path.join(FONT_DIR, "DejaVuSans.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export function findModelPath() {
  const candidates = [
    process.env.ZAWGYI_MODEL,
    DEFAULT_MODEL_PATH,
    path.join(MODULE_DIR, "zawgyiUnicodeModel.dat"),
    path.join(PARSED_ROOT, "zawgyiUnicodeModel.dat"),
  ];
  for (const cand of candidates) {
    if (cand && isFile(cand)) return cand;
  }
  return DEFAULT_MODEL_PATH;
}

export function findMyanmarFont() {
  const candidates = [
    DEFAULT_MYANMAR_FONT,
    path.join(OUTPUT_FONT_DIR, "Aka02-Regular.ttf"),
    path.join(FONT_DIR, "PYIDAUNGSU-2.5.2_REGULAR.TTF"),
    path.join(FONT_DIR, "Padauk.ttf"),
    path.join(FONT_DIR, "Ayar.ttf"),
    path.join(FONT_DIR, "MyanmarThuriya.ttf"),
    path.join(FONT_DIR, "YoeYar-One_Regular.ttf"),
  ];
  for (const cand of candidates) {
    if (isFile(cand)) return cand;
  }
  if (fs.existsSync(FONT_DIR)) {
    const ttf = fs
      .readdirSync(FONT_DIR)
      .filter((f) => f.toLowerCase().endsWith(".ttf"))
      .sort();
    if (ttf.length) return path.join(FONT_DIR, ttf[0]);
  }
  return DEFAULT_MYANMAR_FONT;
}

export function findLatinFont() {
  for (const cand of LATIN_FONT_CANDIDATES) {
    if (isFile(cand)) return cand;
  }
  return null;
}
