# QGIS → ADV·Flow: step-by-step guide

How to collect the real geography of Milan (billboards, bus shelters, roads, neighbourhoods) and traffic flows in QGIS, and bring them into the app.

| Recipe | What you get | Difficulty | Goes into the app at |
|---|---|---|---|
| 1. Real billboards from OpenStreetMap | Positions of billboards, screens, poster columns | Easy | Inventory → Import CSV / GeoJSON |
| 2. Bus shelters | Shelter positions (advertising panels) | Easy | Inventory → Import CSV / GeoJSON |
| 3. Traffic counts → road volumes | Vehicles/day on the roads where you have counts | Medium | Mobility data → Road traffic volumes |
| 4. Estimated traffic for every road (AequilibraE) | Vehicles per road segment for the whole city | Advanced | Mobility data → Road traffic volumes |
| 5. Neighbourhoods & population | NIL areas, census sections with residents | Easy | Keep in QGIS for now (area import is on the roadmap) |

> **The one rule:** always export for the app as **GeoJSON** with **CRS = EPSG:4326 (WGS 84)**.
> Italian data often comes in EPSG:32632 (UTM 32N), EPSG:6707 or EPSG:3003 (Monte Mario). Exported that way, it lands in the wrong place, so the app rejects it with an error that tells you what to fix.

---

## 0. One-time setup

1. **Install plugins.** Go to *Plugins ▸ Manage and Install Plugins…*, search for and install:
   - **QuickOSM**: downloads OpenStreetMap data.
   - **AequilibraE**: transport modelling (only needed for recipe 4).

   QGIS 4 is new, and some plugins are still being updated for it. If a plugin is missing or won't load:
   - Install **QGIS 3.40 LTR** alongside QGIS 4. Both can be on the same PC.
   - Or, for OpenStreetMap data, use the browser method in **1b** below, which needs no plugin.
2. **Project coordinate system for measuring in metres.** Click the CRS button in the bottom-right corner and pick **EPSG:32632 – WGS 84 / UTM zone 32N**. This only affects measuring in QGIS. Exports are still set to EPSG:4326.
3. **Background map (optional).** In the *Browser* panel, expand *XYZ Tiles*, then double-click **OpenStreetMap**.

---

## 1. Real billboards from OpenStreetMap

### 1a. With QuickOSM

1. Open *Vector ▸ QuickOSM ▸ QuickOSM* (or the QuickOSM toolbar button).
2. Fill in the query:
   - **Key:** `advertising`
   - **Value:** leave empty (all types: `billboard`, `board`, `column`, `poster_box`, `screen`, …)
   - **In:** `Milano`
3. Expand *Advanced* and tick **Node**, **Way** and **Relation**, and the **Points** output.
4. Click **Run query**. A layer of points appears.
5. Check it on the map, and delete obvious mistakes with the *Toggle editing* and *Delete selected* tools.
6. Right-click the layer and choose *Export ▸ Save Features As…*:
   - **Format:** GeoJSON
   - **File name:** `milano_billboards.geojson`
   - **CRS:** EPSG:4326 – WGS 84
   - **Layer options ▸ COORDINATE_PRECISION:** 6
7. In the app, pick your company (top right), then go to *Inventory ▸ Import CSV / GeoJSON* and choose the file.

What the app does with the OpenStreetMap columns:

| OSM tag | Becomes |
|---|---|
| `advertising=billboard` / `board` / `column` / `poster_box` / `screen` | format 6×3 / 4×3 / street poster / backlit / digital billboard |
| `lit=yes` | illuminated |
| `direction=270` | facing direction (if the mapper recorded it) |
| `operator` | internal code |
| everything else | kept under *Custom fields* |

Billboards with an unknown type get format 6×3, and the import message tells you how many. Open them in the Inventory and fix sizes, prices and facing direction. The facing direction matters most for the exposure numbers.

OpenStreetMap coverage of advertising in Milan is **partial**. Treat it as a starting point, not a full census.

