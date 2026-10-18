# ADV·Flow — out-of-home advertising × mobility

Map how vehicles actually move through a city, cross those routes with billboard inventory, and measure which sites sit on the real traffic flows.

- **Mobility map** (Kepler.gl / CARTO-style, built on deck.gl — the engine Kepler uses): traffic heatmap, 3D hexagons, animated trips on a 24 h clock, origin→destination flow arcs.
- **Billboards on top**, coloured by how well each site fits the traffic flows (main flow / secondary / marginal / off-route), sized by impressions. Click one to see its readable cone, the trips that pass it, an hourly audience chart, the running campaign and pricing.
- **Company inventory portal**: each media owner enters and maintains its own sites (form, CSV import/export, custom fields).
- **Analytics**: reach, frequency, impressions, CPM, occupancy, weakest sites, best-value sites, *opportunity spots* (busy places with no billboard nearby), campaigns ending soon, permits expiring.

The app starts with **synthetic demo data for Milan** (a week of simulated car trips + 90 billboards for three fictional companies). None of it is real traffic or real inventory.

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

Other scripts: `npm test` (server tests), `npm run seed` (wipe and regenerate demo data).
Env vars: `PORT`, `ADV_DB_PATH` (SQLite file, default `server/data/adv.db`), `ADV_TZ` (default `Europe/Rome`), `ADV_SEED=0` (start with an empty DB).

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

Upload on the *Mobility data* tab or `POST /api/trips/import`:

- **CSV of GPS pings**: `trip_id,lat,lon,timestamp[,weight,vehicle_type]`
- **GeoJSON** FeatureCollection of LineStrings with per-vertex times in `properties.timestamps` or as the 3rd coordinate.

Examples are in [`samples/`](samples). Real sources: connected-car / fleet telematics, navigation-app panels, mobile-location SDK data. Use anonymised data you have a legal basis to process (GDPR).

## API

| Method | Path | |
|---|---|---|
| GET/POST | `/api/companies` | list / create companies |
| GET | `/api/billboards?companyId=` | inventory with metrics and campaigns |
| POST/PUT/DELETE | `/api/billboards[/:id]?companyId=` | create / update / delete (company can only touch its own) |
| POST | `/api/billboards/import?companyId=` | bulk CSV or JSON |
| POST/DELETE | `/api/billboards/:id/campaigns`, `/api/campaigns/:id` | campaigns |
| GET/POST/DELETE | `/api/trips`, `/api/trips/import` | mobility data |
| GET | `/api/analytics/billboards`, `/summary`, `/gaps`, `/flows` | analytics; `hourFrom`/`hourTo` filter by time of day |

## Project layout

```
server/   Express API, SQLite (node:sqlite), exposure engine, demo-data simulator, tests
client/   React + Vite + deck.gl + MapLibre (CARTO dark basemap)
samples/  example upload files
```

## Roadmap — suggested next steps

1. **Real road network & map matching**: snap GPS pings to OpenStreetMap roads (OSRM / Valhalla map-matching) so counts are per road segment, and auto-fill road name, type and speed limit for each billboard.
2. **Accounts & permissions**: logins, one workspace per company, roles (owner, sales, viewer); today the company selector is trust-based.
3. **Advertiser side**: plan a campaign by target area, hours and budget → the app proposes the set of billboards that maximises reach (greedy set cover over trips), with availability calendar and booking requests.
4. **Line-of-sight**: use building footprints / 3D city models to remove views blocked by buildings or trees.
5. **Audience profiles**: join trips with census zones at origin/destination for socio-demographics (income, age), plus pedestrians and public transport.
6. **Data at scale**: move to PostGIS (or DuckDB-spatial) and pre-aggregate trips into H3 cells when the data reaches millions of trips.
7. **Proof of posting**: photo uploads with timestamps/geotag per campaign; digital play logs.
8. **Reports**: export a campaign PDF (map + reach + CPM) for clients.
