# Tesseract Myanmar source note

The stock Tesseract Myanmar model has known gaps in punctuation and character coverage and can perform poorly on mixed-font or Zawgyi-contaminated training material. The bundled model was fine-tuned for Myanmar text and is used as a pre-release quality improvement.

The upstream evaluation compares character and word error rates across many Myanmar fonts. Those figures are source evidence, not a guarantee for every document. OCR remains sensitive to scan noise, line segmentation, font design, warping, and overlapping lines; use the text extraction path when the source is already machine-readable.

This note records provenance and limitations. The executable model selection and fallback behavior are defined by `ocr.mjs` and the parser tests.