### 1b. Without any plugin (overpass-turbo, in the browser)

1. Open **https://overpass-turbo.eu** and paste:
   ```
   [out:json][timeout:120];
   area["name"="Milano"]["admin_level"="8"]->.a;
   nwr["advertising"](area.a);
   out center;
   ```
2. Click **Run**, then *Export ▸ GeoJSON ▸ download*.
3. Import that file directly in the app, or open it in QGIS first to clean it up.

---

## 2. Bus shelters (where most street panels are)

Use QuickOSM like in recipe 1, with:
- **Key** `highway`, **Value** `bus_stop`, **In** `Milano`

Then remove the stops without a shelter:
1. Right-click the layer and choose *Filter…*.
2. Enter `"shelter" = 'yes'`.
3. Export as GeoJSON in EPSG:4326, as in recipe 1.

The app turns each shelter into a **Bus shelter panel** (visible from both directions).

In overpass-turbo the query is:
```
[out:json][timeout:120];
area["name"="Milano"]["admin_level"="8"]->.a;
node["highway"="bus_stop"]["shelter"="yes"](area.a);
out;
```

---

## 3. Traffic counts → road volumes

Use this when you have **traffic counts**: numbers of vehicles measured passing a specific point of a road.

### What a traffic count is

A count says: *"at this point of this road, X vehicles pass per day (or per hour), in this direction"*. It is measured by sensors under the asphalt (induction loops, *spire*), radar or cameras at the roadside, or a person counting.

What a useful count file contains:

| Column | Example | Needed? |
|---|---|---|
| Station / section ID | `MI-0123` | Useful |
| Location | lat/lon, or road + km (`SS36 km 12+300`) | **Yes** |
| Vehicles per day | `TGM = 54 300` | **Yes** (or per hour) |
| Direction | `Nord` / `Sud`, `carreggiata A/B` | Nice to have |
| Vehicle type | `leggeri` / `pesanti` | Nice to have |
| Period | `2024`, `marzo 2025`, `7:00–9:00` | **Yes**: know what the number means |

### Key words (Italian sources use these)

| Term | Meaning |
|---|---|
| **TGM** | *Traffico Giornaliero Medio*: average vehicles per day. This is the number you want. |
| **TGMA** / **TGMA feriale** | Average daily traffic over the year / on weekdays |
| **flussi veicolari**, **flussi di traffico** | Traffic flows |
| **conteggi di traffico**, **rilievi di traffico** | Traffic counts / surveys |
| **sezioni di conteggio**, **postazioni di rilevamento** | Counting stations |
| **spire induttive** | Induction-loop sensors (the most common source) |
| **ora di punta** | Peak hour (if a count is per peak hour, choose "peak hour ×10" when importing) |
| **veicoli equivalenti** | Weighted vehicles (a truck = 2–3 cars): fine to use as a volume |

### Where to look

| Source | What you'll find | Search for |
|---|---|---|
| **ANAS**, stradeanas.it | Monthly *Osservatorio del Traffico* bulletins (PDF) from 1,400+ counting sections on state roads (SS). Around Milan this covers the main state roads, not city streets. | "ANAS Osservatorio del Traffico", "ANAS TGM sezioni di conteggio". For station-level tables, contact ANAS. |
| **Comune di Milano**, dati.comune.milano.it | Area C gate entries (daily, and every 30 minutes for some months), Area B. These are entries into a zone, not counts per road, so use them to check totals. | On the portal: "Area C ingressi", "varchi", "traffico", "flussi", "spire" |
| **AMAT** (Milan mobility agency) | Traffic counts made for city plans (PUMS) | "AMAT Milano conteggi traffico", "PUMS Milano flussi di traffico". Often in plan PDFs, otherwise ask AMAT. |
| **Città metropolitana di Milano** | Counts and speed sensors on provincial roads (SP: Paullese, Rivoltana, Cassanese…) | "Città metropolitana Milano flussi traffico strade provinciali", "Progetto Sicurezza Milano Metropolitana". Usually by request to *Area Viabilità*. |
| **Milano Serravalle – Milano Tangenziali**, **Autostrade per l'Italia**, **AISCAT** | Traffic on the Tangenziali and motorways around Milan | "Milano Serravalle traffico tangenziali", "AISCAT traffico autostradale mensile" |
| **Regione Lombardia**, dati.lombardia.it | Regional mobility datasets and matrices | "traffico", "flussi", "matrice origine destinazione" |
| **Your own counts** | Exactly the roads in front of your billboards | Count vehicles in 15-minute slots by hand or from a video (AI counting apps exist), or put a **Telraam** sensor (about €150–250) in a window facing the road. It counts cars, bikes and pedestrians continuously. |
| **Providers** (TomTom, HERE, INRIX) | Volumes or speeds for every road segment, already as lines | Ask for "traffic volumes / AADT per segment, Milan, shapefile or GeoJSON". If you get lines, skip to step 5 below. |

