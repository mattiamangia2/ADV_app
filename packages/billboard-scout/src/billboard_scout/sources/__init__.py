"""Where street images come from. Add a source by implementing `ImageSource`."""

from .base import ImageSource
from .folder import FolderSource
from .mapillary import MapillarySource

__all__ = ["ImageSource", "FolderSource", "MapillarySource"]
