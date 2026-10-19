"""Standard outdoor-advertising formats and snapping a measured size to the closest one.

Measured sizes from photos are rough (±20–30 %). Real billboards come in a handful of
standard sizes, so snapping to the closest standard gives a much better answer.
Keys match ADV·Flow's format catalogue; add your country's formats with `register_format`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Format:
    key: str
    label: str
    width_m: float
    height_m: float


FORMATS: list[Format] = [
    Format("poster_6x3", "Billboard 6×3 m", 6.0, 3.0),
    Format("poster_4x3", "Billboard 4×3 m", 4.0, 3.0),
    Format("backlit", "Backlit box 3×2 m", 3.0, 2.0),
    Format("street_poster", "Street poster 1.4×2 m", 1.4, 2.0),
    Format("street_poster", "Street poster 1×1.4 m", 1.0, 1.4),
    Format("street_poster", "Street poster 0.7×1 m", 0.7, 1.0),
    Format("bus_shelter", "Bus shelter / city light 1.2×1.76 m", 1.2, 1.76),
    Format("digital_totem", "Digital totem 1.2×2 m", 1.2, 2.0),
    Format("motorway", "Motorway billboard 12×4 m", 12.0, 4.0),
    Format("poster_6x3", "Billboard 8×3 m", 8.0, 3.0),
    Format("maxi_wrap", "Maxi poster / building wrap", 20.0, 15.0),
]


def register_format(fmt: Format) -> None:
    FORMATS.append(fmt)


def snap(width_m: float | None, height_m: float | None, max_error: float = 0.35) -> tuple[Format | None, float | None]:
    """Closest standard format and the relative error (0.1 = 10 %).

    Returns (None, error) when nothing is within `max_error`.
    """
    if not width_m or not height_m or width_m <= 0 or height_m <= 0:
        return None, None
    best, best_err = None, math.inf
    for f in FORMATS:
        # log-ratio distance: being 2× too big or too small is equally wrong
        err = math.hypot(math.log(width_m / f.width_m), math.log(height_m / f.height_m))
        if err < best_err:
            best, best_err = f, err
    rel = math.exp(best_err) - 1
    return (best if rel <= max_error else None), rel
