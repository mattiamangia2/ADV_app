"""Geometry: from pixels to directions, from directions to positions and sizes.

Conventions
-----------
* Compass bearings in degrees: 0 = north, 90 = east, clockwise.
* Local metric plane (east, north) in metres around a reference point;
  accurate to centimetres over the few hundred metres we work with.
* Perspective views follow a pinhole model: pixel x maps to
  atan((x - w/2) / f) with f = (w/2) / tan(fov/2).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

EARTH_R = 6371008.8


# --------------------------------------------------------------------------- local plane
@dataclass(frozen=True)
class LocalPlane:
    lon0: float
    lat0: float

    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        k = math.pi / 180 * EARTH_R
        return (lon - self.lon0) * k * math.cos(math.radians(self.lat0)), (lat - self.lat0) * k

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        k = math.pi / 180 * EARTH_R
        return self.lon0 + x / (k * math.cos(math.radians(self.lat0))), self.lat0 + y / k


def bearing_xy(dx: float, dy: float) -> float:
    """Compass bearing of a vector in the local plane."""
    return math.degrees(math.atan2(dx, dy)) % 360


def unit(bearing_deg: float) -> np.ndarray:
    b = math.radians(bearing_deg)
    return np.array([math.sin(b), math.cos(b)])


def angle_diff(a: float, b: float) -> float:
    d = abs((a - b) % 360)
    return 360 - d if d > 180 else d


def circular_mean(angles: list[float], weights: list[float] | None = None) -> float:
    w = weights or [1.0] * len(angles)
    s = sum(wi * math.sin(math.radians(a)) for a, wi in zip(angles, w))
    c = sum(wi * math.cos(math.radians(a)) for a, wi in zip(angles, w))
    return math.degrees(math.atan2(s, c)) % 360


# --------------------------------------------------------------------------- pixels <-> angles
def focal_px(width: int, fov_deg: float) -> float:
    return (width / 2) / math.tan(math.radians(fov_deg) / 2)


def pixel_to_angles(x: float, y: float, view_yaw: float, view_pitch: float, fov_deg: float, width: int, height: int) -> tuple[float, float]:
    """Compass bearing and elevation (degrees) of a pixel in a perspective view.

    The view looks along (view_yaw, view_pitch); we rotate the pixel's camera ray
    into world directions, so it is exact for tilted views too.
    """
    f = focal_px(width, fov_deg)
    # camera frame: right, up, forward
    cx, cy, cz = (x - width / 2), (height / 2 - y), f
    p = math.radians(view_pitch)
    # tilt around the right axis
    up = cy * math.cos(p) + cz * math.sin(p)
    fwd = -cy * math.sin(p) + cz * math.cos(p)
    yaw = (view_yaw + math.degrees(math.atan2(cx, fwd))) % 360
    elev = math.degrees(math.atan2(up, math.hypot(cx, fwd)))
    return yaw, elev


def angles_to_pixel(yaw: float, elev: float, view_yaw: float, view_pitch: float, fov_deg: float, width: int, height: int) -> tuple[float, float] | None:
    """Inverse of pixel_to_angles. None if the direction is behind the view."""
    f = focal_px(width, fov_deg)
    dyaw = math.radians(((yaw - view_yaw + 180) % 360) - 180)
    e = math.radians(elev)
    # world direction in a frame aligned with the view yaw: right, up, forward
    r, u, fw = math.cos(e) * math.sin(dyaw), math.sin(e), math.cos(e) * math.cos(dyaw)
    p = math.radians(view_pitch)
    cy = u * math.cos(p) - fw * math.sin(p)
    cz = u * math.sin(p) + fw * math.cos(p)
    if cz <= 1e-9:
        return None
    return width / 2 + f * r / cz, height / 2 - f * cy / cz


# --------------------------------------------------------------------------- rays
@dataclass
class Ray:
    """A sight line from a camera towards a detected billboard."""

    origin: np.ndarray  # (x, y) metres
    bearing: float
    key: int  # index of the detection it comes from
    image_id: str

    @property
    def dir(self) -> np.ndarray:
        return unit(self.bearing)


def intersect_two(a: Ray, b: Ray, min_angle_deg: float = 3.0) -> tuple[np.ndarray, float, float] | None:
    """Crossing point of two rays, with the distance along each. None if (nearly) parallel."""
    da, db = a.dir, b.dir
    if angle_diff(a.bearing, b.bearing) < min_angle_deg or angle_diff(a.bearing, b.bearing) > 180 - min_angle_deg:
        return None
    m = np.column_stack([da, -db])
    try:
        ta, tb = np.linalg.solve(m, b.origin - a.origin)
    except np.linalg.LinAlgError:
        return None
    return a.origin + ta * da, float(ta), float(tb)


def least_squares_point(rays: list[Ray]) -> np.ndarray:
    """Point closest (in the least-squares sense) to all rays."""
    A = np.zeros((2, 2))
    b = np.zeros(2)
    for r in rays:
        d = r.dir.reshape(2, 1)
        P = np.eye(2) - d @ d.T
        A += P
        b += P @ r.origin
    return np.linalg.solve(A, b)


def ray_distance(r: Ray, p: np.ndarray) -> tuple[float, float]:
    """(perpendicular distance from p to the ray, distance along the ray)."""
    v = p - r.origin
    t = float(v @ r.dir)
    perp = float(np.linalg.norm(v - t * r.dir))
    return perp, t


# --------------------------------------------------------------------------- size
def physical_size(distance_m: float, yaw_left: float, yaw_right: float, elev_bottom: float, elev_top: float,
                  view_bearing: float, facing: float | None, camera_height_m: float) -> tuple[float, float, float]:
    """Approximate (width, height, bottom height above ground) in metres.

    Width is corrected for oblique viewing: a panel seen at an angle looks narrower.
    """
    ang_w = math.radians(((yaw_right - yaw_left + 180) % 360) - 180)
    apparent_w = 2 * distance_m * math.tan(abs(ang_w) / 2)
    if facing is not None:
        # angle between the line of sight (towards camera) and the panel's normal
        incidence = angle_diff((view_bearing + 180) % 360, facing)
        apparent_w /= max(math.cos(math.radians(incidence)), 0.35)
    top = distance_m * math.tan(math.radians(elev_top))
    bottom = distance_m * math.tan(math.radians(elev_bottom))
    return apparent_w, top - bottom, camera_height_m + bottom
