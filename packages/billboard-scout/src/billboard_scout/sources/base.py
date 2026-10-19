from __future__ import annotations

from typing import Protocol

from ..area import Area
from ..models import StreetImage


class ImageSource(Protocol):
    """Anything that can list street images in an area and load their pixels.

    Only use sources whose licence allows automated analysis. Google Street View's
    terms forbid scraping, bulk download and extracting data from its imagery, so
    there is deliberately no Google source.
    """

    name: str

    def images(self, area: Area) -> list[StreetImage]: ...

    def load(self, image: StreetImage):  # -> PIL.Image.Image
        ...
