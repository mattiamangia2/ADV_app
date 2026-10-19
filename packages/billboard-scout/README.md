# billboard-scout

Find outdoor advertising (billboards, posters, digital screens) in **street-level imagery** and turn it into map data: position, facing direction, size, standard format, and optionally the text, brand, or whether the panel is empty.

```python
from billboard_scout import Area, scan
from billboard_scout.sources import MapillarySource
from billboard_scout.detect import GroundingDinoDetector

result = scan(Area.from_geojson("my_area.geojson"), MapillarySource(token="MLY|..."), GroundingDinoDetector())
result.save("billboards.geojson")   # open in QGIS, import into ADV·Flow, …
df = result.to_dataframe()          # pandas, or GeoPandas when installed
```

> **Status: alpha (0.1).** The geometry is tested on synthetic scenes. Real-world accuracy still needs measuring against surveyed billboards.

## How it works

1. **Area → photos.** It lists the street photos inside your polygon, keeps the newest ones and skips near-duplicates (photos closer than 5 m).
2. **Photo → views.** A 360° panorama is cut into 6 overlapping perspective views. Plain photos are used as they are.
3. **Views → detections.** A detector draws boxes around anything that looks like a billboard. The default is **Grounding DINO**, a "zero-shot" model: you describe the object in words, and no training is needed.
4. **Detections → positions.** Each box is a sight line from its camera, and where sight lines from different photos cross, there's a billboard. The best-supported crossing is taken first and its sight lines are removed, which stops coincidental crossings ("ghosts") from stealing real detections. A candidate is kept only if every photo agrees on its height above the ground and its size.
5. **Size and facing.** Distance turns angular size into metres. A panel seen at an angle looks narrower, so the facing direction is the one that makes all views agree on a single width. The size is then **snapped to the nearest standard format** (6×3, 4×3, 3×2, 1.4×2, 1.2×1.76, 12×4 …), because measurements from photos are only good to about ±20–30 %.
6. **Content** (optional): flags blank panels, reads the text with OCR, spots "spazio disponibile"-style notices and matches a brand list.

Each result carries a **confidence** (0–1), the number of photos that saw it, the position error, the capture dates of the photos, and the photo IDs, so you can check every find.

## Install

```bash
pip install "billboard-scout[detect,geo]"         # detector + GeoPandas
pip install "billboard-scout[ocr]"                # text reading (also install the Tesseract program)
```

For development, from this folder: `pip install -e ".[dev]" && pytest`

## Image sources

| Source | What | Cost |
|---|---|---|
| `MapillarySource(token)` | Crowd-sourced street photos, worldwide. Get a free client token at mapillary.com/dashboard/developers. | Free |
| `FolderSource(path)` | Your own photos (phone, GoPro, 360° camera), geotagged in EXIF or listed in a `manifest.csv` | Free |
| *your own* | Implement `images(area)` and `load(image)`; see `sources/base.py` | — |

**Why there is no Google Street View source:** Google's terms forbid scraping Street View, bulk-downloading its images, and extracting data from them or using them for machine learning. That applies to the paid API too. Don't add a Google source to this project.

**Photo age:** open imagery can be months or years old. Billboard *positions* rarely change, but brands and campaigns do, so use `first_seen` / `last_seen` and `MapillarySource(min_date="2025-01-01")`.

## Output columns

| Field | Meaning |
|---|---|
| `lon`, `lat` | Position (EPSG:4326) |
| `facing_azimuth` | Direction the face points to (0 = north) |
| `width_m`, `height_m`, `bottom_height_m` | Measured size and height above the ground |
| `format`, `format_label`, `format_error` | Closest standard format, and how far the measurement is from it |
| `n_views`, `confidence`, `position_error_m` | How well supported the find is |
| `first_seen`, `last_seen`, `image_ids`, `sources`, `attribution` | Where the data comes from |
| `brand`, `text`, `is_empty` | Content, when a reader is used |
| `ownership` | Always `unknown`, so ADV·Flow imports finds as "sites that aren't ours" |

## Command line

```bash
export MAPILLARY_TOKEN=MLY|...
billboard-scout scan --area area.geojson --since 2024-01-01 --out billboards.geojson
billboard-scout scan --bbox 9.18 45.46 9.20 45.47 --ocr --brands "Coca-Cola,Vodafone,Esselunga"
billboard-scout scan --source folder --folder ./my_drive --camera-height 1.9
```

## With QGIS

1. Draw a polygon layer, then export it as **GeoJSON, EPSG:4326**.
2. Run the command above.
3. Drag `billboards.geojson` into QGIS. Style it by `confidence` or `format`.

A QGIS Processing plugin is on the roadmap.

## With ADV·Flow

In *Inventory ▸ Import as: sites that aren't ours ▸ Import CSV / GeoJSON*, choose `billboards.geojson`. Format, facing and size are filled in. Review the low-confidence finds first.

## Choosing settings

| Situation | Setting |
|---|---|
| Car-roof camera | `ScanOptions(camera_height_m=2.5)` (default) |
| Hand-held phone | `camera_height_m=1.6` |
| Sparse photos (only 2 per billboard) | `min_views=2` (default); treat finds with confidence < 0.5 as "to review" |
| Dense photos, want fewer false finds | `min_views=3` |
| Big scans | `max_images`, and `MapillarySource(resolution="2048")` |
| Reading brands | `MapillarySource(resolution="original")` plus a reader |

## Accuracy and limits

- Position: within about 1–2 m when 3 or more photos see the billboard; worse with only 2.
- Size: ±20–30 % before snapping. Snapping is usually right for standard formats, and the result says `custom` when nothing fits.
- Small posters (70×100) need close, sharp photos. Night and rain photos hurt detection.
- Brand reading depends on photo resolution and viewing angle. A vision-language model reads brands best; plug one in as a `ContentReader`.
- Faces and number plates: Mapillary blurs them. Your own photos must be blurred before you publish them (GDPR).

## Roadmap

- [ ] Measure accuracy on a surveyed sample in Milan
- [ ] Fine-tuned detector trained on reviewed finds (faster than zero-shot, and more accurate)
- [ ] QGIS Processing plugin
- [ ] Vision-language reader for brand / advertiser / category
- [ ] Panoramax and KartaView sources
- [ ] Video input (360° camera MP4 with GPS track)

## Licence

Apache-2.0 for the code. Imagery and model weights keep their own licences: check the source's terms before publishing derived data, and keep the `attribution` field.
