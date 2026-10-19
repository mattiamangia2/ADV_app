# ADV·Flow — out-of-home advertising × mobility

Map how vehicles actually move through a city, cross those routes with billboard inventory, and measure which sites sit on the real traffic flows.

- **Mobility map** (Kepler.gl / CARTO-style, built on deck.gl — the engine Kepler uses): traffic heatmap, 3D hexagons, animated trips on a 24 h clock, origin→destination flow arcs.
- **Billboards on top**, coloured by how well each site fits the traffic flows (main flow / secondary / marginal / off-route), sized by impressions. Click one to see its readable cone, the trips that pass it, an hourly audience chart, the running campaign and pricing.
- **Company inventory portal**: each media owner enters and maintains its own sites (form, CSV import/export, custom fields).
- **Analytics**: reach, frequency, impressions, CPM, occupancy, weakest sites, best-value sites, *opportunity spots* (busy places with no billboard nearby), campaigns ending soon, permits expiring.

The app starts with **demo data for Milan**. On first start it downloads Milan's **real road network from OpenStreetMap** (≈10 MB, once, cached in `server/data/`) and simulates a week of car trips along those streets, plus 120 billboards for three fictional companies placed on real roads. The traffic and the billboards are simulated, not real counts or real inventory. Without internet it falls back to a schematic ring-and-radial network.

Map controls: drag to move, mouse wheel to zoom, **wheel-click drag (or right-drag) to tilt and rotate**. Base maps: dark, streets, light (OpenStreetMap via CARTO) and satellite (Esri).