Most public counts come as **PDF or Excel tables** with a road name and km, not coordinates. Turn them into points like this:
1. Put them in a spreadsheet with columns `name, tgm, lat, lon`.
2. Find each station on the map (right-click in Google Maps or QGIS to copy the coordinates).
3. Save the sheet as CSV and continue with step 1 below.

Note each source in `docs/DATA_SOURCES.md` before importing.

### Steps in QGIS

1. **Load the counts.**
   - If they are a CSV: *Layer ▸ Add Layer ▸ Add Delimited Text Layer…*, set X = longitude and Y = latitude, and choose the right CRS.
   - Make sure there is a column with **vehicles per day**, e.g. `tgm`.
2. **Load the roads.**
   - Use QuickOSM: Key `highway`, Value empty, In `Milano`, output **Lines**.
   - To keep it light, run the query once each for `motorway`, `trunk`, `primary`, `secondary` and `tertiary`, then use *Vector ▸ Data Management Tools ▸ Merge Vector Layers*.
3. **Copy each count onto the nearest road.**
   - Open *Processing ▸ Toolbox* and search for **Join attributes by nearest**.
   - Input layer: **roads**. Input layer 2: **counts**. Layer 2 fields to copy: `tgm`.
   - **Maximum nearest neighbors:** 1. **Maximum distance:** 30 metres. Run it.
4. **Keep only the roads that got a count.** On the output layer use *Filter…* with `"tgm" IS NOT NULL`.
5. **Export** as GeoJSON in EPSG:4326.
6. In the app, go to *Mobility data ▸ Road traffic volumes ▸ Choose GeoJSON…*:
   - Choose **One column with the total** and column **tgm**.
   - Set **The numbers are…** to **vehicles per day**, or **peak hour** if your counts are for the peak hour.
   - The `oneway` column from OpenStreetMap is used automatically: one-way roads get the full volume in their drawing direction.
7. Click **Import road volumes**.

Counts cover only a few roads, so billboards elsewhere will show as off-route. For full coverage you need recipe 4 or a provider such as TomTom or HERE (their road files go through the same steps 5–6).

---

## 4. Estimated traffic on every road (AequilibraE traffic assignment)

This is how transport planners estimate flows when they have no GPS data. You take who travels from where to where, find the routes they take on the road network, and get vehicles on each road.

You need three things:

| Input | Where from |
|---|---|
| Road network | AequilibraE builds it from OpenStreetMap |
| Zones (areas where trips start and end) | ISTAT census sections or municipalities (see recipe 5), or Milan NIL areas |
| Demand matrix (trips from zone to zone) | **ISTAT commuting matrix** ("matrice del pendolarismo"): people travelling between municipalities by mode and departure time. Use the car-driver trips. Inside the city you must share them out to smaller zones, e.g. by population. |

Steps (menu names can differ slightly between AequilibraE versions; see the docs at **aequilibrae.com** under *QGIS ▸ Tutorials*):

