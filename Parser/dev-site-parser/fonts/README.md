# Bundled fonts

Fonts imported from [`moekyawsoe/Myanmar-Fonts`](https://github.com/moekyawsoe/Myanmar-Fonts) at commit `cefd1f5297c1fce9d052dd92cdf7bf8cf902426f` are organized as follows:

- `Unicode/`: Unicode Myanmar fonts (Myanmar Text, Padauk, and Pyidaungsu), in addition to the Unicode fonts already in this repository. These are the **input-side** reference faces.
- `output/`: the fonts used to **write** output files (PDF & DOCX). Contains Anonymous Pro (Latin/English, 4 styles) and the Myanmar output face **MyanmarSagar** plus the other user-uploaded Myanmar faces kept as alternates. This directory was previously named `AnonymousPro/`; it was renamed to reflect its actual role. `paths.py` / `paths.mjs` expose it as `OUTPUT_FONT_DIR`.
- `zawgyi one/`: Zawgyi-One (`ZAWGYI-ONE_V3.1.TTF`).

## Output font choice (2026-09-28)

The Myanmar output face was switched from **YoeYar-One** to **MyanmarSagar** for
both PDF (fpdf) and DOCX. Of the user's favourite faces, MyanmarSagar is the
only one with **full Myanmar base-block coverage** (U+1000–U+109F). Base-block
coverage measured across the candidates:

| Font | core U+1000–104F (/80) | ext U+1050–109F (/80) | full (/160) |
| --- | --- | --- | --- |
| **MyanmarSagar** ✅ | 80 | 80 | **160** |
| Aka02-Regular | 75 | 0 | 75 |
| Masterpiece Uni Serif | 75 | 0 | 75 |
| Masterpiece Uni Round | — not uploaded — | | |
| YoeYar-One (previous) | 75 | 10 | 85 |

Aka02 and Masterpiece Uni Serif cover only core Burmese (no extended block);
Masterpiece Uni Round was not among the uploaded files. Switching the face is a
one-line change (`DEFAULT_BURMESE_KEY` / `BURMESE_FONTS` in `fonts.py` and
`fonts.mjs`) if a different look is preferred.

Only font binaries are imported; installers, executables, keyboard drivers, registry files, images, and archive containers are intentionally excluded.

## Culling rule (2026-09-28)

A font is kept only if it carries code-point information the parser can use:
its `cmap` maps real Myanmar code points (U+1000–U+109F), **or** the codebase
loads it directly (Anonymous Pro for Latin output, and the Myanmar
output/fallback set in `paths.py`). Everything else decoded to nothing and was
removed:

- Latin-only glyph fonts (Win Innwa, Wwin, the `NYI*`/`S0xx`/Art House faces).
- Every Type1 `.pfb`/`.pfm`/`.pss` file (cannot carry Myanmar Unicode).
- The `window/` **`U4*` PUA family** — these mapped Myanmar to the Private Use
  Area (non-standard, not decodable without a per-font table). Before removal,
  their full `code point → glyph-id → glyph-name` cmap was dumped to
  `pua_glyph_dumps.min.json` (kept in the repo), so a PUA→Unicode table can
  still be reconstructed later. The now-empty `window/` directory was dropped.

The removed binaries (525 files) were archived to
`_wiped_archive/wiped-fonts-2026-09-28.zip`, committed once, then removed and
git-ignored — so the archive is recoverable from that single commit but is no
longer tracked.