## Quick start

Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite`, so there are no native dependencies).

```bash
npm install
npm run dev        # API on :4000, web app on http://localhost:5173
```

Production-style:

```bash
npm run build      # builds the client into client/dist
npm start          # serves API + built client on http://localhost:4000
```

Other scripts: `npm test` (server tests), `npm run seed` (wipe and regenerate demo data; add `-- --refresh-osm` to re-download roads or `-- --synthetic` for the offline network).
Env vars: `PORT`, `ADV_DB_PATH` (SQLite file, default `server/data/adv.db`), `ADV_TZ` (default `Europe/Rome`), `ADV_SEED=0` (start with an empty DB).

## Secrets & data safety

- Put configuration in a local `.env` (copy `.env.example`). `.env`, keys, credential files, `.npmrc`, local databases and real data exports are all in `.gitignore`.
- `npm install` turns on a **pre-commit hook** (`.githooks/pre-commit`) that blocks commits containing API keys, tokens, private keys, passwords in URLs or sensitive file types. Run it on the whole repo with `npm run check-secrets`.
- A GitHub Action (`.github/workflows/secret-scan.yml`) runs gitleaks over the full history on every push and pull request.
- Only synthetic data belongs in `samples/`. Never commit real mobility traces or customer inventory.

## How exposure is computed

For every trip and every billboard (`server/src/analytics.js`):

1. A trip **passes** a billboard if a segment of its path comes within the billboard's *readable distance* (`visibility_m`) **and** the vehicle drives towards the face — its heading is within `viewing_angle_deg` of the direction opposite to `facing_azimuth`. Sites with no azimuth (e.g. bus shelters) count every direction.
2. Each trip counts once per billboard, multiplied by its **panel weight** (how many real vehicles the sample trip stands for) and **occupancy** (people per vehicle, default 1.3), then averaged per day.
3. **Impressions** = people passing × a **visibility index** (0.15–0.9, from size, lighting, digital, time in view) × **share of voice** for digital screens (spot length / loop length).
4. **CPM** = monthly price / monthly impressions × 1000.
5. **Route fit** = the site's percentile among all billboards in the market by people passing per day.

The visibility index is a transparent heuristic. Replace it with audited figures (e.g. from your national OOH audience body) when you have them.

## Billboard data model

| Group | Fields |
|---|---|
| Identity | name, internal code, format (10 presets: 6×3, 4×3, street poster, backlit, trivision, building wrap, motorway, digital billboard, digital totem, bus shelter), media type, status |
| Location & visibility | lat/lon, address, city, road, road type, speed limit, **facing direction**, viewing half-angle, readable distance, height above ground |
| Physical | width, height, surface m², faces, illuminated, material |
| Digital | resolution, spot length, loop length, operating hours |
| Pricing | currency, price per week / month / year, production cost, minimum booking |
| Admin | installation date, permit number and expiry, photo, notes |
| Campaigns | advertiser, brand, category, title, creative, start/end → **elapsed / remaining days and progress**, price paid; full history |
| Custom fields | any extra key/value (landlord, energy use, …). Unknown CSV columns land here automatically |

## Mobility data input

Two kinds of traffic data drive the analytics (switch on the *Mobility data* tab; *Auto* uses road volumes when any are loaded):

**Road traffic volumes**: vehicles per day on each road segment, as GeoJSON lines from QGIS (e.g. an AequilibraE traffic assignment), TomTom/HERE, ANAS or municipal counts. One total column (split by the `oneway` attribute) or two per-direction columns (`…_ab` / `…_ba`), per day, per peak hour or per year. A billboard counts the traffic driving towards its face within its readable distance. Several pieces of the same road aren't double-counted. Reach and frequency need GPS trips, so they show "n/a" in this mode.

**GPS trips**: upload on the same tab or `POST /api/trips/import`:

- **CSV of GPS pings**: `trip_id,lat,lon,timestamp[,weight,vehicle_type]`
- **GeoJSON** FeatureCollection of LineStrings with per-vertex times in `properties.timestamps` or as the 3rd coordinate.

Examples are in [`samples/`](samples). Use anonymised data you have a legal basis to process (GDPR).

### Where to get real traffic data (Milan / Italy)

| Source | What you get | Access |
|---|---|---|
| **Audioutdoor** (Italian OOH audience JIC) | Official audience per billboard, by hour/day, reach & frequency | Members (media owners, UPA advertisers, UNA agencies) |
| **OCTO Telematics** (insurance black boxes) | Anonymised GPS trips, origin/destination matrices, flows by hour | Commercial |
| **TomTom MOVE** (O/D Analysis, Route Monitoring, Traffic Stats) / **HERE**, **INRIX** | Trips, speeds and volumes per road segment | Commercial, free trials |
| Telco data: **TIM**, **Vodafone Business Analytics**, **Teralytics** | People flows and O/D between zones | Commercial |
| Location panels: **Huq**, **Quadrant**, **Mapbox Movement** | Device trajectories / activity density | Commercial |
| **Comune di Milano open data** (dati.comune.milano.it), **dati.lombardia.it**, **ISTAT** commuting matrices, **ANAS** traffic counts | Area C/B gate entries, regional O/D matrices, commuting between municipalities, counts on state roads | Free |
| **Telecom Italia Big Data Challenge** (Milan, 2013, Harvard Dataverse) | Mobile activity on a 235 m grid every 10 min | Free, good for heatmap tests |
| Your own **GPS loggers / fleet** (taxis, delivery vans, OBD dongles) | Exact traces | Own data |

Trip-level GPS data and road-segment volumes plug straight into the *Mobility data* tab. **Step-by-step QGIS instructions** (OpenStreetMap billboards and bus shelters, counts → road volumes, AequilibraE traffic assignment, neighbourhoods): [docs/QGIS_GUIDE.md](docs/QGIS_GUIDE.md).

Billboards can also be imported from **GeoJSON** (e.g. QuickOSM `advertising=*` exports; OSM tags are mapped to formats, lighting and facing) or from QGIS CSV exports with `X`/`Y` columns.

## API

| Method | Path | |
|---|---|---|
| GET/POST | `/api/companies` | list / create companies |
| GET | `/api/billboards?companyId=` | inventory with metrics and campaigns |
| POST/PUT/DELETE | `/api/billboards[/:id]?companyId=` | create / update / delete (company can only touch its own) |
| POST | `/api/billboards/import?companyId=` | bulk CSV, JSON array or GeoJSON points |
| POST/DELETE | `/api/billboards/:id/campaigns`, `/api/campaigns/:id` | campaigns |
| GET/POST/DELETE | `/api/trips`, `/api/trips/import` | GPS trips |
| GET/POST/DELETE | `/api/segments`, `/api/segments/stats`, `/api/segments/import` | road-segment volumes (`{ geojson, options }`) |
| PUT | `/api/settings/traffic-source` | `auto` \| `trips` \| `segments` |
| GET | `/api/analytics/billboards`, `/summary`, `/gaps`, `/flows` | analytics; `hourFrom`/`hourTo` filter by time of day |

## Project layout

```
server/   Express API, SQLite (node:sqlite), exposure engine, demo-data simulator, tests
client/   React + Vite + deck.gl + MapLibre (CARTO / Esri base maps)
samples/  example upload files (trips, billboards CSV/GeoJSON, road volumes)
docs/     QGIS guide
```

## Roadmap — suggested next steps

1. **Map matching & areas**: snap uploaded GPS pings to the OpenStreetMap roads (OSRM / Valhalla), import zones (NIL, census sections) with population for audience profiles, import O/D matrices directly, and auto-fill road name, type and speed limit for each billboard.
2. **Accounts & permissions**: logins, one workspace per company, roles (owner, sales, viewer); today the company selector is trust-based.
3. **Advertiser side**: plan a campaign by target area, hours and budget → the app proposes the set of billboards that maximises reach (greedy set cover over trips), with availability calendar and booking requests.
4. **Line-of-sight**: use building footprints / 3D city models to remove views blocked by buildings or trees.
5. **Audience profiles**: join trips with census zones at origin/destination for socio-demographics (income, age), plus pedestrians and public transport.
6. **Data at scale**: move to PostGIS (or DuckDB-spatial) and pre-aggregate trips into H3 cells when the data reaches millions of trips.
7. **Proof of posting**: photo uploads with timestamps/geotag per campaign; digital play logs.
8. **Reports**: export a campaign PDF (map + reach + CPM) for clients.

## Data credits & licences

Road network and imported OSM features © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). The credit is always visible on the map. Base maps © CARTO, © OpenStreetMap contributors; satellite imagery © Esri, Maxar, Earthstar Geographics.

⚠️ CARTO and Esri base maps need a commercial licence for a paid product. Every source, its licence and what to fix before going commercial is tracked in **[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)**.
