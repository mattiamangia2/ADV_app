import csv
import io

import pytest
from PIL import Image

from billboard_scout import Area
from billboard_scout.read import HeuristicReader
from billboard_scout.sources import FolderSource, MapillarySource


class FakeResponse:
    def __init__(self, payload=None, status=200, content=b""):
        self._p, self.status_code, self.content = payload, status, content

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeSession:
    def __init__(self, records):
        self.records, self.calls = records, []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        if url.endswith("/images"):
            w, s, e, n = (float(v) for v in params["bbox"].split(","))
            hits = [r for r in self.records if w <= r["geometry"]["coordinates"][0] < e and s <= r["geometry"]["coordinates"][1] < n]
            return FakeResponse({"data": hits})
        buf = io.BytesIO()
        Image.new("RGB", (64, 32)).save(buf, "JPEG")
        return FakeResponse(content=buf.getvalue())


def rec(i, lon, lat, cam="perspective", **kw):
    return {"id": str(i), "geometry": {"type": "Point", "coordinates": [lon, lat]}, "compass_angle": 90.0, "captured_at": 1767225600000,
            "camera_type": cam, "camera_parameters": [0.8, 0, 0], "width": 4000, "height": 3000, "thumb_2048_url": f"https://img/{i}", **kw}


def test_mapillary_listing_filters_and_maps_fields(tmp_path):
    records = [
        rec(1, 9.1905, 45.4645),
        rec(2, 9.1906, 45.4646, cam="equirectangular", width=8000, height=4000, computed_compass_angle=95.5),
        rec(3, 9.1907, 45.4647, cam="fisheye"),            # skipped by default
        rec(4, 9.3, 45.6),                                 # outside the area
    ]
    session = FakeSession(records)
    src = MapillarySource("TOKEN", session=session, cache_dir=tmp_path, pause_s=0)
    area = Area.from_bbox(9.19, 45.464, 9.191, 45.465)
    imgs = {i.id: i for i in src.images(area)}
    assert set(imgs) == {"1", "2"}
    assert imgs["2"].camera_type == "spherical" and imgs["2"].heading == 95.5
    assert (imgs["2"].width, imgs["2"].height) == (2048, 1024)
    assert 60 < imgs["1"].fov_deg < 70  # focal 0.8 × 4000 px on a 4000 px wide image ≈ 64°
    assert imgs["1"].captured_at.startswith("2026-01-01")
    assert all(c[1]["access_token"] == "TOKEN" for c in session.calls)
    photo = src.load(imgs["1"])
    assert photo.size == (64, 32)
    assert len(list(tmp_path.iterdir())) == 1  # cached
    src.load(imgs["1"])
    assert sum(1 for c in session.calls if not c[0].endswith("/images")) == 1


def test_mapillary_needs_token(monkeypatch):
    monkeypatch.delenv("MAPILLARY_TOKEN", raising=False)
    with pytest.raises(ValueError, match="token"):
        MapillarySource()


def test_folder_manifest(tmp_path):
    Image.new("RGB", (2000, 1000)).save(tmp_path / "pano.jpg")
    Image.new("RGB", (1600, 1200)).save(tmp_path / "phone.jpg")
    with (tmp_path / "manifest.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "lon", "lat", "heading", "captured_at"])
        w.writerow(["pano.jpg", 9.19, 45.46, 10, "2026-10-01T09:00:00"])
        w.writerow(["phone.jpg", 9.191, 45.461, 200, ""])
    imgs = {i.id: i for i in FolderSource(tmp_path).images(Area.from_bbox(9.18, 45.45, 9.2, 45.47))}
    assert imgs["pano"].camera_type == "spherical" and imgs["phone"].camera_type == "perspective"
    assert imgs["phone"].heading == 200


def test_heuristic_reader_flags_blank_panels():
    blank = Image.new("RGB", (200, 100), (240, 240, 240))
    busy = Image.effect_noise((200, 100), 80).convert("RGB")
    assert HeuristicReader().read(blank)["is_empty"] is True
    assert HeuristicReader().read(busy) == {}
