"""billboard-scout: find outdoor advertising in street-level imagery.

    from billboard_scout import scan, Area, ScanOptions
    from billboard_scout.sources import MapillarySource
    from billboard_scout.detect import GroundingDinoDetector

    result = scan(Area.from_geojson("area.geojson"), MapillarySource(token), GroundingDinoDetector())
    result.save("billboards.geojson")      # QGIS, ADV·Flow, geojson.io …
    df = result.to_dataframe()             # pandas / GeoPandas
"""

from .area import Area
from .formats import FORMATS, Format, register_format, snap
from .models import Billboard, Detection, StreetImage, View
from .pipeline import ScanOptions, ScanResult, locate, scan

__version__ = "0.1.0"
__all__ = ["Area", "Billboard", "Detection", "FORMATS", "Format", "ScanOptions", "ScanResult", "StreetImage", "View",
           "locate", "register_format", "scan", "snap"]
