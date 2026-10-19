"""Mapillary (https://www.mapillary.com): free, crowd-sourced street-level imagery.

Needs a free client access token: create an app at https://www.mapillary.com/dashboard/developers
and pass it as `token=` or the MAPILLARY_TOKEN environment variable.
Check Mapillary's terms for the current licence and attribution rules before
publishing results; we record the attribution on every billboard found.
"""

from __future__ import annotations

import hashlib
import io
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from ..area import Area
from ..models import StreetImage

API = "https://graph.mapillary.com"
FIELDS = ",".join([
    "id", "geometry", "computed_geometry", "compass_angle", "computed_compass_angle", "captured_at",
    "camera_type", "camera_parameters", "width", "height", "thumb_2048_url", "thumb_original_url", "sequence",
])


class MapillarySource:
    name = "mapillary"
    attribution = "Images © Mapillary contributors"

    def __init__(self, token: str | None = None, *, resolution: str = "2048", tile_deg: float = 0.005,
                 min_date: str | None = None, include_fisheye: bool = False, cache_dir: str | Path | None = "cache/mapillary",
                 session: requests.Session | None = None, pause_s: float = 0.05):
        self.token = token or os.environ.get("MAPILLARY_TOKEN")
        if not self.token:
            raise ValueError("Mapillary needs an access token: pass token=… or set MAPILLARY_TOKEN")
        self.resolution = resolution  # "2048" or "original" (sharper, better for reading brands)
        self.tile_deg = tile_deg
        self.min_ms = _iso_to_ms(min_date) if min_date else None
        self.include_fisheye = include_fisheye
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.http = session or requests.Session()
        self.pause_s = pause_s

    # ------------------------------------------------------------------ listing
    def images(self, area: Area) -> list[StreetImage]:
        out: dict[str, StreetImage] = {}
        for bbox in _tiles(area.bbox, self.tile_deg):
            params = {"access_token": self.token, "fields": FIELDS, "bbox": ",".join(f"{v:.6f}" for v in bbox), "limit": 2000}
            if self.min_ms:
                params["start_captured_at"] = datetime.fromtimestamp(self.min_ms / 1000, timezone.utc).isoformat()
            data = self._get(f"{API}/images", params)
            for rec in data.get("data", []):
                img = self._to_image(rec)
                if img and area.contains(img.lon, img.lat):
                    out[img.id] = img
            time.sleep(self.pause_s)
        return list(out.values())

    def _to_image(self, r: dict) -> StreetImage | None:
        geom = r.get("computed_geometry") or r.get("geometry")
        if not geom:
            return None
        lon, lat = geom["coordinates"][:2]
        heading = r.get("computed_compass_angle", r.get("compass_angle"))
        if heading is None:
            return None
        cam = (r.get("camera_type") or "perspective").lower()
        if cam in ("equirectangular", "spherical"):
            ctype = "spherical"
        elif cam == "fisheye" and not self.include_fisheye:
            return None
        else:
            ctype = "perspective"
        w, h = int(r.get("width") or 0), int(r.get("height") or 0)
        fov = 70.0
        params = r.get("camera_parameters") or []
        if ctype == "perspective" and params and w and h:
            # Mapillary focal length is normalised by the larger image side.
            f = float(params[0]) * max(w, h)
            if f > 0:
                fov = math.degrees(2 * math.atan(w / 2 / f))
        url = r.get("thumb_original_url") if self.resolution == "original" else r.get("thumb_2048_url")
        if self.resolution != "original" and w and h:
            s = 2048 / max(w, h)
            if s < 1:
                w, h = round(w * s), round(h * s)
        captured = r.get("captured_at")
        return StreetImage(
            id=str(r["id"]), lon=float(lon), lat=float(lat), heading=float(heading) % 360, width=w, height=h,
            camera_type=ctype, fov_deg=fov,
            captured_at=datetime.fromtimestamp(captured / 1000, timezone.utc).isoformat() if captured else None,
            url=url, source=self.name, sequence=(r.get("sequence") if isinstance(r.get("sequence"), str) else None),
            attribution=self.attribution,
            extra={"mapillary_url": f"https://www.mapillary.com/app/?pKey={r['id']}"},
        )

    # ------------------------------------------------------------------ pixels
    def load(self, image: StreetImage):
        from PIL import Image

        if not image.url:
            raise ValueError(f"image {image.id} has no download URL")
        cached = self.cache_dir / f"{hashlib.sha1((image.id + self.resolution).encode()).hexdigest()}.jpg" if self.cache_dir else None
        if cached and cached.exists():
            return Image.open(cached).convert("RGB")
        res = self.http.get(image.url, timeout=60)
        res.raise_for_status()
        if cached:
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(res.content)
        photo = Image.open(io.BytesIO(res.content)).convert("RGB")
        image.width, image.height = photo.size
        return photo

    def _get(self, url: str, params: dict, tries: int = 4) -> dict:
        for i in range(tries):
            res = self.http.get(url, params=params, timeout=60)
            if res.status_code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 ** i)
                continue
            if res.status_code == 401:
                raise PermissionError("Mapillary rejected the token (401)")
            res.raise_for_status()
            return res.json()
        return {}


def _tiles(bbox: tuple[float, float, float, float], step: float):
    """Split a bbox into small tiles (the images endpoint refuses large boxes)."""
    w, s, e, n = bbox
    nx, ny = max(1, math.ceil((e - w) / step)), max(1, math.ceil((n - s) / step))
    for i in range(nx):
        for j in range(ny):
            yield (w + i * (e - w) / nx, s + j * (n - s) / ny, w + (i + 1) * (e - w) / nx, s + (j + 1) * (n - s) / ny)


def _iso_to_ms(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp() * 1000)