1. *AequilibraE ▸ Project ▸ Create project from OSM*, place name **Milano** (or a bounding box). This downloads and builds the network: links with capacity and speed, plus nodes.
2. **Zoning:** import your zones layer into the project (*Project ▸ Add zoning data* / *Import zones*), then **add centroids and connectors** so each zone is attached to the network.
3. **Matrix:** *Data ▸ Import matrices*, loading the zone-to-zone car trips for the **morning peak hour** (e.g. 7–9 departures ÷ 2).
4. *Paths and assignment ▸ Traffic assignment*:
   - Algorithm **bfw** (bi-conjugate Frank-Wolfe), volume–delay function **BPR**, capacity field `capacity`, free-flow time `free_flow_time`, relative gap **0.001**, max iterations **100**.
   - Run it. The result is a table of *link loads* with columns like `matrix_ab`, `matrix_ba`, `matrix_tot`. The prefix is the name of your matrix.
5. **Put the results on the links:** join the result table to the `links` layer on `link_id` (*Layer Properties ▸ Joins*), then export the links as **GeoJSON, EPSG:4326**.
6. In the app, go to *Mobility data ▸ Road traffic volumes*:
   - Choose **Two columns, one per direction** and pick `…_ab` and `…_ba`. The app suggests them automatically.
   - Set **The numbers are…** to **peak hour (×10 ≈ day)**.
   - Click **Import road volumes**.
7. **Calibrate:** compare the result with the real counts from recipe 3 on the same roads. If the model is consistently high or low, adjust the matrix, then re-run and re-import. Ticking *Replace roads already loaded* swaps the old version out.

This is a modelling project, not a one-click export. Even a rough first version gives you plausible flows on the main roads, which is what billboard exposure needs most.

---

## 5. Neighbourhoods & population (for audience profiles)

- **Milan NIL** (88 *Nuclei di Identità Locale*): from **dati.comune.milano.it**, search "NIL". Download the GeoJSON or Shapefile and drag it into QGIS.
- **Census sections with residents:** from ISTAT. Download the *Basi territoriali* (boundaries, Lombardia) and the census population table for sections. In QGIS, join the table to the boundaries on the section code (`SEZ21_ID` or similar).
- **Uses now:** colour the map by population density and see which billboards sit in dense residential areas. You can also use the population to share ISTAT commuting trips out to zones in recipe 4.
- The app can't import areas yet (it's on the roadmap). Keep these layers in QGIS for now.

---

## Export checklist

- [ ] Format **GeoJSON**
- [ ] CRS **EPSG:4326 – WGS 84**
- [ ] Coordinate precision **6**
- [ ] Only the columns you need: untick the rest in *Save Features As… ▸ Select fields to export*
- [ ] For a big road layer, first run *Processing ▸ Simplify* (tolerance 2 m, run in EPSG:32632) so the file stays well under 300 MB

## Troubleshooting

| Message in the app | Fix |
|---|---|
| "coordinates look projected …" / "the file is in coordinate system …" | Export again with CRS = EPSG:4326 |
| "could not find a traffic volume column" | Pick the column by hand in the upload form, or rename it to `vehicles_per_day` |
| Billboards land in the sea or in Africa | Latitude and longitude are swapped: X must be longitude (~9.2), Y latitude (~45.5) |
| Everything is "off-route" after importing road volumes | Only the roads in the file have traffic. Import more roads, or switch *Analytics use* back to *GPS trips* |
| Upload is slow or fails | Simplify geometries, drop unneeded columns, or split the city into parts |

## Data licences

Record every source in **[`DATA_SOURCES.md`](DATA_SOURCES.md)** (licence, credit text, commercial use) before importing it.

- OpenStreetMap: © OpenStreetMap contributors, **ODbL**. Credit it wherever you show it, and read the share-alike note in the register before selling any database that contains OSM data.
- ISTAT and Comune di Milano open data are mostly **CC BY 4.0**: credit the source.
- Commercial data (TomTom, HERE, OCTO, telcos) has its own licence. Check whether you may store it and show it to your clients.
