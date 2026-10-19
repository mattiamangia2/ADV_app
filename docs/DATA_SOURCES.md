# Data sources & licences register

Every external dataset or map service used by ADV·Flow gets a row here **before** it goes into the app. This is how we know what credit to show, what we may resell, and what to replace before going commercial.

> Summaries below are practical notes, not legal advice. For a commercial launch, have the licences checked.

## Register

| # | Source | What we use | Licence / terms | Credit to show | Commercial use | Status / action |
|---|---|---|---|---|---|---|
| 1 | **OpenStreetMap** (Overpass API, QuickOSM, overpass-turbo) | Road network for demo traffic; billboards & bus shelters imported from OSM | **ODbL 1.0** (OpenStreetMap Foundation) | "© OpenStreetMap contributors", linked to https://www.openstreetmap.org/copyright | ✅ Allowed, with the conditions below | ✅ Credit always visible on the map and the Mobility data page. Imported OSM billboards carry `data_source = OpenStreetMap contributors (ODbL)`. |
| 2 | **CARTO base maps** (Dark Matter, Voyager, Positron) | Map backgrounds | CARTO Basemap Terms | "© OpenStreetMap contributors, © CARTO" | ⚠️ **Needs a CARTO Enterprise licence.** Free use is for non-commercial purposes only. | ⚠️ OK for development and demos. **Before selling:** license CARTO, or switch to a base map that allows commercial use (self-hosted Protomaps/OpenMapTiles, OpenFreeMap, or a paid MapTiler/Mapbox plan). |
| 3 | **Esri World Imagery** | Satellite background | Esri / ArcGIS terms of use | "© Esri, Maxar, Earthstar Geographics" | ⚠️ Check: production use normally needs an ArcGIS account/plan | ⚠️ Same as #2: check before selling. |
| 4 | **ISTAT** (commuting matrices, census sections, *basi territoriali*) | Demand for traffic modelling; population by area | Mostly **CC BY 4.0** | "Fonte: ISTAT" | ✅ With credit | Not used yet |
| 5 | **Comune di Milano open data** (dati.comune.milano.it): NIL areas, Area C/B gate entries | Neighbourhoods; calibration counts | Mostly **CC BY 4.0** (check each dataset page) | "Fonte: Comune di Milano" | ✅ With credit | Not used yet |
| 5a | **Comune di Milano – `ingressi_areac_varchi`** (CSV / GeoJSON / SHP, WGS84, downloaded Oct 2026) | Locations of the 42 Area C camera gates (`id_amat`, `label`). **No traffic numbers:** counts per gate must come from a separate dataset joined on `id_amat`. | Check the dataset page (Comune datasets are usually CC BY 4.0) | "Fonte: Comune di Milano / AMAT" | ✅ If CC BY | Positions only, not imported yet |
| 6a | **ANAS – Dati TGMA 2025** (PDF table, downloaded Oct 2026) | Average daily traffic (light + heavy vehicles) at ~700 counting stations on state roads, by road and **km marker** (no coordinates). 26 stations in Lombardy, only 1 in Milan province (SS341 Turbigo) plus SS36 Monza (≈99,600 veh/day). | Reuse terms not stated: ask ANAS before commercial use | "Fonte: ANAS S.p.A." | ❓ Ask | Extracted to a CSV (kept outside the repo). Stations need coordinates (km marker → map) before import. |
| 6b | **ANAS – Osservatorio del Traffico** (monthly PDF + *Sintesi*) | Only regional averages and month-on-month trends (e.g. Nord +3.8% Sep vs Aug 2026). No station data. | Marked **"Informazione ad uso interno"** (internal use) | "Fonte: ANAS S.p.A." | ⚠️ No: internal use | Background reading only. Don't import or redistribute. |
| 7 | Commercial traffic data (TomTom, HERE, OCTO, telcos…) | Trips / road volumes | Contract | As per contract | As per contract (often: no resale of raw data) | Not used yet |
| 8 | Demo traffic & demo billboards | Simulated by `server/src/seed.js` | Ours | Must be labelled as simulated | ✅ | ✅ Labelled in the app and the README |

## OpenStreetMap: what ODbL means for us

1. **Always credit.** Show "© OpenStreetMap contributors" with a link to https://www.openstreetmap.org/copyright wherever OSM data is visible: the map, exported PDFs and reports, screenshots in sales decks.
2. **Maps and reports (*Produced Works*) only need the credit.** That covers billboard maps, exposure reports and images.
3. **Databases (*Derivative Databases*) can trigger share-alike.** If we **publicly share or sell a database** built from OSM data (e.g. a dataset of OSM roads with our traffic volumes, or OSM billboards plus our edits), that database must also be offered under ODbL.
   - **Practical rule:** keep OSM-derived records identifiable (the `data_source` field) and separate from proprietary data such as client inventory, contracts and commercial traffic data.
   - Get advice before selling data exports that include OSM content.
4. Keep the original OSM IDs (`full_id`, `osm_id`, `@id`) in custom fields, so records can be traced and updated.

## How to add a new source

Copy this row into the register and fill it in **before** importing:

```
| n | Name (portal / provider) | What we use it for | Licence + link to terms | Exact credit text | Commercial use? | Status / action |
```

Also note:
- Download date and URL (or contract reference)
- Coordinate system of the original file
- Any restrictions (no resale, internal use only, expiry date)
