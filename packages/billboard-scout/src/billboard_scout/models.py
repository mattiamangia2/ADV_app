"""Plain data types shared by sources, detectors, readers and the pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

CameraType = Literal["spherical", "perspective"]


@dataclass
class StreetImage:
    """One street-level photo and its camera pose."""

    id: str
    lon: float
    lat: float
    heading: float  # compass direction of the image centre, degrees (0 = north, 90 = east)
    width: int
    height: int
    camera_type: CameraType = "perspective"
    # Horizontal field of view in degrees (perspective images only).
    fov_deg: float = 70.0
    captured_at: str | None = None  # ISO 8601
    url: str | None = None  # where the pixels can be downloaded
    path: str | None = None  # or a local file
    source: str = "unknown"
    sequence: str | None = None
    attribution: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class View:
    """A perspective view the detector actually looks at.

    Perspective photos are a single view. 360° panoramas are cut into several
    perspective views (less distortion, so detectors work much better).
    """

    image: StreetImage
    yaw: float  # compass direction of the view centre
    pitch: float  # degrees up from the horizon
    fov_deg: float  # horizontal field of view
    width: int
    height: int
    pixels: Any = None  # PIL.Image, filled lazily


@dataclass
class Detection:
    """A box around something that looks like a billboard, in view pixels."""

    image_id: str
    x0: float
    y0: float
    x1: float
    y1: float
    score: float
    label: str = "billboard"
    view_yaw: float = 0.0
    view_pitch: float = 0.0
    view_fov: float = 90.0
    view_width: int = 0
    view_height: int = 0
    crop: Any = None  # PIL.Image of the box, for content reading
    content: dict[str, Any] = field(default_factory=dict)


@dataclass
class Billboard:
    """A billboard located from one or more detections."""

    lon: float
    lat: float
    facing_azimuth: float | None
    width_m: float | None
    height_m: float | None
    bottom_height_m: float | None
    format: str
    format_label: str
    format_error: float | None
    n_views: int
    confidence: float
    position_error_m: float | None
    image_ids: list[str]
    first_seen: str | None
    last_seen: str | None
    brand: str | None = None
    text: str | None = None
    is_empty: bool | None = None
    sources: list[str] = field(default_factory=list)
    attribution: str | None = None

    def to_properties(self) -> dict[str, Any]:
        """Flat properties, compatible with ADV·Flow's billboard import."""
        d = asdict(self)
        d.pop("lon"), d.pop("lat")
        d["image_ids"] = ",".join(self.image_ids)
        d["sources"] = ",".join(self.sources)
        return d
