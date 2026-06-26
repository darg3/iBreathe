# iBreathe — Bucharest Air Quality

A single-page web app that shows **live air quality across Bucharest, area by area**. It
combines modelled readings (Open-Meteo / CAMS) with the nearest official monitoring
station (WAQI / ANPM), and renders everything on an interactive map with a 5-day outlook.

The whole page behaves like an **atmospheric instrument**: the background itself shifts
colour to match the air quality of the area you're looking at.

> ⚠️ Values are indicative and unvalidated — **not for regulatory or health-critical
> decisions**.

---

## Features

- **Per-area readings** for 15 areas/sectors of Bucharest (City Center, Pipera, Băneasa,
  Drumul Taberei, …).
- **Dual AQI scales** shown side by side — the **European AQI** (CAMS / EEA) and the
  **US EPA AQI** — each with its own colour band and plain-language health advice.
- **Pollutant breakdown**: PM2.5, PM10, NO₂, O₃, SO₂ and CO in µg/m³, colour-coded by
  their individual European sub-index.
- **Nearest official station** (optional): live readings, dominant pollutant, distance,
  and last-updated time, pulled from the WAQI feed (ANPM stations).
- **5-day European AQI outlook** — the daily peak AQI as a small bar chart.
- **Interactive Leaflet map** — every area is a labelled marker coloured by its AQI;
  official stations show as small dots you can click for a popup.
- **"Use my location"** — finds the nearest Bucharest area to your GPS position.
- **Auto-refresh** every 10 minutes, plus a manual refresh button.
- **Atmospheric UI** — the page background ("haze") animates between AQI colours, with a
  vignette and a faint particulate grain. Honours `prefers-reduced-motion`.
- **Resilient & accessible** — graceful fallbacks if the map, network, or stations are
  unavailable; ARIA labels, keyboard focus styles, and a polite status toast.

---

## Quick start

This is a **plain static site** — no build step, no dependencies to install, no server
code. You just need to serve the three files.

### Option A — open the file directly

Double-click `index.html`, or open it in your browser. This works for most of the app,
but some browsers restrict `fetch`/geolocation on the `file://` protocol, so serving the
folder (Option B) is recommended.

### Option B — serve the folder locally (recommended)

Run any static file server from the project directory, then open the printed URL:

```bash
# Python 3
python -m http.server 8000

# or Node (no install: npx)
npx serve .
```

Then visit <http://localhost:8000>.

> If you open the app inside an editor's "preview pane" and the data won't load, download
> the files and open `index.html` in a real browser (or host the folder) — the app says
> the same thing in its error message.

---

## Optional: enable the official-station panel (WAQI token)

Out of the box the app runs **entirely on Open-Meteo** and the *"Nearest official
station"* panel stays empty. To light it up with live ANPM station data:

1. Get a **free** WAQI token (takes ~1 minute, email only):
   <https://aqicn.org/data-platform/token>
2. Open `app.js` and paste it into the token constant near the top:

   ```js
   const WAQI_TOKEN = "demo";   // ← replace "demo" with your token
   ```

That's the only change required. The app detects a real token (anything other than
`"demo"`) and starts fetching nearby stations automatically.

---

## How it works

```
┌─────────────┐      area lat/lng        ┌──────────────────────────┐
│  index.html │ ───────────────────────► │ Open-Meteo Air Quality   │
│  (markup)   │      AQI + pollutants     │ (CAMS model, no API key) │
└─────┬───────┘ ◄─────────────────────── └──────────────────────────┘
      │
      │ drives                            ┌──────────────────────────┐
      ▼                  station feeds    │ WAQI / aqicn.org         │
┌─────────────┐ ───────────────────────► │ (official ANPM stations, │
│   app.js    │      AQI + iaqi           │  optional token)         │
│  (logic)    │ ◄─────────────────────── └──────────────────────────┘
└─────┬───────┘
      │ renders into
      ▼
┌─────────────┐
│  styles.css │  haze background, glass panels, map markers, charts
└─────────────┘
```

### Data sources

