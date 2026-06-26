/* ============================================================
   iBreathe — Bucharest air quality
   Data: Open-Meteo (CAMS model, no key) + WAQI/ANPM stations.

   Architecture (top to bottom):
     1. Config        — token, endpoints, the area list, refresh rate
     2. AQI scales     — index→category→colour bands + a lookup helper
     3. Helpers        — DOM shorthand, colour math, distance, toast
     4. State          — one mutable object holding everything live
     5. Fetching       — talk to Open-Meteo & WAQI
     6. Map            — Leaflet setup + markers
     7. Rendering      — turn data into DOM (readout, tiles, forecast, station)
     8. Orchestration  — selectArea / refreshAll / geolocation / init

   The app is plain ES — no build step, no framework. It mutates the
   `state` object and re-renders by writing innerHTML / setting styles.
   ============================================================ */

/* ────────────────────────────────────────────────────────────
   WAQI API TOKEN  ──  paste your free token between the quotes.
   Get one in ~1 minute (email only):
     https://aqicn.org/data-platform/token
   Until you do, the app runs fully on Open-Meteo and the
   "nearest official station" panel stays empty.
   ──────────────────────────────────────────────────────────── */
const WAQI_TOKEN = "demo";

// True only when a *real* token has been pasted in. The literal "demo"
// (and an empty string) count as "no token", which disables the
// station panel and skips all WAQI requests.
const HAS_WAQI = WAQI_TOKEN && WAQI_TOKEN !== "demo";

/* ---------- endpoints ---------- */
const OM = "https://air-quality-api.open-meteo.com/v1/air-quality"; // Open-Meteo air-quality API (no key)
const WAQI_BOUNDS = "https://api.waqi.info/map/bounds/";            // list stations inside a lat/lng box
const WAQI_FEED = "https://api.waqi.info/feed/@";                   // full feed for one station, by uid (append uid)
const BUCHAREST_BBOX = "44.32,25.95,44.56,26.30"; // lat1,lng1,lat2,lng2 — the box queried for stations

// The "current" variables we ask Open-Meteo for, comma-joined into the query string.
// Includes both headline indices (european_aqi, us_aqi), raw pollutant concentrations,
// and the per-pollutant European sub-indices (used to colour each pollutant tile).
const CURRENT_VARS = [
  "european_aqi", "us_aqi",
  "pm2_5", "pm10", "nitrogen_dioxide", "ozone", "sulphur_dioxide", "carbon_monoxide",
  "european_aqi_pm2_5", "european_aqi_pm10", "european_aqi_nitrogen_dioxide",
  "european_aqi_ozone", "european_aqi_sulphur_dioxide"
].join(",");

// How often the whole dataset auto-refreshes (10 minutes).
const REFRESH_MS = 10 * 60 * 1000;

/* ---------- areas of Bucharest ---------- */
// The points shown across the app. Each drives a dropdown option, a map marker,
// an Open-Meteo lookup, and the nearest-station search.
//   id   — stable key used in state + DOM
//   name — human label (often "Sector N · Neighbourhood")
//   lat/lng — the coordinate sampled for that area
// To add an area, just append another object here; everything else is generated.
const AREAS = [
  { id:"centru",         name:"City Center · Universitate", lat:44.4355, lng:26.1025 },
  { id:"s1",             name:"Sector 1 · Aviației",        lat:44.4869, lng:26.0865 },
  { id:"baneasa",        name:"Băneasa",                    lat:44.5060, lng:26.0840 },
  { id:"pipera",         name:"Pipera",                     lat:44.4790, lng:26.1230 },
  { id:"s2",             name:"Sector 2 · Obor",            lat:44.4520, lng:26.1320 },
  { id:"colentina",      name:"Colentina",                  lat:44.4650, lng:26.1450 },
  { id:"s3",             name:"Sector 3 · Titan",           lat:44.4180, lng:26.1560 },
  { id:"vitan",          name:"Vitan",                      lat:44.4170, lng:26.1300 },
  { id:"s4",             name:"Sector 4 · Berceni",         lat:44.3870, lng:26.1180 },
  { id:"tineretului",    name:"Tineretului",                lat:44.4080, lng:26.1080 },
  { id:"s5",             name:"Sector 5 · Rahova",          lat:44.4080, lng:26.0700 },
  { id:"cotroceni",      name:"Cotroceni",                  lat:44.4320, lng:26.0620 },
  { id:"s6",             name:"Sector 6 · Militari",        lat:44.4280, lng:26.0250 },
  { id:"drumul-taberei", name:"Drumul Taberei",             lat:44.4220, lng:26.0380 },
  { id:"lacul-morii",    name:"Lacul Morii",                lat:44.4470, lng:26.0300 },
];

