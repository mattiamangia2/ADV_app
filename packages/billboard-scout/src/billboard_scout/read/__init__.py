"""Readers look inside a detected billboard: is it empty? which text/brand?"""

from .base import ContentReader, HeuristicReader, TesseractReader

__all__ = ["ContentReader", "HeuristicReader", "TesseractReader"]
