import json
import math

from scene import CAM_H, PLANE, FakeSource, Panel, detector, street

from billboard_scout import Area, ScanOptions, scan
from billboard_scout.geometry import angle_diff


def area_around(images, pad=0.002):
    lons = [i.lon for i in images]
    lats = [i.lat for i in images]
    return Area.from_bbox(min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)


def run(panels, images, **kw):
    jitter = kw.pop("jitter_px", 0.0)
    opts = ScanOptions(camera_height_m=CAM_H, n_views=6, view_width=800, **kw)
    return scan(area_around(images), FakeSource(images), detector(panels, images, jitter_px=jitter), options=opts)


def test_finds_billboards_position_size_and_facing():
    panels = [
        Panel(5.0, 25.0, 180.0, 6.0, 3.0, 4.0),     # 6x3 north of the road, facing it
        Panel(-18.0, -12.0, 0.0, 1.2, 1.76, 0.4),   # bus-shelter panel south of the road
        Panel(30.0, 40.0, 225.0, 4.0, 3.0, 3.5),    # 4x3, angled
    ]
    images = street()
    res = run(panels, images, jitter_px=1.5)
    assert len(res.billboards) == 3, res.log
    for p in panels:
        lon, lat = PLANE.to_lonlat(p.x, p.y)
        b = min(res.billboards, key=lambda b: (b.lon - lon) ** 2 + (b.lat - lat) ** 2)
        x, y = PLANE.to_xy(b.lon, b.lat)
        assert math.hypot(x - p.x, y - p.y) < 1.5
        assert angle_diff(b.facing_azimuth, p.facing) < 35
        assert b.n_views >= 2
    fmts = sorted(b.format for b in res.billboards)
    assert fmts == ["bus_shelter", "poster_4x3", "poster_6x3"], [(b.format, b.width_m, b.height_m) for b in res.billboards]
    six = next(b for b in res.billboards if b.format == "poster_6x3")
    assert abs(six.bottom_height_m - 4.0) < 0.8
    assert six.first_seen <= six.last_seen


def test_perspective_cameras_facing_forward():
    panels = [Panel(60.0, 8.0, 270.0, 6.0, 3.0, 3.0)]  # ahead on the right, facing oncoming cars
    images = street(n=9, spacing=6.0, heading=90.0, camera_type="perspective", fov=80)
    res = run(panels, images)
    assert len(res.billboards) == 1, res.log
    assert res.billboards[0].format == "poster_6x3"


def test_single_view_is_not_located():
    panels = [Panel(0.0, 20.0, 180.0, 6.0, 3.0, 4.0)]
    images = street(n=1)
    res = run(panels, images)
    assert res.billboards == [] and res.unmatched_detections >= 1


def test_geojson_ready_for_adv_flow(tmp_path):
    panels = [Panel(5.0, 25.0, 180.0, 6.0, 3.0, 4.0)]
    images = street()
    res = run(panels, images)
    out = json.loads(res.save(tmp_path / "b.geojson").read_text())
    props = out["features"][0]["properties"]
    for k in ["format", "facing_azimuth", "width_m", "height_m", "ownership", "confidence", "image_ids", "first_seen"]:
        assert k in props
    assert props["ownership"] == "unknown"
    assert out["attribution"] == "synthetic test scene"


def test_false_detections_do_not_create_billboards():
    """Detectors make mistakes: random boxes must not turn into billboards."""
    import random

    from billboard_scout.detect import Box, FunctionDetector

    panels = [Panel(5.0, 25.0, 180.0, 6.0, 3.0, 4.0), Panel(30.0, 40.0, 225.0, 4.0, 3.0, 3.5)]
    images = street()
    real = detector(panels, images, jitter_px=1.5)
    rnd = random.Random(7)

    def noisy(pixels, view):
        boxes = real.detect(pixels, view)
        for _ in range(2):  # two random false positives in every view
            x, y = rnd.uniform(0, view.width - 80), rnd.uniform(0, view.height - 60)
            boxes.append(Box(x, y, x + rnd.uniform(30, 80), y + rnd.uniform(20, 60), 0.5))
        return boxes

    res = scan(area_around(images), FakeSource(images), FunctionDetector(noisy), options=ScanOptions(camera_height_m=CAM_H, view_width=800))
    # Coincidences may come out as low-confidence candidates for review, never as confident finds.
    strong = [b for b in res.billboards if b.confidence >= 0.5]
    assert len(strong) == 2, [(b.format, b.n_views, b.confidence) for b in res.billboards]
    assert sorted(b.format for b in strong) == ["poster_4x3", "poster_6x3"]
