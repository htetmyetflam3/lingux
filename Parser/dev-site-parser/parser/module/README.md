# Bundled OCR model: pndaza/tesseract-myanmar

`mya.traineddata.gz` in this directory is `mya.traineddata` from
<https://github.com/pndaza/tesseract-myanmar> (archived upstream repo),
re-gzipped (no other change) so it loads through the same
`<lang>.traineddata.gz` path tesseract.js already expects.

Why this instead of the tesseract-project/`@tesseract.js-data` default `mya`
model: per the upstream README (kept verbatim as `SOURCE-README.md` next to
this file), the stock Tesseract Myanmar model is missing several
characters (`၌ ၍ ၏ ၎`, section marks) and was trained on a text corpus that
mixes in Zawgyi-encoded text, so its error rate on real Myanmar documents is
high. pndaza fine-tuned the LSTM layers on a broader, cleaner, all-Unicode
font/text set; the upstream README's own per-font evaluation table shows
consistently lower character/word error rates than the default model across
Myanmar Unicode fonts.

`ocr.mjs` loads this directory automatically — no configuration needed. To
use a different model instead, set `PRASER_OCR_LANG_PATH` (and
`PRASER_OCR_LANG` if the filename differs from the language code) to point
at it; that always wins over the bundled model here.

Upstream repository: no explicit open-source license file/field was present
on GitHub for pndaza/tesseract-myanmar at the time this file was vendored
(2026-09-30); the author's own README states the model is being shared
("ပြန်လည်ဝေမျှလိုက်ပါသည်") publicly for this exact purpose. If that
changes, or the model is ever removed by request, delete this directory —
`ocr.mjs` falls back to `@tesseract.js-data`/tesseract.js's own download
path automatically.
