#!/usr/bin/env python3
"""Cut the shipped webfonts down to the characters LogHarbor actually draws.

The upstream files are Nerd Fonts: a normal Cascadia Mono plus several thousand
patched icon glyphs in the Private Use Area. The UI uses none of them -- every
icon in the app is an SVG component -- so ~96% of the 1.2 MB per weight is
downloaded on every cold load and never rendered. That made the two font files
81% of the cold payload, four times the whole rest of the app.

Run from frontend/ after replacing an upstream font:

    pip install fonttools brotli
    python scripts/subset-fonts.py

It rewrites the *-Subset.woff2 files that fonts.css actually loads. The full
upstream files stay next to them as the source to re-cut from; nothing imports
them, so Vite never emits them into the bundle.
"""
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
FONTS = FRONTEND / "src" / "assets" / "fonts"
SOURCE_SUFFIXES = (".ts", ".tsx", ".css", ".html")

# Whole blocks, so that log content -- which is arbitrary text we do not control --
# keeps rendering in the UI font instead of dropping to the fallback mid-line.
# Box Drawing and Block Elements are in for the same reason: stack traces and
# CLI output paste in with them constantly.
BLOCKS = [
    (0x0020, 0x00FF),  # Basic Latin + Latin-1 Supplement
    (0x0100, 0x017F),  # Latin Extended-A (Turkish: ğ İ ı Ş ş)
    (0x2010, 0x205E),  # General Punctuation (dashes, quotes, ellipsis, ‹ ›)
    (0x2070, 0x209F),  # Super/subscripts
    (0x20A0, 0x20BF),  # Currency symbols (€ ₺)
    (0x2100, 0x214F),  # Letterlike symbols (™ №)
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Mathematical operators (≤ ≥ − ∞)
    (0x2300, 0x23FF),  # Miscellaneous Technical (⌕ ⌘ ⏱)
    (0x2500, 0x257F),  # Box Drawing
    (0x2580, 0x259F),  # Block Elements
    (0x25A0, 0x25FF),  # Geometric Shapes (● ▲ ▼ ◆)
    (0x2700, 0x27BF),  # Dingbats (✓ ✕ ✔ ✘)
    (0x2900, 0x297F),  # Supplemental Arrows-B (⤢)
    (0x2980, 0x29FF),  # Misc Mathematical Symbols-B (⧉)
]

# Odds and ends outside those blocks that still have to render.
EXTRA = [
    0x2665,  # BLACK HEART SUIT
    0x26A1,  # HIGH VOLTAGE SIGN
    0xFFFD,  # REPLACEMENT CHARACTER, for log bytes that did not decode
]

WANTED = {cp for lo, hi in BLOCKS for cp in range(lo, hi + 1)} | set(EXTRA)


def codepoints_in_source() -> set[int]:
    """Every non-ASCII character the UI's own text hard-codes.

    Log content is arbitrary and cannot be scanned, which is why the ranges above
    are whole blocks. This is the narrower question the subset must never get
    wrong: a label in the app that silently drops to the fallback font.
    """
    used: set[int] = set()
    for path in (FRONTEND / "src").rglob("*"):
        if path.suffix not in SOURCE_SUFFIXES:
            continue
        used |= {ord(c) for c in path.read_text(encoding="utf-8") if ord(c) > 0x7F}
    return used


def coverage(path: pathlib.Path) -> set[int]:
    font = TTFont(path)
    try:
        return {cp for table in font["cmap"].tables for cp in table.cmap}
    finally:
        font.close()


def subset_one(source: pathlib.Path) -> tuple[int, int, int]:
    target = source.with_name(source.stem + "-Subset.woff2")
    present = coverage(source)

    options = subset.Options()
    options.flavor = "woff2"
    options.desubroutinize = True
    # Keep the default layout features: this is a coding font and its ligatures
    # and kerning are part of how the UI already looks.
    options.drop_tables += ["FFTM"]
    # 13 and 14 are the licence and its URL, and pyftsubset drops both by default.
    # The OFL wants the notice to travel with every copy, and the .woff2 is the only
    # copy that reaches a browser -- the LICENSE file beside it never leaves the repo.
    # 16 is the typographic family, kept so the two weights still pair up.
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16]

    font = TTFont(source)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=sorted(WANTED & present))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(target)
    font.close()

    return source.stat().st_size, target.stat().st_size, len(WANTED & present)


def main() -> int:
    sources = sorted(p for p in FONTS.glob("*.woff2") if "-Subset" not in p.stem)
    if not sources:
        print(f"no upstream fonts in {FONTS}", file=sys.stderr)
        return 1

    used = codepoints_in_source()
    total_before = total_after = 0
    dropped: dict[str, list[int]] = {}
    never_had: set[int] = set()

    for source in sources:
        before, after, glyphs = subset_one(source)
        total_before += before
        total_after += after
        print(
            f"{source.name}\n"
            f"  -> {source.stem}-Subset.woff2  "
            f"{before / 1024:.0f} KB -> {after / 1024:.0f} KB  "
            f"({100 - after * 100 / before:.1f}% smaller, {glyphs} codepoints)"
        )

        upstream = coverage(source)
        cut = coverage(source.with_name(source.stem + "-Subset.woff2"))
        lost = sorted(cp for cp in used if cp in upstream and cp not in cut)
        if lost:
            dropped[source.name] = lost
        never_had |= {cp for cp in used if cp not in upstream}

    print(
        f"\ntotal {total_before / 1024:.0f} KB -> {total_after / 1024:.0f} KB "
        f"({(total_before - total_after) / 1024:.0f} KB off every cold load)"
    )

    if never_had:
        # Not a regression -- these already render in the browser's fallback font,
        # subset or not. Listed so nobody blames the subset for how they look.
        chars = " ".join(f"U+{cp:04X} {chr(cp)}" for cp in sorted(never_had))
        print(f"\nnot in the upstream font either, already falling back: {chars}")

    if dropped:
        for name, lost in dropped.items():
            chars = " ".join(f"U+{cp:04X} {chr(cp)}" for cp in lost)
            print(f"\nERROR: {name} lost characters the UI uses: {chars}", file=sys.stderr)
        print("Widen BLOCKS or EXTRA and re-run.", file=sys.stderr)
        return 1

    print(f"\nall {len(used - never_had)} non-ASCII characters the UI uses survived")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