/* ---------- AQI scales ---------- */
// European AQI (CAMS / EEA) — index thresholds.
// Each band: `max` is the inclusive upper bound of the index for that category,
// `color` is its swatch (also drives the page haze), and `msg` is the health advice.
// The last band uses Infinity so any value falls into "Extremely poor".
const EU_BANDS = [
  { max:20,       name:"Good",            color:"#50f0e6", msg:"Air quality is good. Enjoy your usual time outdoors." },
  { max:40,       name:"Fair",            color:"#50ccaa", msg:"Air quality is fair. Unusually sensitive people may want to ease very long or intense outdoor exertion." },
  { max:60,       name:"Moderate",        color:"#f0e641", msg:"Air quality is moderate. Sensitive groups may feel minor effects; consider going easier on hard outdoor activity." },
  { max:80,       name:"Poor",            color:"#ff5050", msg:"Air quality is poor. Sensitive groups should cut back on outdoor exertion; everyone should take it gentler outside." },
  { max:100,      name:"Very poor",       color:"#960032", msg:"Air quality is very poor. Limit time outdoors, especially if you're in a sensitive group." },
  { max:Infinity, name:"Extremely poor",  color:"#7d2181", msg:"Air quality is extremely poor. Avoid outdoor exertion and keep windows closed where you can." },
];
// US EPA AQI — index thresholds (no health message; used for the second lens + station dots).
const US_BANDS = [
  { max:50,       name:"Good",                           color:"#00e400" },
  { max:100,      name:"Moderate",                       color:"#ffd400" },
  { max:150,      name:"Unhealthy for sensitive groups", color:"#ff7e00" },
  { max:200,      name:"Unhealthy",                      color:"#ff2d2d" },
  { max:300,      name:"Very unhealthy",                 color:"#8f3f97" },
  { max:Infinity, name:"Hazardous",                      color:"#7e0023" },
];

// Map a numeric index `v` to its band within `bands`.
// Missing/NaN values return a neutral "No data" band so callers never crash.
// Otherwise: the first band whose `max` the value does not exceed (bands are ascending).
const band = (bands, v) =>
  (v == null || isNaN(v)) ? { name:"No data", color:"#7f969b", msg:"No reading available for this area right now." }
                          : bands.find(b => v <= b.max);

/* ---------- pollutant config ---------- */
// Drives the pollutant tiles. For each pollutant:
//   key   — the Open-Meteo concentration field (µg/m³)
//   sub   — the matching European sub-index field, used to colour the tile (null = no colour)
//   label — display label; <sub> tags render the chemical subscripts
const POLLUTANTS = [
  { key:"pm2_5",            sub:"european_aqi_pm2_5",            label:"PM<sub>2.5</sub>" },
  { key:"pm10",             sub:"european_aqi_pm10",             label:"PM<sub>10</sub>" },
  { key:"nitrogen_dioxide", sub:"european_aqi_nitrogen_dioxide", label:"NO<sub>2</sub>" },
  { key:"ozone",            sub:"european_aqi_ozone",            label:"O<sub>3</sub>" },
  { key:"sulphur_dioxide",  sub:"european_aqi_sulphur_dioxide",  label:"SO<sub>2</sub>" },
  { key:"carbon_monoxide",  sub:null,                            label:"CO" }, // CO has no European sub-index here
];

