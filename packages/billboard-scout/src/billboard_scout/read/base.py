"""Reading billboard content.

* HeuristicReader (no extra installs): flags blank or plain panels as empty.
* TesseractReader (pip install billboard-scout[ocr] + the Tesseract program):
  reads the text, spots "spazio disponibile"-style notices and matches a brand list.

A vision-language model (any provider) can be plugged in the same way by
implementing `read(crop) -> dict`; it is usually the best brand reader.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Protocol

import numpy as np

# Notices that mean "this space is free" (Italian + English)
EMPTY_PHRASES = [
    "spazio disponibile", "affittasi", "questo spazio", "spazio libero", "spazio pubblicitario disponibile",
    "available", "for rent", "to let", "your ad here", "advertise here", "space available",
]


class ContentReader(Protocol):
    def read(self, crop) -> dict:
        """Return any of: text (str), brand (str), is_empty (bool), score (0..1)."""
        ...


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s)


class HeuristicReader:
    """Blank (near uniform) panels are reported as empty. Cheap, no dependencies."""

    def __init__(self, std_threshold: float = 12.0):
        self.std_threshold = std_threshold

    def read(self, crop) -> dict:
        a = np.asarray(crop.convert("L"), dtype=float)
        if a.size == 0:
            return {}
        # ignore a 10 % border (frame, background around the panel)
        h, w = a.shape
        core = a[int(h * 0.1): max(int(h * 0.9), 1), int(w * 0.1): max(int(w * 0.9), 1)]
        blank = float(core.std()) < self.std_threshold
        return {"is_empty": True, "score": 0.6} if blank else {}


class TesseractReader:
    def __init__(self, brands: list[str] | None = None, lang: str = "ita+eng", min_upscale_px: int = 600):
        import pytesseract  # noqa: F401  (fail early with a clear ImportError)

        self.brands = [(b, _norm(b)) for b in (brands or [])]
        self.lang = lang
        self.min_upscale_px = min_upscale_px
        self.heuristic = HeuristicReader()

    def read(self, crop) -> dict:
        import pytesseract

        img = crop.convert("RGB")
        if max(img.size) < self.min_upscale_px:  # OCR likes big letters
            s = self.min_upscale_px / max(img.size)
            img = img.resize((int(img.width * s), int(img.height * s)))
        text = " ".join(pytesseract.image_to_string(img, lang=self.lang).split())
        out = {"text": text or None}
        n = _norm(text)
        if any(p in n for p in EMPTY_PHRASES):
            out.update(is_empty=True, score=0.8)
        for brand, key in self.brands:
            if key and key in n:
                out.update(brand=brand, score=max(out.get("score", 0), 0.7))
                break
        if not text:
            out.update(self.heuristic.read(crop))
        return out
