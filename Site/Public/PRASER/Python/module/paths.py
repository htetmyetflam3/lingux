"""Path resolution for models, fonts, and output.

All paths are resolved relative to this file (``module/paths.py``) so the
package works from any current working directory.

  - Zawgyi model : ./model/zawgyiUnicodeModel.dat  (or $ZAWGYI_MODEL)
  - Myanmar fonts: ./fonts/Unicode/
  - Latin font   : Anonymous Pro under ./fonts/AnonymousPro/
  - Default output dir: ./output/  (or pass an explicit output path)
"""

import os
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent       # .../pdf/module
REPO_ROOT = MODULE_DIR.parent                      # .../pdf

# Zawgyi detection Markov model (zawgyiUnicodeModel.dat)
MODEL_DIR = REPO_ROOT / "model"
DEFAULT_MODEL_PATH = MODEL_DIR / "zawgyiUnicodeModel.dat"

# Myanmar Unicode fonts are shipped under fonts/Unicode/
FONT_DIR = REPO_ROOT / "fonts" / "Unicode"
DEFAULT_MYANMAR_FONT = FONT_DIR / "YoeYar-One_Bold.ttf"

# Default output directory when no output path is given on the CLI.
DEFAULT_OUTPUT_DIR = REPO_ROOT / "output"

# Anonymous Pro (Latin / monospace fallback for PDF & DOCX output).
ANONYMOUS_PRO_DIR = REPO_ROOT / "fonts" / "AnonymousPro"

# Latin fallback candidates (for PDF output of non-Myanmar glyphs).
_LATIN_FONT_CANDIDATES = [
    FONT_DIR / "DejaVuSans.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
]


def find_model_path():
    """Return the path to zawgyiUnicodeModel.dat (first existing candidate)."""
    candidates = [
        os.environ.get("ZAWGYI_MODEL"),
        MODULE_DIR / "model" / "zawgyiUnicodeModel.dat",  # module/model/ (actual repo location)
        DEFAULT_MODEL_PATH,                 # pdf/model/zawgyiUnicodeModel.dat
        MODEL_DIR / "zawgyiUnicodeModel.dat",
        MODULE_DIR / "zawgyiUnicodeModel.dat",  # beside detector.py
        REPO_ROOT / "zawgyiUnicodeModel.dat",
    ]
    for cand in candidates:
        if cand and Path(cand).is_file():
            return str(Path(cand))
    return str(DEFAULT_MODEL_PATH)


def find_myanmar_font():
    """Return an available Myanmar-capable TTF from the shipped font dir."""
    candidates = [
        DEFAULT_MYANMAR_FONT,                      # YoeYar-One_Bold.ttf
        FONT_DIR / "YoeYar-One_Regular.ttf",
        FONT_DIR / "YoeYar-One_Light.ttf",
        FONT_DIR / "NotoSansMyanmar-Regular.ttf",
        FONT_DIR / "Pyidaungsu_Regular.ttf",
        FONT_DIR / "Padauk.ttf",
    ]
    for cand in candidates:
        if Path(cand).is_file():
            return Path(cand)
    # Fall back to the first .ttf found in the font dir.
    if FONT_DIR.is_dir():
        for f in sorted(FONT_DIR.glob("*.ttf")):
            return f
    return DEFAULT_MYANMAR_FONT


def find_latin_font():
    """Return an available Latin fallback font, or None if none exist."""
    for cand in _LATIN_FONT_CANDIDATES:
        if Path(cand).is_file():
            return Path(cand)
    return None
