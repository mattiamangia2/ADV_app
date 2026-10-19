"""Turn street images into perspective views a detector can look at.

360° panoramas (equirectangular) are heavily distorted near the edges, so we cut
them into overlapping perspective views, like looking around from the camera.
"""

from __future__ import annotations

import math

import numpy as np

from .geometry import focal_px
from .models import StreetImage, View


def make_views(img: StreetImage, n_views: int = 6, fov_deg: float = 90.0, pitch_deg: float = 8.0, width: int = 1024) -> list[View]:
    if img.camera_type != "spherical":
        return [View(img, yaw=img.heading % 360, pitch=0.0, fov_deg=img.fov_deg, width=img.width, height=img.height)]
    height = int(width * 0.75)
    return [
        View(img, yaw=(img.heading + k * 360 / n_views) % 360, pitch=pitch_deg, fov_deg=fov_deg, width=width, height=height)
        for k in range(n_views)
    ]


def render_view(view: View, photo):
    """PIL image of a view. Perspective photos are returned as they are."""
    from PIL import Image

    if view.image.camera_type != "spherical":
        return photo
    pano = np.asarray(photo.convert("RGB"))
    H, W = pano.shape[:2]
    xs, ys = np.meshgrid(np.arange(view.width) + 0.5, np.arange(view.height) + 0.5)
    yaw, elev = _pixels_to_angles(xs, ys, view)
    # Panorama convention: the centre column looks along image.heading.
    u = (((yaw - view.image.heading + 180) % 360) / 360 * W).astype(int) % W
    v = np.clip(((90 - elev) / 180 * H).astype(int), 0, H - 1)
    return Image.fromarray(pano[v, u])


def _pixels_to_angles(x: np.ndarray, y: np.ndarray, view: View) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised geometry.pixel_to_angles."""
    f = focal_px(view.width, view.fov_deg)
    cx, cy, cz = x - view.width / 2, view.height / 2 - y, f
    p = math.radians(view.pitch)
    up = cy * math.cos(p) + cz * math.sin(p)
    fwd = -cy * math.sin(p) + cz * math.cos(p)
    yaw = (view.yaw + np.degrees(np.arctan2(cx, fwd))) % 360
    elev = np.degrees(np.arctan2(up, np.hypot(cx, fwd)))
    return yaw, elev
