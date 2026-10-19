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
| 6 | **ANAS** (Osservatorio del Traffico) | Traffic counts (TGM) on state roads | Not stated as open data: check reuse terms / ask ANAS | "Fonte: ANAS S.p.A." | ❓ Unknown | Not used yet |
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
