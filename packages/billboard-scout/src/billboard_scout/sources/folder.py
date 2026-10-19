"""Your own photos: a folder of geotagged JPEGs (phone, GoPro, Insta360 exports…).

Position and direction come from a `manifest.csv` if present
(columns: file, lon, lat, heading[, captured_at, camera_type, fov]) or else from
the photos' EXIF GPS tags (GPSLatitude/Longitude and GPSImgDirection).
Images with a 2:1 aspect ratio are treated as 360° panoramas.
"""

from __future__ import annotations

import csv
from pathlib import Path

from ..area import Area
from ..models import StreetImage

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


class FolderSource:
    name = "folder"

    def __init__(self, folder: str | Path, *, default_fov: float = 70.0, attribution: str | None = None):
        self.folder = Path(folder)
        self.default_fov = default_fov
        self.attribution = attribution

    def images(self, area: Area) -> list[StreetImage]:
        manifest = self.folder / "manifest.csv"
        imgs = self._from_manifest(manifest) if manifest.exists() else self._from_exif()
        return [i for i in imgs if area.contains(i.lon, i.lat)]

    def load(self, image: StreetImage):
        from PIL import Image

        return Image.open(image.path).convert("RGB")

    def _make(self, path: Path, lon: float, lat: float, heading: float, captured: str | None = None,
              camera_type: str | None = None, fov: float | None = None) -> StreetImage:
        from PIL import Image

        with Image.open(path) as im:
            w, h = im.size
        ctype = camera_type or ("spherical" if abs(w / h - 2) < 0.05 else "perspective")
        return StreetImage(id=path.stem, lon=lon, lat=lat, heading=heading % 360, width=w, height=h,
                           camera_type=ctype, fov_deg=fov or self.default_fov, captured_at=captured,
                           path=str(path), source=self.name, attribution=self.attribution)

    def _from_manifest(self, manifest: Path) -> list[StreetImage]:
        out = []
        with manifest.open(newline="") as fh:
            for r in csv.DictReader(fh):
                p = self.folder / r["file"]
                if p.exists():
                    out.append(self._make(p, float(r["lon"]), float(r["lat"]), float(r["heading"]), r.get("captured_at") or None,
                                          r.get("camera_type") or None, float(r["fov"]) if r.get("fov") else None))
        return out

    def _from_exif(self) -> list[StreetImage]:
        from PIL import Image

        out = []
        for p in sorted(self.folder.iterdir()):
            if p.suffix.lower() not in EXTS:
                continue
            with Image.open(p) as im:
                exif = im.getexif()
                gps = exif.get_ifd(0x8825)
                when = exif.get_ifd(0x8769).get(0x9003)
            try:
                lat = _dms(gps[2], gps.get(1, "N"))
                lon = _dms(gps[4], gps.get(3, "E"))
            except (KeyError, TypeError, ZeroDivisionError):
                continue  # no GPS: skip
            heading = float(gps[17]) if 17 in gps else None
            if heading is None:
                continue  # without a direction we can't aim the sight lines
            iso = when.replace(":", "-", 2).replace(" ", "T") if isinstance(when, str) else None
            out.append(self._make(p, lon, lat, heading, iso))
        return out


def _dms(v, ref: str) -> float:
    d, m, s = (float(x) for x in v)
    val = d + m / 60 + s / 3600
    return -val if ref in ("S", "W") else val
