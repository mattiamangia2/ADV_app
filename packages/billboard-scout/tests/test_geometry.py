import math

import numpy as np
import pytest

from billboard_scout import Area, snap
from billboard_scout.geometry import Ray, angles_to_pixel, intersect_two, least_squares_point, pixel_to_angles


@pytest.mark.parametrize("pitch", [0, 8, -5])
def test_pixel_angle_round_trip(pitch):
    for x, y in [(512, 384), (10, 20), (1000, 700), (300, 100)]:
        yaw, elev = pixel_to_angles(x, y, 37, pitch, 90, 1024, 768)
        px = angles_to_pixel(yaw, elev, 37, pitch, 90, 1024, 768)
        assert px is not None and abs(px[0] - x) < 1e-6 and abs(px[1] - y) < 1e-6


def test_centre_pixel_looks_along_view():
    yaw, elev = pixel_to_angles(512, 384, 200, 0, 90, 1024, 768)
    assert abs(yaw - 200) < 1e-9 and abs(elev) < 1e-9
    yaw, _ = pixel_to_angles(1024, 384, 0, 0, 90, 1024, 768)  # right edge = +45°
    assert abs(yaw - 45) < 1e-9


def test_triangulation():
    target = np.array([10.0, 30.0])
    rays = []
    for k, ox in enumerate([-20.0, 0.0, 25.0]):
        o = np.array([ox, 0.0])
        b = math.degrees(math.atan2(*(target - o))) % 360
        rays.append(Ray(o, b, k, f"i{k}"))
    p, ta, tb = intersect_two(rays[0], rays[1])
    assert np.allclose(p, target) and ta > 0 and tb > 0
    assert np.allclose(least_squares_point(rays), target)
    assert intersect_two(Ray(np.zeros(2), 10, 0, "a"), Ray(np.array([1.0, 0]), 10.5, 1, "b")) is None  # ~parallel


def test_snap_formats():
    f, err = snap(6.4, 2.8)
    assert f.key == "poster_6x3" and err < 0.15
    assert snap(1.15, 1.8)[0].key == "bus_shelter"
    assert snap(3.0, 0.5)[0] is None  # nothing like it


def test_area():
    a = Area.from_geojson({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[9, 45], [9.1, 45], [9.1, 45.1], [9, 45.1], [9, 45]]]}})
    assert a.contains(9.05, 45.05) and not a.contains(9.2, 45.05)
    with pytest.raises(ValueError, match="EPSG:4326"):
        Area.from_geojson({"type": "Polygon", "coordinates": [[[500000, 5000000], [500100, 5000000], [500100, 5000100], [500000, 5000000]]]})
