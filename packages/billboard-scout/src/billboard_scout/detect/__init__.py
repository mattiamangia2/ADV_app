"""Detectors find boxes around billboards in a view. Add one by implementing `Detector`."""

from .base import Box, Detector, FunctionDetector

__all__ = ["Box", "Detector", "FunctionDetector", "GroundingDinoDetector"]


def __getattr__(name):  # lazy: avoid importing torch unless asked
    if name == "GroundingDinoDetector":
        from .grounding_dino import GroundingDinoDetector

        return GroundingDinoDetector
    raise AttributeError(name)
