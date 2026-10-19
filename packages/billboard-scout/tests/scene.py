"""A synthetic street: known billboards, virtual 360° cameras, a detector that 'sees' them exactly."""

from __future__ import annotations

import math
import random

from PIL import Image

from billboard_scout.detect import Box, FunctionDetector
from billboard_scout.geometry import LocalPlane, angles_to_pixel, bearing_xy, unit
from billboard_scout.models import StreetImage

PLANE = LocalPlane(9.19, 45.4642)
CAM_H = 2.5


class Panel:
    def __init__(self, x, y, facing, w, h, bottom):
        self.x, self.y, self.facing, self.w, self.h, self.bottom = x, y, facing, w, h, bottom

    def edges(self):
        """Left and right edge (x, y) seen from the front."""
        along = unit((self.facing + 90) % 360)  # direction along the panel
        c = (self.x, self.y)
        return [(c[0] - along[0] * self.w / 2, c[1] - along[1] * self.w / 2), (c[0] + along[0] * self.w / 2, c[1] + along[1] * self.w / 2)]


def street(n=11, spacing=8.0, heading=90.0, camera_type="spherical", fov=None):
    imgs = []
    for i in range(n):
        x = (i - n // 2) * spacing
        lon, lat = PLANE.to_lonlat(x, 0.0)
        imgs.append(StreetImage(id=f"img{i}", lon=lon, lat=lat, heading=heading, width=2048 if camera_type == "spherical" else 1600,
                                height=1024 if camera_type == "spherical" else 1200, camera_type=camera_type, fov_deg=fov or 70.0,
                                captured_at=f"2026-0{1 + i % 9}-01T10:00:00+00:00", source="synthetic", attribution="synthetic test scene"))
    return imgs


class FakeSource:
    name = "synthetic"

    def __init__(self, images):
        self._images = images

    def images(self, area):
        return [i for i in self._images if area.contains(i.lon, i.lat)]

    def load(self, image):
        return Image.new("RGB", (image.width, image.height), (90, 90, 90))


def detector(panels, images, jitter_px=0.0, max_range=110.0, seed=1):
    rnd = random.Random(seed)
    cams = {i.id: PLANE.to_xy(i.lon, i.lat) for i in images}

    def fn(_pixels, view):
        cx, cy = cams[view.image.id]
        boxes = []
        for p in panels:
            dist = math.hypot(p.x - cx, p.y - cy)
            # only the front is visible
            if dist > max_range or math.cos(math.radians(bearing_xy(cx - p.x, cy - p.y) - p.facing)) < 0.2:
                continue
            pts = []
            for ex, ey in p.edges():
                d = math.hypot(ex - cx, ey - cy)
                yaw = bearing_xy(ex - cx, ey - cy)
                for z in (p.bottom, p.bottom + p.h):
                    pts.append(angles_to_pixel(yaw, math.degrees(math.atan2(z - CAM_H, d)), view.yaw, view.pitch, view.fov_deg, view.width, view.height))
            if any(q is None for q in pts):
                continue
            xs, ys = [q[0] for q in pts], [q[1] for q in pts]
            if min(xs) < 0 or max(xs) > view.width or min(ys) < 0 or max(ys) > view.height:
                continue  # cut by the view edge: another view will see it whole
            j = lambda: rnd.uniform(-jitter_px, jitter_px)
            boxes.append(Box(min(xs) + j(), min(ys) + j(), max(xs) + j(), max(ys) + j(), 0.8))
        return boxes

    return FunctionDetector(fn)
