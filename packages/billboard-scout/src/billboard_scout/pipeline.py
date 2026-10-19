"""The scan pipeline: area → images → views → detections → located billboards.

Locating: every detection is a sight line from its camera. The same billboard seen
from two or more nearby photos gives crossing sight lines; where they cross is
the billboard. Distance from each camera then turns the box's angular size into
metres, which we snap to the closest standard format.
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from .area import Area
from .detect.base import Detector
from .formats import snap
from .geometry import LocalPlane, Ray, angle_diff, bearing_xy, circular_mean, intersect_two, least_squares_point, physical_size, pixel_to_angles, ray_distance
from .models import Billboard, Detection, StreetImage, View
from .views import make_views, render_view


@dataclass
class ScanOptions:
    max_images: int = 400
    min_spacing_m: float = 5.0  # skip photos closer than this to an already chosen one
    n_views: int = 6  # perspective views cut from each 360° panorama
    view_fov_deg: float = 90.0
    view_pitch_deg: float = 8.0  # look slightly up: billboards are above the street
    view_width: int = 1024
    min_score: float = 0.3
    camera_height_m: float = 2.5  # roof-mounted camera; ~1.6 for a hand-held phone
    max_range_m: float = 120.0  # ignore crossings further than this from the cameras
    min_range_m: float = 3.0
    max_baseline_m: float = 60.0  # only pair photos taken this close to each other
    cluster_radius_m: float = 6.0
    ray_tolerance_m: float = 3.5
    min_views: int = 2
    format_max_error: float = 0.35
    max_bottom_spread_m: float = 0.8  # views must agree on height above ground…
    max_height_spread: float = 0.2  # …and on the panel height (±20 %)
    max_candidates: int = 20000  # crossing points evaluated (sampled above this)


@dataclass
class ScanResult:
    billboards: list[Billboard]
    images: list[StreetImage]
    detections: list[Detection]
    unmatched_detections: int = 0
    log: list[str] = field(default_factory=list)

    # ------------------------------------------------------------------ outputs
    def to_geojson(self) -> dict:
        attributions = sorted({i.attribution for i in self.images if i.attribution})
        return {
            "type": "FeatureCollection",
            "name": "billboard_scout",
            "attribution": "; ".join(attributions) or None,
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(b.lon, 7), round(b.lat, 7)]},
                 "properties": {"name": f"{b.format_label} (detected {b.last_seen[:10] if b.last_seen else ''})".replace(" ()", ""),
                                **b.to_properties(), "ownership": "unknown", "data_source": f"billboard-scout ({', '.join(b.sources)})"}}
                for b in self.billboards
            ],
        }

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.write_text(json.dumps(self.to_geojson(), indent=1, ensure_ascii=False))
        return p

    def to_dataframe(self):
        """pandas DataFrame, or a GeoDataFrame (EPSG:4326) if geopandas is installed."""
        import pandas as pd

        rows = [{"lon": b.lon, "lat": b.lat, **b.to_properties()} for b in self.billboards]
        df = pd.DataFrame(rows)
        try:
            import geopandas as gpd

            return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.get("lon", []), df.get("lat", [])), crs="EPSG:4326")
        except ImportError:
            return df


def scan(area: Area | dict | str, source, detector: Detector, reader=None, options: ScanOptions | None = None,
         progress: Callable[[str], None] | None = None) -> ScanResult:
    """Find billboards inside `area` using `source` images and `detector`."""
    o = options or ScanOptions()
    say = progress or (lambda _m: None)
    log: list[str] = []
    if not isinstance(area, Area):
        area = Area.from_geojson(area)

    images = source.images(area)
    log.append(f"{len(images)} images in the area from {getattr(source, 'name', 'source')}")
    images = _thin(images, o.min_spacing_m, o.max_images)
    log.append(f"{len(images)} images kept after spacing ≥ {o.min_spacing_m} m (max {o.max_images})")
    say(log[-1])

    detections: list[Detection] = []
    for n, img in enumerate(images, 1):
        try:
            photo = source.load(img)
        except Exception as e:  # network hiccup or broken file: skip the image
            log.append(f"skipped image {img.id}: {e}")
            continue
        for view in make_views(img, o.n_views, o.view_fov_deg, o.view_pitch_deg, o.view_width):
            pixels = render_view(view, photo)
            view.width, view.height = pixels.size
            for b in detector.detect(pixels, view):
                if b.score < o.min_score:
                    continue
                d = Detection(img.id, b.x0, b.y0, b.x1, b.y1, b.score, b.label, view.yaw, view.pitch, view.fov_deg, view.width, view.height)
                if reader is not None:
                    d.crop = pixels.crop((int(b.x0), int(b.y0), int(b.x1), int(b.y1)))
                detections.append(d)
        if n % 10 == 0:
            say(f"{n}/{len(images)} images, {len(detections)} detections")
    log.append(f"{len(detections)} detections")

    billboards, unmatched = locate(images, detections, o)
    log.append(f"{len(billboards)} billboards located; {unmatched} detections seen from only one place (not located)")
    if reader is not None:
        _read_content(billboards, detections, reader)
    say(log[-1])
    return ScanResult(billboards, images, detections, unmatched, log)


# ---------------------------------------------------------------------------- locating
def locate(images: list[StreetImage], detections: list[Detection], o: ScanOptions | None = None) -> tuple[list[Billboard], int]:
    o = o or ScanOptions()
    if not detections:
        return [], 0
    by_id = {i.id: i for i in images}
    plane = LocalPlane(statistics.fmean(i.lon for i in images), statistics.fmean(i.lat for i in images))
    cams = {i.id: np.array(plane.to_xy(i.lon, i.lat)) for i in images}

    rays: list[Ray] = []
    for k, d in enumerate(detections):
        cx, cy = (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2
        yaw, _ = pixel_to_angles(cx, cy, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
        rays.append(Ray(cams[d.image_id], yaw, k, d.image_id))

    # 1. Crossing points of sight lines from different, nearby photos.
    points = []
    for i in range(len(rays)):
        for j in range(i + 1, len(rays)):
            a, b = rays[i], rays[j]
            if a.image_id == b.image_id or np.linalg.norm(a.origin - b.origin) > o.max_baseline_m:
                continue
            hit = intersect_two(a, b)
            if hit is None:
                continue
            p, ta, tb = hit
            if o.min_range_m < ta < o.max_range_m and o.min_range_m < tb < o.max_range_m:
                points.append(p)

    # 2-3. Greedy consensus: repeatedly take the crossing point that the most unused
    # sight lines agree on, refine it, and remove those sight lines. Taking the
    # strongest first stops weaker "ghost" crossings (sight lines of two different
    # billboards that happen to cross) from stealing real detections.
    found: list[tuple[np.ndarray, list[Ray], float]] = []
    used = np.zeros(len(rays), dtype=bool)
    if points:
        P = np.array(points)
        if len(P) > o.max_candidates:  # keep it fast on very large scans
            P = P[np.random.default_rng(0).choice(len(P), o.max_candidates, replace=False)]
        O = np.array([r.origin for r in rays])
        D = np.array([r.dir for r in rays])
        V = P[:, None, :] - O[None, :, :]
        T = np.einsum("nmk,mk->nm", V, D)
        perp = np.linalg.norm(V - T[..., None] * D[None, :, :], axis=2)
        S = (perp <= o.ray_tolerance_m) & (T > o.min_range_m) & (T < o.max_range_m)
        alive = np.ones(len(P), dtype=bool)
        while True:
            counts = np.where(alive, (S & ~used).sum(axis=1), -1)
            i = int(np.argmax(counts))
            if counts[i] < o.min_views:
                break
            alive[i] = False
            group = _one_per_image([rays[k] for k in np.flatnonzero(S[i] & ~used)], P[i])
            if len(group) < o.min_views:
                continue
            pos = least_squares_point(group)
            group = _one_per_image([r for r in rays if not used[r.key] and _supports(r, pos, o)], pos)
            # A real object has the same height above ground and the same size in every
            # photo; sight lines that only cross by coincidence don't.
            group = _vertically_consistent(group, pos, detections, o)
            if len(group) < o.min_views:
                continue
            pos = least_squares_point(group)
            err = math.sqrt(statistics.fmean(ray_distance(r, pos)[0] ** 2 for r in group))
            # every sight line pointing here is now explained, including duplicates from
            # overlapping views of the same panorama
            for r in rays:
                if not used[r.key] and _supports(r, pos, o):
                    used[r.key] = True
            if any(np.linalg.norm(pos - f[0]) < o.cluster_radius_m for f in found):
                continue  # duplicate of a billboard already found
            found.append((pos, group, err))

    # 4. Measure each billboard.
    out: list[Billboard] = []
    for pos, group, err in found:
        dets = [detections[r.key] for r in group]
        to_cams = [bearing_xy(*(r.origin - pos)) for r in group]
        # angular measurements per view: (distance, yaw left, yaw right, elev bottom, elev top, bearing)
        meas = []
        for r, d in zip(group, dets):
            dist = float(np.linalg.norm(pos - r.origin))
            midx, midy = (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2
            yl, _ = pixel_to_angles(d.x0, midy, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
            yr, _ = pixel_to_angles(d.x1, midy, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
            _, et = pixel_to_angles(midx, d.y0, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
            _, eb = pixel_to_angles(midx, d.y1, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
            meas.append((dist, yl, yr, eb, et, r.bearing))
        facing = _fit_facing(meas, to_cams, [d.score for d in dets])
        widths, heights, bottoms = [], [], []
        for dist, yl, yr, eb, et, brg in meas:
            w, h, b = physical_size(dist, yl, yr, eb, et, brg, facing, o.camera_height_m)
            widths.append(w), heights.append(h), bottoms.append(b)
        w, h = statistics.median(widths), statistics.median(heights)
        fmt, ferr = snap(w, h, o.format_max_error)
        lon, lat = plane.to_lonlat(*pos)
        dates = sorted(d for d in (by_id[r.image_id].captured_at for r in group) if d)
        score = statistics.fmean(d.score for d in dets)
        # detector score × how many photos agree × how well the sight lines meet × whether
        # the size matches a real format. Low values are candidates for human review.
        confidence = score * min(1.0, len(group) / 3) * (1 - 0.5 * min(err / o.ray_tolerance_m, 1)) * (1.0 if fmt else 0.6)
        out.append(Billboard(
            lon=lon, lat=lat, facing_azimuth=round(facing, 1), width_m=round(w, 2), height_m=round(h, 2),
            bottom_height_m=round(statistics.median(bottoms), 2),
            format=fmt.key if fmt else "custom", format_label=fmt.label if fmt else f"≈{w:.1f}×{h:.1f} m",
            format_error=round(ferr, 2) if ferr is not None else None, n_views=len(group),
            confidence=round(confidence, 2), position_error_m=round(err, 2),
            image_ids=[r.image_id for r in group], first_seen=dates[0] if dates else None, last_seen=dates[-1] if dates else None,
            sources=sorted({by_id[r.image_id].source for r in group}),
            attribution="; ".join(sorted({by_id[r.image_id].attribution for r in group if by_id[r.image_id].attribution})) or None,
        ))
        out[-1]._keys = [r.key for r in group]  # type: ignore[attr-defined]
    return out, int((~used).sum())


def _fit_facing(meas: list[tuple], to_cams: list[float], weights: list[float]) -> float:
    """Direction the panel faces.

    A panel seen from the side looks narrower (by the cosine of the viewing angle).
    The right facing is the one that makes every view agree on the same true width.
    With little angular spread between views this is undetermined, so we fall back
    to the average direction towards the cameras.
    """
    mean_dir = circular_mean(to_cams, weights)
    spread = max(angle_diff(a, b) for a in to_cams for b in to_cams) if len(to_cams) > 1 else 0
    if len(meas) < 3 or spread < 25:
        return mean_dir
    apparent = [2 * d * math.tan(abs(math.radians(((yr - yl + 180) % 360) - 180)) / 2) for d, yl, yr, *_ in meas]
    best, best_cv = mean_dir, math.inf
    for k in range(-80, 81, 2):
        f = (mean_dir + k) % 360
        cos_i = [math.cos(math.radians(angle_diff(c, f))) for c in to_cams]
        if min(cos_i) < 0.25:
            continue  # some camera would see the panel edge-on or from behind
        w = [a / c for a, c in zip(apparent, cos_i)]
        m = statistics.fmean(w)
        cv = statistics.pstdev(w) / m if m > 0 else math.inf
        if cv < best_cv:
            best, best_cv = f, cv
    return best


def _vertical(r: Ray, pos: np.ndarray, d: Detection, camera_height_m: float) -> tuple[float, float]:
    """(bottom height above ground, height) in metres implied by a detection at `pos`."""
    dist = float(np.linalg.norm(pos - r.origin))
    midx = (d.x0 + d.x1) / 2
    _, et = pixel_to_angles(midx, d.y0, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
    _, eb = pixel_to_angles(midx, d.y1, d.view_yaw, d.view_pitch, d.view_fov, d.view_width, d.view_height)
    bottom = camera_height_m + dist * math.tan(math.radians(eb))
    return bottom, dist * (math.tan(math.radians(et)) - math.tan(math.radians(eb)))


def _vertically_consistent(group: list[Ray], pos: np.ndarray, detections: list[Detection], o: ScanOptions) -> list[Ray]:
    if len(group) < 2:
        return group
    v = [_vertical(r, pos, detections[r.key], o.camera_height_m) for r in group]
    mb = statistics.median(b for b, _ in v)
    mh = statistics.median(h for _, h in v)
    if mh <= 0.2:
        return []
    return [r for r, (b, h) in zip(group, v)
            if abs(b - mb) <= o.max_bottom_spread_m and abs(h - mh) <= o.max_height_spread * mh]


def _one_per_image(rays: list[Ray], pos: np.ndarray) -> list[Ray]:
    best: dict[str, tuple[float, Ray]] = {}
    for r in rays:
        d = ray_distance(r, pos)[0]
        if r.image_id not in best or d < best[r.image_id][0]:
            best[r.image_id] = (d, r)
    return [r for _, r in best.values()]


def _supports(r: Ray, pos: np.ndarray, o: ScanOptions) -> bool:
    perp, t = ray_distance(r, pos)
    return perp <= o.ray_tolerance_m and o.min_range_m < t < o.max_range_m


def _thin(images: list[StreetImage], min_spacing: float, max_images: int) -> list[StreetImage]:
    if not images:
        return []
    plane = LocalPlane(images[0].lon, images[0].lat)
    images = sorted(images, key=lambda i: (i.captured_at or ""), reverse=True)  # prefer recent photos
    kept: list[tuple[np.ndarray, StreetImage]] = []
    for img in images:
        p = np.array(plane.to_xy(img.lon, img.lat))
        if all(np.linalg.norm(p - q) >= min_spacing or angle_diff(img.heading, k.heading) > 90 for q, k in kept):
            kept.append((p, img))
        if len(kept) >= max_images:
            break
    return [k for _, k in kept]


def _read_content(billboards: list[Billboard], detections: list[Detection], reader) -> None:
    for b in billboards:
        keys = getattr(b, "_keys", [])
        reads = []
        for k in sorted(keys, key=lambda k: -(detections[k].x1 - detections[k].x0) * (detections[k].y1 - detections[k].y0)):
            d = detections[k]
            if d.crop is None:
                continue
            r = reader.read(d.crop) or {}
            d.content = r
            reads.append(r)
        texts = [r["text"] for r in reads if r.get("text")]
        brands = [r["brand"] for r in reads if r.get("brand")]
        empties = [r["is_empty"] for r in reads if r.get("is_empty") is not None]
        b.text = max(texts, key=len) if texts else None
        b.brand = max(set(brands), key=brands.count) if brands else None
        b.is_empty = (sum(empties) > len(empties) / 2) if empties else None