/* ---------- small helpers ---------- */
// Shorthand for document.getElementById — used everywhere to grab elements by id.
const $ = (id) => document.getElementById(id);
// Whether the user prefers reduced motion; gates number-count and map-pan animations.
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- colour utilities (operate on "#rrggbb" strings) ---
// Parse a hex colour into {r,g,b} (0–255).
function hex2rgb(h){ const n=parseInt(h.slice(1),16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 }; }
// Relative luminance (WCAG formula) — used to decide readable text colour over a swatch.
function lum(h){ const {r,g,b}=hex2rgb(h); const a=[r,g,b].map(v=>{ v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); }); return .2126*a[0]+.7152*a[1]+.0722*a[2]; }
// Pick dark or light text for legibility on a given background colour.
function readable(h){ return lum(h) > 0.42 ? "#06141c" : "#ffffff"; }
// Linear blend between hex colours `a` and `b` by fraction `t` (0..1) → "rgb(...)" string.
function mix(a,b,t){ const A=hex2rgb(a),B=hex2rgb(b); const c=k=> Math.round(A[k]+(B[k]-A[k])*t); return `rgb(${c("r")},${c("g")},${c("b")})`; }

// Great-circle distance in km between two {lat,lng} points (Haversine formula).
// Used to find the area nearest the user, and the station nearest an area.
function haversine(a,b){
  const R=6371, d=x=>x*Math.PI/180;          // Earth radius (km); deg→rad helper
  const dLat=d(b.lat-a.lat), dLng=d(b.lng-a.lng);
  const s=Math.sin(dLat/2)**2 + Math.cos(d(a.lat))*Math.cos(d(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

// --- toast: a brief auto-dismissing status message at the bottom of the screen ---
let toastTimer;
function toast(msg){
  const t=$("toast"); t.textContent=msg; t.hidden=false;
  requestAnimationFrame(()=>t.classList.add("on"));   // next frame so the CSS transition runs
  clearTimeout(toastTimer);                            // reset any in-flight dismissal
  toastTimer=setTimeout(()=>{ t.classList.remove("on"); setTimeout(()=>t.hidden=true,250); }, 3600);
}

/* ---------- state ---------- */
// Single source of truth for live data + UI/map references. Mutated in place;
// render functions read from it.
const state = {
  current: AREAS[0].id, // id of the currently selected area
  air: {},            // areaId -> Open-Meteo current{}  (latest readings per area)
  stations: [],       // WAQI stations in bbox  (lightweight {uid,lat,lng,aqi,name})
  stationCache: {},   // uid -> WAQI feed data  (full feed, fetched on demand & cached)
  map: null,          // the Leaflet map instance
  areaMarkers: {},    // areaId -> Leaflet marker  (the labelled AQI pills)
  stationMarkers: [], // Leaflet markers for official stations (rebuilt on refresh)
};

/* ============================================================
   FETCHING
   ============================================================ */
// Load current conditions for every area. Tries one batched request first
// (Open-Meteo accepts comma-joined lat/lng lists), then falls back to one
// request per area if the batch fails. Results land in state.air keyed by area id.
async function fetchAir(){
  const lats = AREAS.map(a=>a.lat).join(",");
  const lons = AREAS.map(a=>a.lng).join(",");
  const url = `${OM}?latitude=${lats}&longitude=${lons}&current=${CURRENT_VARS}&timezone=auto`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error("multi "+res.status);
    let data = await res.json();
    if(!Array.isArray(data)) data = [data];          // single-area safety: API returns an object, not an array, for one point
    if(!data[0] || !data[0].current) throw new Error("no current field");
    // The response array is in the same order as the lat/lng lists we sent.
    AREAS.forEach((a,i)=>{ state.air[a.id] = data[i] && data[i].current; });
  }catch(err){
    // Fallback: fetch each area independently so one bad point doesn't sink the rest.
    console.warn("multi-fetch fell back to per-area:", err.message);
    const results = await Promise.allSettled(AREAS.map(a=>
      fetch(`${OM}?latitude=${a.lat}&longitude=${a.lng}&current=${CURRENT_VARS}&timezone=auto`).then(r=>r.json())
    ));
    results.forEach((r,i)=>{ state.air[AREAS[i].id] = (r.status==="fulfilled" && r.value && r.value.current) || null; });
    // If literally everything failed, surface it so refreshAll() can show an error.
    if(results.every(r=> r.status!=="fulfilled" || !r.value || !r.value.current)) throw new Error("all air fetches failed");
  }
}

// Fetch the 5-day European AQI forecast for one area and reduce the hourly
// series to a single peak (max) value per day → [{day, val}, ...] (≤5 entries).
async function fetchForecast(area){
  const url = `${OM}?latitude=${area.lat}&longitude=${area.lng}&hourly=european_aqi&forecast_days=5&timezone=auto`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("forecast "+res.status);
  const { hourly } = await res.json();
  const byDay = {};
  hourly.time.forEach((t,i)=>{
    const day = t.slice(0,10);                 // ISO timestamp → "YYYY-MM-DD"
    const v = hourly.european_aqi[i];
    if(v==null) return;                        // skip gaps in the series
    byDay[day] = Math.max(byDay[day] ?? -Infinity, v); // keep the worst hour of each day
  });
  return Object.entries(byDay).slice(0,5).map(([day,val])=>({ day, val }));
}

// Load the list of official stations within the Bucharest bounding box (WAQI).
// No-ops to an empty list when there's no token. Stores a trimmed shape in state.stations.
async function fetchStations(){
  if(!HAS_WAQI){ state.stations=[]; return; }
  try{
    const res = await fetch(`${WAQI_BOUNDS}?latlng=${BUCHAREST_BBOX}&token=${WAQI_TOKEN}`);
    const json = await res.json();
    if(json.status!=="ok" || !Array.isArray(json.data)) throw new Error(json.data || "WAQI error");
    state.stations = json.data
      .filter(s => s.aqi!=null && s.aqi!=="-" && !isNaN(+s.aqi)) // drop stations without a usable numeric AQI
      .map(s => ({ uid:s.uid, lat:+s.lat, lng:+s.lon, aqi:+s.aqi, name:(s.station&&s.station.name)||"Station" }));
  }catch(err){
    state.stations=[];                          // fail soft: no stations rather than a broken UI
    console.warn("WAQI bounds failed:", err.message);
  }
}

// Fetch the full feed for a single station by uid, caching by uid so repeated
// selections of the same nearest station don't refetch.
async function fetchStationFeed(uid){
  if(state.stationCache[uid]) return state.stationCache[uid];
  const res = await fetch(`${WAQI_FEED}${uid}/?token=${WAQI_TOKEN}`);
  const json = await res.json();
  if(json.status!=="ok") throw new Error("feed error");
  state.stationCache[uid] = json.data;
  return json.data;
}

/* ============================================================
   MAP
   ============================================================ */
// Build the Leaflet div-icon for an area marker: a coloured pill showing the
// rounded AQI (or "·" when unknown), highlighted when it's the selected area.
function areaIcon(area, aqi, selected){
  const b = band(EU_BANDS, aqi);
  const txt = (aqi==null||isNaN(aqi)) ? "·" : Math.round(aqi);
  return L.divIcon({
    className:"", // empty so Leaflet doesn't add its default icon styles
    // CSS custom props: --c is the band colour, --mkfg is a legible text colour over it.
    html:`<span class="mk ${selected?"mk--sel":""}" style="--c:${b.color};--mkfg:${readable(b.color)}">${txt}</span>`,
    iconSize:[40,23], iconAnchor:[20,11], // size + centre anchor so the pill sits on the point
  });
}
// Small coloured dot icon for an official station (coloured by the US AQI band).
function stationIcon(aqi){
  const b = band(US_BANDS, aqi);
  return L.divIcon({
    className:"",
    html:`<span class="mk mk--station" style="--c:${b.color}"></span>`,
    iconSize:[15,15], iconAnchor:[7.5,7.5],
  });
}

// Create the map, add the OSM tile layer, and drop a marker for every area.
// Area markers start with no AQI (placeholder) and get coloured once data loads.
function buildMap(){
  state.map = L.map("map",{ zoomControl:true, attributionControl:true }).setView([44.4325,26.1039], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:18,
    attribution:'&copy; OpenStreetMap',
  }).addTo(state.map);

  AREAS.forEach(area=>{
    const m = L.marker([area.lat,area.lng],{ icon:areaIcon(area,null,area.id===state.current), keyboard:true, title:area.name });
    m.on("click",()=>selectArea(area.id,true)); // clicking a marker selects that area
    m.addTo(state.map);
    state.areaMarkers[area.id]=m;
  });
}

// Re-skin every area marker from the latest state.air values (colour + number),
// and re-apply the "selected" highlight to the current area.
function refreshAreaMarkers(){
  AREAS.forEach(area=>{
    const cur = state.air[area.id];
    const aqi = cur ? cur.european_aqi : null;
    const m = state.areaMarkers[area.id];
    if(m) m.setIcon(areaIcon(area, aqi, area.id===state.current));
  });
}

// Replace all station markers with a fresh set from state.stations.
// Each marker gets a popup with the station name, US AQI + category.
function refreshStationMarkers(){
  state.stationMarkers.forEach(m=>state.map.removeLayer(m)); // clear previous batch
  state.stationMarkers = [];
  state.stations.forEach(s=>{
    const b = band(US_BANDS, s.aqi);
    const m = L.marker([s.lat,s.lng],{ icon:stationIcon(s.aqi), title:s.name });
    m.bindPopup(`<div class="popup"><b>${s.name}</b><br>US AQI ${s.aqi} · ${b.name}<br><small>official station · WAQI/ANPM</small></div>`);
    m.addTo(state.map);
    state.stationMarkers.push(m);
  });
}

/* ============================================================
   RENDERING
   ============================================================ */
// Animate an element's text from 0 up to `to` over ~600ms (eased).
// Skips the animation (just sets the final value / "—") when reduced motion
// is preferred or the value is missing.
function animateNumber(el, to){
  if(REDUCED || to==null || isNaN(to)){ el.textContent = (to==null||isNaN(to)) ? "—" : Math.round(to); return; }
  const from=0, dur=600, t0=performance.now();
  (function step(now){
    const p=Math.min(1,(now-t0)/dur);           // progress 0..1
    el.textContent = Math.round(from+(to-from)*(1-Math.pow(1-p,3))); // ease-out cubic
    if(p<1) requestAnimationFrame(step);
  })(performance.now());
}

// Tint the page background ("haze") toward the given AQI colour by setting the
// three --haze-* custom properties. CSS transitions these for a smooth fade.
function setHaze(color){
  const root=document.documentElement.style;
  root.setProperty("--haze-1", mix(color, "#04101a", 0.87)); // base — mostly dark
  root.setProperty("--haze-2", mix(color, "#0a2a36", 0.60)); // top glow — most colour
  root.setProperty("--haze-3", mix(color, "#04161e", 0.74)); // bottom glow
}

// Render the hero readout for one area's current data: both AQI numbers,
// their category names + colours, the health message, and the page haze.
function renderReadout(cur, animate){
  const eu = cur ? cur.european_aqi : null;
  const us = cur ? cur.us_aqi : null;
  const euB = band(EU_BANDS, eu), usB = band(US_BANDS, us);

  // --c drives each lens's accent (glow + number colour) via CSS.
  $("lensEu").style.setProperty("--c", euB.color);
  $("lensUs").style.setProperty("--c", usB.color);
  $("euCat").textContent = euB.name;
  $("usCat").textContent = usB.name;
  if(animate){ animateNumber($("euNum"), eu); animateNumber($("usNum"), us); }
  else { $("euNum").textContent = eu==null?"—":Math.round(eu); $("usNum").textContent = us==null?"—":Math.round(us); }

  $("health").textContent = euB.msg;            // health advice follows the European band
  setHaze(euB.color);                            // and the whole page tints to match
}

// Render the pollutant tiles from one area's current data. Each tile shows the
// concentration (µg/m³) with a colour bar from that pollutant's European sub-index.
function renderTiles(cur){
  const host=$("tiles");
  if(!cur){ host.innerHTML = `<p class="placeholder">No pollutant readings available right now.</p>`; return; }
  host.innerHTML = POLLUTANTS.map(p=>{
    const v = cur[p.key];                                  // concentration
    const sub = p.sub ? cur[p.sub] : null;                 // its sub-index (may be absent, e.g. CO)
    const c = p.sub ? band(EU_BANDS, sub).color : "var(--faint)"; // bar colour from the sub-index
    const val = (v==null||isNaN(v)) ? "—" : Math.round(v);
    return `<div class="tile">
      <span class="tile__bar" style="background:${c}"></span>
      <div class="tile__name">${p.label}</div>
      <div class="tile__val">${val}<span class="tile__unit">µg/m³</span></div>
    </div>`;
  }).join("");
}

// Render the 5-day forecast as bars. Bar heights are scaled to the highest day
// (floored at 40 so a calm week doesn't look alarmingly tall), coloured by band.
function renderForecast(days){
  const host=$("forecast");
  if(!days || !days.length){ host.innerHTML=`<p class="placeholder">Forecast unavailable.</p>`; return; }
  const peak = Math.max(40, ...days.map(d=>d.val));        // scale reference (min 40)
  host.innerHTML = days.map(d=>{
    const b = band(EU_BANDS, d.val);
    const h = Math.max(6, Math.round((d.val/peak)*100));   // bar height % (min 6 so it's visible)
    const label = new Date(d.day+"T00:00").toLocaleDateString("en-GB",{ weekday:"short" }); // "Mon", "Tue"...
    return `<div class="fc">
      <div class="fc__val">${Math.round(d.val)}</div>
      <div class="fc__track"><div class="fc__bar" style="height:${h}%;background:${b.color}"></div></div>
      <div class="fc__day">${label}</div>
    </div>`;
  }).join("");
}

// Find the station closest to an area (by Haversine), returning a copy with the
// distance attached, or null when no stations are loaded.
function nearestStation(area){
  if(!state.stations.length) return null;
  let best=null, bestD=Infinity;
  for(const s of state.stations){
    const d=haversine(area,s);
    if(d<bestD){ bestD=d; best={ ...s, dist:d }; }
  }
  return best;
}

// Fill the station panel with its "empty" state. Two messages: a "no station
// responded" note when a token is set, or a how-to-add-a-token prompt otherwise.
function renderStationPlaceholder(){
  $("stationChip").hidden = true;
  $("station").innerHTML = HAS_WAQI
    ? `<p class="placeholder">No official station responded near this area right now.</p>`
    : `<p class="placeholder">Add a free WAQI token — one line in <code>app.js</code> — to light up the nearest official ANPM monitoring station, with its own live readings and forecast.</p>`;
}

// Render the nearest-station card for an area: shortcut chip in the hero, then the
// full card (headline AQI, dominant pollutant, a grid of pollutant/weather rows).
// The feed is fetched lazily (and cached); failures degrade to a friendly message.
async function renderStation(area){
  const near = nearestStation(area);
  if(!near){ renderStationPlaceholder(); return; }

  // Hero chip: quick label that pans the map to the station when clicked.
  const chip=$("stationChip");
  const b0=band(US_BANDS, near.aqi);
  chip.hidden=false;
  chip.style.setProperty("--c", b0.color);
  chip.innerHTML = `<span class="chip__dot"></span><span class="chip__txt">${near.name} · US AQI ${near.aqi}</span>`;
  chip.onclick = ()=> { if(state.map) state.map.setView([near.lat,near.lng], 13); };

  // Show a loading line while we fetch the full feed.
  $("station").innerHTML = `<p class="placeholder">Loading ${near.name}…</p>`;
  let feed;
  try{ feed = await fetchStationFeed(near.uid); }
  catch{ $("station").innerHTML = `<p class="placeholder">Couldn't load ${near.name} right now.</p>`; return; }

  const b = band(US_BANDS, feed.aqi);
  const iaqi = feed.iaqi || {};                 // individual air-quality readings keyed by pollutant
  // Pull a rounded value from the iaqi map, or "—" when absent.
  const get = k => (iaqi[k] && iaqi[k].v!=null) ? Math.round(iaqi[k].v) : "—";
  // Tidy the dominant-pollutant code for display (e.g. "pm25" → "PM2.5").
  const dom = (feed.dominentpol||"").toUpperCase().replace("PM25","PM2.5").replace("PM10","PM10");
  // Measurement time "YYYY-MM-DDTHH:MM:..." → "YYYY-MM-DD HH:MM".
  const when = feed.time && feed.time.s ? feed.time.s.replace("T"," ").slice(0,16) : "—";

  // The grid rows: six pollutants + temperature + humidity.
  const rows = [
    ["PM2.5", get("pm25")], ["PM10", get("pm10")], ["O₃", get("o3")],
    ["NO₂", get("no2")], ["SO₂", get("so2")], ["CO", get("co")],
    ["Temp °C", get("t")], ["Humid %", get("h")],
  ];

  $("station").innerHTML = `
    <div class="station__head">
      <span class="station__name">${feed.city ? feed.city.name : near.name}</span>
      <span class="station__dist">${near.dist.toFixed(1)} km away</span>
    </div>
    <div class="station__lead">
      <span class="station__aqi" style="--c:${b.color}">${feed.aqi ?? "—"}</span>
      <div class="station__meta">
        <span class="station__cat" style="--c:${b.color}">${b.name}</span>
        ${dom ? `<span class="station__dom">Dominant pollutant: ${dom}</span>` : ""}
      </div>
    </div>
    <div class="station__grid">
      ${rows.map(([k,v])=>`<div class="sr"><div class="sr__k">${k}</div><div class="sr__v">${v}</div></div>`).join("")}
    </div>
    <p class="station__note">Pollutant readings shown on the US AQI scale · via WAQI / ANPM · updated ${when}</p>`;
}

/* ============================================================
   SELECTION + ORCHESTRATION
   ============================================================ */
// Make `id` the active area: update the header, readout, tiles and map, then
// kick off the async station + forecast renders. `animate` controls number
// counting and map panning (off during background refreshes).
async function selectArea(id, animate=true){
  state.current = id;
  const area = AREAS.find(a=>a.id===id);
  const cur = state.air[id];

  // Header / hero text.
  $("areaName").textContent = area.name;
  $("coord").textContent = `${area.lat.toFixed(4)}, ${area.lng.toFixed(4)}`;
  $("areaSelect").value = id;                   // keep the dropdown in sync

  // Synchronous renders from already-loaded data.
  renderReadout(cur, animate);
  renderTiles(cur);
  refreshAreaMarkers();                          // re-highlight the selected marker

  // Pan/zoom the map to the area (no animation under reduced-motion).
  if(animate && state.map){
    state.map.setView([area.lat,area.lng], Math.max(state.map.getZoom(),12), { animate:!REDUCED });
  }

  // Asynchronous renders — fill in as their data arrives.
  renderStation(area);                                   // async, fills in
  $("forecast").innerHTML = `<p class="placeholder">Loading forecast…</p>`;
  try{ renderForecast(await fetchForecast(area)); }
  catch{ $("forecast").innerHTML = `<p class="placeholder">Forecast unavailable.</p>`; }
}

// Stamp the "Updated HH:MM" label in the top bar with the current local time.
function stampUpdated(){
  $("updated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB",{ hour:"2-digit", minute:"2-digit" });
}

// Top-level refresh: pull air + stations in parallel, repaint markers, re-render
// the current area, and stamp the time. `initial` tweaks the error message shown
// on the very first load (when nothing is on screen yet).
async function refreshAll(initial){
  const spin=$("refreshSpin"); spin.classList.add("on"); // show the refresh spinner
  try{
    await Promise.allSettled([ fetchAir(), fetchStations() ]); // both, regardless of either failing
    if(state.map){ refreshAreaMarkers(); refreshStationMarkers(); }
    await selectArea(state.current, false);     // re-render current area without animations
    stampUpdated();
  }catch(err){
    console.error(err);
    if(initial) $("health").textContent = "Couldn't reach the air-quality service. If you're viewing this in a preview pane, download the files and open index.html in your browser (or host the folder).";
    toast("Couldn't refresh data");
  }finally{
    spin.classList.remove("on");                // always stop the spinner
  }
}

/* ---------- legend + dropdown ---------- */
// Build the map legend from the European bands, plus an entry for official stations.
function buildLegend(){
  $("legend").innerHTML = EU_BANDS.map(b=>
    `<span class="legend__item"><span class="legend__sw" style="background:${b.color}"></span>${b.name}</span>`
  ).join("") + `<span class="legend__item"><span class="legend__sw" style="background:#fff;border-radius:50%"></span>Official station</span>`;
}
// Populate the area dropdown and wire it to selectArea on change.
function buildDropdown(){
  $("areaSelect").innerHTML = AREAS.map(a=>`<option value="${a.id}">${a.name}</option>`).join("");
  $("areaSelect").value = state.current;
  $("areaSelect").addEventListener("change", e=>selectArea(e.target.value));
}

/* ---------- geolocation ---------- */
// "Use my location": ask the browser for GPS, then select the Bucharest area
// nearest to that position. Toasts cover the unsupported/denied/timeout cases.
function locate(){
  if(!navigator.geolocation){ toast("Location isn't available in this browser"); return; }
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const me={ lat:pos.coords.latitude, lng:pos.coords.longitude };
      let best=AREAS[0], bestD=Infinity;
      for(const a of AREAS){ const d=haversine(me,a); if(d<bestD){ bestD=d; best=a; } } // nearest area
      selectArea(best.id);
      toast(`Nearest area: ${best.name}`);
    },
    ()=>toast("Couldn't get your location"),   // error/permission-denied callback
    { timeout:8000 }
  );
}

/* ============================================================
   INIT
   ============================================================ */
// Wire up the static UI, attempt to build the map, bind the buttons, then do the
// first data load and start the auto-refresh interval.
function init(){
  buildDropdown();
  buildLegend();
  // The map is non-essential: if Leaflet/tiles fail (e.g. offline), keep the app usable.
  try{ buildMap(); }
  catch(err){ console.warn("Map unavailable:", err); $("map").innerHTML = `<p class="placeholder" style="padding:18px">Map couldn't load (offline?). The rest of the app still works.</p>`; }

  $("refreshBtn").addEventListener("click", ()=>refreshAll(false));
  $("locateBtn").addEventListener("click", locate);
  if(!HAS_WAQI) renderStationPlaceholder();     // show the "add a token" hint up front

  refreshAll(true);                              // initial load
  setInterval(()=>refreshAll(false), REFRESH_MS); // and every 10 minutes thereafter
}

// Run init() once the DOM is ready (whether the script ran before or after parsing).
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
else init();
