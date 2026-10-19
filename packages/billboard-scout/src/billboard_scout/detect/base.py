from __future__ import annotations

from typing import Callable, NamedTuple, Protocol

from ..models import View


class Box(NamedTuple):
    x0: float
    y0: float
    x1: float
    y1: float
    score: float
    label: str = "billboard"


class Detector(Protocol):
    def detect(self, image, view: View) -> list[Box]:
        """Boxes (in pixels of `image`) around billboards, posters or screens."""
        ...


class FunctionDetector:
    """Wrap any function `(image, view) -> list[Box]`: handy for tests, other models or
    detections you already have (e.g. Mapillary's own, or a model served elsewhere)."""

    def __init__(self, fn: Callable[[object, View], list[Box]]):
        self.fn = fn

    def detect(self, image, view: View) -> list[Box]:
        return [Box(*b) for b in self.fn(image, view)]
