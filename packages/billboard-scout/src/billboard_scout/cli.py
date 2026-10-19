"""Command line: billboard-scout scan --area area.geojson --source mapillary --out billboards.geojson"""

from __future__ import annotations

import argparse
import sys

from .area import Area
from .pipeline import ScanOptions, scan


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="billboard-scout", description="Find billboards in street-level imagery.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan", help="scan an area and write a GeoJSON of billboards")
    where = s.add_mutually_exclusive_group(required=True)
    where.add_argument("--area", help="GeoJSON file with the polygon to scan (EPSG:4326)")
    where.add_argument("--bbox", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    s.add_argument("--source", choices=["mapillary", "folder"], default="mapillary")
    s.add_argument("--token", help="Mapillary access token (or set MAPILLARY_TOKEN)")
    s.add_argument("--folder", help="folder of geotagged photos (for --source folder)")
    s.add_argument("--since", help="only Mapillary images captured after this date, e.g. 2024-01-01")
    s.add_argument("--resolution", choices=["2048", "original"], default="2048")
    s.add_argument("--max-images", type=int, default=400)
    s.add_argument("--camera-height", type=float, default=2.5)
    s.add_argument("--ocr", action="store_true", help="read text on billboards (needs Tesseract)")
    s.add_argument("--brands", help="comma-separated brand names to look for in the text")
    s.add_argument("--out", default="billboards.geojson")
    a = p.parse_args(argv)

    area = Area.from_geojson(a.area) if a.area else Area.from_bbox(*a.bbox)
    if a.source == "mapillary":
        from .sources.mapillary import MapillarySource

        source = MapillarySource(a.token, min_date=a.since, resolution=a.resolution)
    else:
        if not a.folder:
            p.error("--folder is required with --source folder")
        from .sources.folder import FolderSource

        source = FolderSource(a.folder)
    from .detect.grounding_dino import GroundingDinoDetector

    reader = None
    if a.ocr:
        from .read import TesseractReader

        reader = TesseractReader(brands=[b.strip() for b in a.brands.split(",")] if a.brands else None)
    opts = ScanOptions(max_images=a.max_images, camera_height_m=a.camera_height)
    result = scan(area, source, GroundingDinoDetector(), reader, opts, progress=lambda m: print(m, file=sys.stderr))
    out = result.save(a.out)
    print("\n".join(result.log), file=sys.stderr)
    print(f"Wrote {len(result.billboards)} billboards to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