| Source        | Used for                                              | Key needed |
| ------------- | ----------------------------------------------------- | ---------- |
| **Open-Meteo** (`air-quality-api.open-meteo.com`) | Per-area European & US AQI, pollutant concentrations, 5-day forecast | No |
| **WAQI** (`api.waqi.info`)                        | Nearest official monitoring station's live readings  | Yes (free) |
| **Leaflet** + **OpenStreetMap** tiles             | The interactive map                                   | No |

### Request flow

1. **`fetchAir()`** asks Open-Meteo for the *current* conditions of **all areas in one
   request** (comma-joined lat/lng). If that fails, it falls back to one request per area.
2. **`fetchStations()`** (only when a real WAQI token is set) lists stations inside the
   Bucharest bounding box.
3. Selecting an area renders the readout, pollutant tiles and map, then **lazily** fetches
   that area's **5-day forecast** (`fetchForecast`) and its **nearest station's feed**
   (`fetchStationFeed`, with per-station caching).
4. Everything re-runs every `REFRESH_MS` (10 min) and on the manual **Refresh** button.

### AQI colour bands

The app maps a numeric index to a named category + colour via `EU_BANDS` / `US_BANDS`
and the `band()` helper. The European band's colour also drives the animated page
background (`setHaze`) and the European band's message is the health advice shown under
the readout.

---

## Project structure

```
.
├── index.html   # Markup & layout: header, hero readout, map, pollutant/station/forecast panels
├── app.js       # All logic: config, data fetching, map, rendering, selection, init
└── styles.css   # All styling: the "atmospheric" haze theme, glass panels, map markers, charts
```

### `app.js` at a glance

| Section          | What it does                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| **Config**       | WAQI token, API endpoints, the `AREAS` list, refresh interval          |
| **AQI scales**   | `EU_BANDS` / `US_BANDS` thresholds + colours, `band()` lookup          |
| **Helpers**      | `$` (getElementById), colour math, `haversine` distance, `toast`       |
| **State**        | A single `state` object (current area, cached air/stations, map refs)  |
| **Fetching**     | `fetchAir`, `fetchForecast`, `fetchStations`, `fetchStationFeed`       |
| **Map**          | Leaflet setup + area/station markers and their refresh                 |
| **Rendering**    | Readout, pollutant tiles, forecast bars, station card, animated number |
| **Orchestration**| `selectArea`, `refreshAll`, geolocation, `init`                       |

---

## Configuration reference (`app.js`)

| Constant         | Default                         | Meaning                                              |
| ---------------- | ------------------------------- | --------------------------------------------------- |
| `WAQI_TOKEN`     | `"demo"`                        | Your WAQI token; `"demo"` disables the station panel |
| `REFRESH_MS`     | `10 * 60 * 1000`                | Auto-refresh interval (10 minutes)                  |
| `BUCHAREST_BBOX` | `44.32,25.95,44.56,26.30`       | Bounding box used to list WAQI stations             |
| `AREAS`          | 15 entries                      | The areas shown; each `{ id, name, lat, lng }`      |

**Adding an area:** append an `{ id, name, lat, lng }` object to `AREAS`. Everything else
(dropdown, map marker, forecast, nearest-station) is generated from that list.

---

## Browser support & notes

- Uses modern web features: `fetch`, CSS `@property` (for the animated haze),
  `color-mix()`, `backdrop-filter`, and the Geolocation API. Works in current
  Chrome/Edge/Firefox/Safari. Older browsers degrade gracefully (e.g. the haze simply
  won't animate without `@property`).
- No analytics, cookies, or tracking. The only outbound calls are to the data/map
  providers listed above.
- Geolocation only runs when you click **"Use my location"** and requires HTTPS (or
  `localhost`) plus your permission.

---

## Credits

- Air-quality model: **[Open-Meteo](https://open-meteo.com/)** (CAMS)
- Official stations: **[WAQI](https://aqicn.org/)** / **[ANPM](https://www.calitateaer.ro/)**
- Map: **[Leaflet](https://leafletjs.com/)** + **[OpenStreetMap](https://www.openstreetmap.org/)**
- Fonts: **Space Grotesk** & **Inter** (Google Fonts)
