"""The area to scan: a GeoJSON polygon (drawn in QGIS, ADV·Flow, geojson.io…) or a bbox."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Area:
    rings: list[list[tuple[float, float]]]  # outer rings of one or more polygons, (lon, lat)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        xs = [p[0] for r in self.rings for p in r]
        ys = [p[1] for r in self.rings for p in r]
        return min(xs), min(ys), max(xs), max(ys)

    def contains(self, lon: float, lat: float) -> bool:
        return any(_in_ring(lon, lat, r) for r in self.rings)

    @classmethod
    def from_bbox(cls, west: float, south: float, east: float, north: float) -> "Area":
        return cls([[(west, south), (east, south), (east, north), (west, north), (west, south)]])

    @classmethod
    def from_geojson(cls, obj: Any) -> "Area":
        """Accepts a dict, a JSON string or a path to a .geojson file."""
        if isinstance(obj, (str, Path)) and Path(str(obj)).exists():
            obj = json.loads(Path(obj).read_text())
        elif isinstance(obj, str):
            obj = json.loads(obj)
        if hasattr(obj, "__geo_interface__"):  # shapely / geopandas
            obj = obj.__geo_interface__
        geoms = []
        t = obj.get("type")
        if t == "FeatureCollection":
            geoms = [f["geometry"] for f in obj["features"] if f.get("geometry")]
        elif t == "Feature":
            geoms = [obj["geometry"]]
        else:
            geoms = [obj]
        rings = []
        for g in geoms:
            if g["type"] == "Polygon":
                rings.append([tuple(p[:2]) for p in g["coordinates"][0]])
            elif g["type"] == "MultiPolygon":
                rings += [[tuple(p[:2]) for p in poly[0]] for poly in g["coordinates"]]
        if not rings:
            raise ValueError("no polygon found in the area GeoJSON")
        x0, y0, x1, y1 = cls(rings).bbox
        if max(abs(x0), abs(x1)) > 180 or max(abs(y0), abs(y1)) > 90:
            raise ValueError("the area must be in longitude/latitude (EPSG:4326)")
        return cls(rings)


def _in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside
