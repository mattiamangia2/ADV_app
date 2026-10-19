"""Example: scan a small area of Milan with Mapillary images (works as a notebook cell too).

    pip install "billboard-scout[detect,geo]"
    export MAPILLARY_TOKEN="MLY|..."
    python examples/scan_area.py
"""

from billboard_scout import Area, ScanOptions, scan
from billboard_scout.detect import GroundingDinoDetector
from billboard_scout.read import HeuristicReader
from billboard_scout.sources import MapillarySource

# Corso Buenos Aires around Piazzale Loreto (draw your own polygon in QGIS or geojson.io)
area = Area.from_geojson({
    "type": "Polygon",
    "coordinates": [[[9.2100, 45.4790], [9.2185, 45.4790], [9.2185, 45.4865], [9.2100, 45.4865], [9.2100, 45.4790]]],
})

result = scan(
    area,
    MapillarySource(min_date="2024-01-01"),  # token from MAPILLARY_TOKEN
    GroundingDinoDetector(),
    reader=HeuristicReader(),
    options=ScanOptions(max_images=150),
    progress=print,
)

print("\n".join(result.log))
result.save("billboards.geojson")
df = result.to_dataframe()
print(df[["format_label", "width_m", "height_m", "facing_azimuth", "n_views", "confidence", "last_seen"]].sort_values("confidence", ascending=False))
