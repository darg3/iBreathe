/* ============================================================
   iBreathe — Bucharest air quality
   Data: Open-Meteo (CAMS model, no key) + WAQI/ANPM stations.
   ============================================================ */

/* ────────────────────────────────────────────────────────────
   WAQI API TOKEN  ──  paste your free token between the quotes.
   Get one in ~1 minute (email only):
     https://aqicn.org/data-platform/token
   Until you do, the app runs fully on Open-Meteo and the
   "nearest official station" panel stays empty.
   ──────────────────────────────────────────────────────────── */
const WAQI_TOKEN = "demo";

const HAS_WAQI = WAQI_TOKEN && WAQI_TOKEN !== "demo";

/* ---------- endpoints ---------- */
const OM = "https://air-quality-api.open-meteo.com/v1/air-quality";
const WAQI_BOUNDS = "https://api.waqi.info/map/bounds/";
const WAQI_FEED = "https://api.waqi.info/feed/@";
const BUCHAREST_BBOX = "44.32,25.95,44.56,26.30"; // lat1,lng1,lat2,lng2

const CURRENT_VARS = [
  "european_aqi", "us_aqi",
  "pm2_5", "pm10", "nitrogen_dioxide", "ozone", "sulphur_dioxide", "carbon_monoxide",
  "european_aqi_pm2_5", "european_aqi_pm10", "european_aqi_nitrogen_dioxide",
  "european_aqi_ozone", "european_aqi_sulphur_dioxide"
].join(",");

const REFRESH_MS = 10 * 60 * 1000;

/* ---------- areas of Bucharest ---------- */
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
const EU_BANDS = [
  { max:20,       name:"Good",            color:"#50f0e6", msg:"Air quality is good. Enjoy your usual time outdoors." },
  { max:40,       name:"Fair",            color:"#50ccaa", msg:"Air quality is fair. Unusually sensitive people may want to ease very long or intense outdoor exertion." },
  { max:60,       name:"Moderate",        color:"#f0e641", msg:"Air quality is moderate. Sensitive groups may feel minor effects; consider going easier on hard outdoor activity." },
  { max:80,       name:"Poor",            color:"#ff5050", msg:"Air quality is poor. Sensitive groups should cut back on outdoor exertion; everyone should take it gentler outside." },
  { max:100,      name:"Very poor",       color:"#960032", msg:"Air quality is very poor. Limit time outdoors, especially if you're in a sensitive group." },
  { max:Infinity, name:"Extremely poor",  color:"#7d2181", msg:"Air quality is extremely poor. Avoid outdoor exertion and keep windows closed where you can." },
];
// US EPA AQI — index thresholds.
const US_BANDS = [
  { max:50,       name:"Good",                           color:"#00e400" },
  { max:100,      name:"Moderate",                       color:"#ffd400" },
  { max:150,      name:"Unhealthy for sensitive groups", color:"#ff7e00" },
  { max:200,      name:"Unhealthy",                      color:"#ff2d2d" },
  { max:300,      name:"Very unhealthy",                 color:"#8f3f97" },
  { max:Infinity, name:"Hazardous",                      color:"#7e0023" },
];

const band = (bands, v) =>
  (v == null || isNaN(v)) ? { name:"No data", color:"#7f969b", msg:"No reading available for this area right now." }
                          : bands.find(b => v <= b.max);

/* ---------- pollutant config ---------- */
const POLLUTANTS = [
  { key:"pm2_5",            sub:"european_aqi_pm2_5",            label:"PM<sub>2.5</sub>" },
  { key:"pm10",             sub:"european_aqi_pm10",             label:"PM<sub>10</sub>" },
  { key:"nitrogen_dioxide", sub:"european_aqi_nitrogen_dioxide", label:"NO<sub>2</sub>" },
  { key:"ozone",            sub:"european_aqi_ozone",            label:"O<sub>3</sub>" },
  { key:"sulphur_dioxide",  sub:"european_aqi_sulphur_dioxide",  label:"SO<sub>2</sub>" },
  { key:"carbon_monoxide",  sub:null,                            label:"CO" },
];

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function hex2rgb(h){ const n=parseInt(h.slice(1),16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 }; }
function lum(h){ const {r,g,b}=hex2rgb(h); const a=[r,g,b].map(v=>{ v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); }); return .2126*a[0]+.7152*a[1]+.0722*a[2]; }
function readable(h){ return lum(h) > 0.42 ? "#06141c" : "#ffffff"; }
function mix(a,b,t){ const A=hex2rgb(a),B=hex2rgb(b); const c=k=> Math.round(A[k]+(B[k]-A[k])*t); return `rgb(${c("r")},${c("g")},${c("b")})`; }

function haversine(a,b){
  const R=6371, d=x=>x*Math.PI/180;
  const dLat=d(b.lat-a.lat), dLng=d(b.lng-a.lng);
  const s=Math.sin(dLat/2)**2 + Math.cos(d(a.lat))*Math.cos(d(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

let toastTimer;
function toast(msg){
  const t=$("toast"); t.textContent=msg; t.hidden=false;
  requestAnimationFrame(()=>t.classList.add("on"));
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ t.classList.remove("on"); setTimeout(()=>t.hidden=true,250); }, 3600);
}

/* ---------- state ---------- */
const state = {
  current: AREAS[0].id,
  air: {},            // areaId -> Open-Meteo current{}
  stations: [],       // WAQI stations in bbox
  stationCache: {},   // uid -> WAQI feed data
  map: null,
  areaMarkers: {},    // areaId -> Leaflet marker
  stationMarkers: [],
};

/* ============================================================
   FETCHING
   ============================================================ */
async function fetchAir(){
  const lats = AREAS.map(a=>a.lat).join(",");
  const lons = AREAS.map(a=>a.lng).join(",");
  const url = `${OM}?latitude=${lats}&longitude=${lons}&current=${CURRENT_VARS}&timezone=auto`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error("multi "+res.status);
    let data = await res.json();
    if(!Array.isArray(data)) data = [data];          // single-area safety
    if(!data[0] || !data[0].current) throw new Error("no current field");
    AREAS.forEach((a,i)=>{ state.air[a.id] = data[i] && data[i].current; });
  }catch(err){
    console.warn("multi-fetch fell back to per-area:", err.message);
    const results = await Promise.allSettled(AREAS.map(a=>
      fetch(`${OM}?latitude=${a.lat}&longitude=${a.lng}&current=${CURRENT_VARS}&timezone=auto`).then(r=>r.json())
    ));
    results.forEach((r,i)=>{ state.air[AREAS[i].id] = (r.status==="fulfilled" && r.value && r.value.current) || null; });
    if(results.every(r=> r.status!=="fulfilled" || !r.value || !r.value.current)) throw new Error("all air fetches failed");
  }
}

async function fetchForecast(area){
  const url = `${OM}?latitude=${area.lat}&longitude=${area.lng}&hourly=european_aqi&forecast_days=5&timezone=auto`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("forecast "+res.status);
  const { hourly } = await res.json();
  const byDay = {};
  hourly.time.forEach((t,i)=>{
    const day = t.slice(0,10);
    const v = hourly.european_aqi[i];
    if(v==null) return;
    byDay[day] = Math.max(byDay[day] ?? -Infinity, v);
  });
  return Object.entries(byDay).slice(0,5).map(([day,val])=>({ day, val }));
}

async function fetchStations(){
  if(!HAS_WAQI){ state.stations=[]; return; }
  try{
    const res = await fetch(`${WAQI_BOUNDS}?latlng=${BUCHAREST_BBOX}&token=${WAQI_TOKEN}`);
    const json = await res.json();
    if(json.status!=="ok" || !Array.isArray(json.data)) throw new Error(json.data || "WAQI error");
    state.stations = json.data
      .filter(s => s.aqi!=null && s.aqi!=="-" && !isNaN(+s.aqi))
      .map(s => ({ uid:s.uid, lat:+s.lat, lng:+s.lon, aqi:+s.aqi, name:(s.station&&s.station.name)||"Station" }));
  }catch(err){
    state.stations=[];
    console.warn("WAQI bounds failed:", err.message);
  }
}

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
function areaIcon(area, aqi, selected){
  const b = band(EU_BANDS, aqi);
  const txt = (aqi==null||isNaN(aqi)) ? "·" : Math.round(aqi);
  return L.divIcon({
    className:"",
    html:`<span class="mk ${selected?"mk--sel":""}" style="--c:${b.color};--mkfg:${readable(b.color)}">${txt}</span>`,
    iconSize:[40,23], iconAnchor:[20,11],
  });
}
function stationIcon(aqi){
  const b = band(US_BANDS, aqi);
  return L.divIcon({
    className:"",
    html:`<span class="mk mk--station" style="--c:${b.color}"></span>`,
    iconSize:[15,15], iconAnchor:[7.5,7.5],
  });
}

function buildMap(){
  state.map = L.map("map",{ zoomControl:true, attributionControl:true }).setView([44.4325,26.1039], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:18,
    attribution:'&copy; OpenStreetMap',
  }).addTo(state.map);

  AREAS.forEach(area=>{
    const m = L.marker([area.lat,area.lng],{ icon:areaIcon(area,null,area.id===state.current), keyboard:true, title:area.name });
    m.on("click",()=>selectArea(area.id,true));
    m.addTo(state.map);
    state.areaMarkers[area.id]=m;
  });
}

function refreshAreaMarkers(){
  AREAS.forEach(area=>{
    const cur = state.air[area.id];
    const aqi = cur ? cur.european_aqi : null;
    const m = state.areaMarkers[area.id];
    if(m) m.setIcon(areaIcon(area, aqi, area.id===state.current));
  });
}

function refreshStationMarkers(){
  state.stationMarkers.forEach(m=>state.map.removeLayer(m));
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
function animateNumber(el, to){
  if(REDUCED || to==null || isNaN(to)){ el.textContent = (to==null||isNaN(to)) ? "—" : Math.round(to); return; }
  const from=0, dur=600, t0=performance.now();
  (function step(now){
    const p=Math.min(1,(now-t0)/dur);
    el.textContent = Math.round(from+(to-from)*(1-Math.pow(1-p,3)));
    if(p<1) requestAnimationFrame(step);
  })(performance.now());
}

function setHaze(color){
  const root=document.documentElement.style;
  root.setProperty("--haze-1", mix(color, "#04101a", 0.87));
  root.setProperty("--haze-2", mix(color, "#0a2a36", 0.60));
  root.setProperty("--haze-3", mix(color, "#04161e", 0.74));
}

function renderReadout(cur, animate){
  const eu = cur ? cur.european_aqi : null;
  const us = cur ? cur.us_aqi : null;
  const euB = band(EU_BANDS, eu), usB = band(US_BANDS, us);

  $("lensEu").style.setProperty("--c", euB.color);
  $("lensUs").style.setProperty("--c", usB.color);
  $("euCat").textContent = euB.name;
  $("usCat").textContent = usB.name;
  if(animate){ animateNumber($("euNum"), eu); animateNumber($("usNum"), us); }
  else { $("euNum").textContent = eu==null?"—":Math.round(eu); $("usNum").textContent = us==null?"—":Math.round(us); }

  $("health").textContent = euB.msg;
  setHaze(euB.color);
}

function renderTiles(cur){
  const host=$("tiles");
  if(!cur){ host.innerHTML = `<p class="placeholder">No pollutant readings available right now.</p>`; return; }
  host.innerHTML = POLLUTANTS.map(p=>{
    const v = cur[p.key];
    const sub = p.sub ? cur[p.sub] : null;
    const c = p.sub ? band(EU_BANDS, sub).color : "var(--faint)";
    const val = (v==null||isNaN(v)) ? "—" : Math.round(v);
    return `<div class="tile">
      <span class="tile__bar" style="background:${c}"></span>
      <div class="tile__name">${p.label}</div>
      <div class="tile__val">${val}<span class="tile__unit">µg/m³</span></div>
    </div>`;
  }).join("");
}

function renderForecast(days){
  const host=$("forecast");
  if(!days || !days.length){ host.innerHTML=`<p class="placeholder">Forecast unavailable.</p>`; return; }
  const peak = Math.max(40, ...days.map(d=>d.val));
  host.innerHTML = days.map(d=>{
    const b = band(EU_BANDS, d.val);
    const h = Math.max(6, Math.round((d.val/peak)*100));
    const label = new Date(d.day+"T00:00").toLocaleDateString("en-GB",{ weekday:"short" });
    return `<div class="fc">
      <div class="fc__val">${Math.round(d.val)}</div>
      <div class="fc__track"><div class="fc__bar" style="height:${h}%;background:${b.color}"></div></div>
      <div class="fc__day">${label}</div>
    </div>`;
  }).join("");
}

function nearestStation(area){
  if(!state.stations.length) return null;
  let best=null, bestD=Infinity;
  for(const s of state.stations){
    const d=haversine(area,s);
    if(d<bestD){ bestD=d; best={ ...s, dist:d }; }
  }
  return best;
}

function renderStationPlaceholder(){
  $("stationChip").hidden = true;
  $("station").innerHTML = HAS_WAQI
    ? `<p class="placeholder">No official station responded near this area right now.</p>`
    : `<p class="placeholder">Add a free WAQI token — one line in <code>app.js</code> — to light up the nearest official ANPM monitoring station, with its own live readings and forecast.</p>`;
}

async function renderStation(area){
  const near = nearestStation(area);
  if(!near){ renderStationPlaceholder(); return; }

  const chip=$("stationChip");
  const b0=band(US_BANDS, near.aqi);
  chip.hidden=false;
  chip.style.setProperty("--c", b0.color);
  chip.innerHTML = `<span class="chip__dot"></span><span class="chip__txt">${near.name} · US AQI ${near.aqi}</span>`;
  chip.onclick = ()=> { if(state.map) state.map.setView([near.lat,near.lng], 13); };

  $("station").innerHTML = `<p class="placeholder">Loading ${near.name}…</p>`;
  let feed;
  try{ feed = await fetchStationFeed(near.uid); }
  catch{ $("station").innerHTML = `<p class="placeholder">Couldn't load ${near.name} right now.</p>`; return; }

  const b = band(US_BANDS, feed.aqi);
  const iaqi = feed.iaqi || {};
  const get = k => (iaqi[k] && iaqi[k].v!=null) ? Math.round(iaqi[k].v) : "—";
  const dom = (feed.dominentpol||"").toUpperCase().replace("PM25","PM2.5").replace("PM10","PM10");
  const when = feed.time && feed.time.s ? feed.time.s.replace("T"," ").slice(0,16) : "—";

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
async function selectArea(id, animate=true){
  state.current = id;
  const area = AREAS.find(a=>a.id===id);
  const cur = state.air[id];

  $("areaName").textContent = area.name;
  $("coord").textContent = `${area.lat.toFixed(4)}, ${area.lng.toFixed(4)}`;
  $("areaSelect").value = id;

  renderReadout(cur, animate);
  renderTiles(cur);
  refreshAreaMarkers();

  if(animate && state.map){
    state.map.setView([area.lat,area.lng], Math.max(state.map.getZoom(),12), { animate:!REDUCED });
  }

  renderStation(area);                                   // async, fills in
  $("forecast").innerHTML = `<p class="placeholder">Loading forecast…</p>`;
  try{ renderForecast(await fetchForecast(area)); }
  catch{ $("forecast").innerHTML = `<p class="placeholder">Forecast unavailable.</p>`; }
}

function stampUpdated(){
  $("updated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB",{ hour:"2-digit", minute:"2-digit" });
}

async function refreshAll(initial){
  const spin=$("refreshSpin"); spin.classList.add("on");
  try{
    await Promise.allSettled([ fetchAir(), fetchStations() ]);
    if(state.map){ refreshAreaMarkers(); refreshStationMarkers(); }
    await selectArea(state.current, false);
    stampUpdated();
  }catch(err){
    console.error(err);
    if(initial) $("health").textContent = "Couldn't reach the air-quality service. If you're viewing this in a preview pane, download the files and open index.html in your browser (or host the folder).";
    toast("Couldn't refresh data");
  }finally{
    spin.classList.remove("on");
  }
}

/* ---------- legend + dropdown ---------- */
function buildLegend(){
  $("legend").innerHTML = EU_BANDS.map(b=>
    `<span class="legend__item"><span class="legend__sw" style="background:${b.color}"></span>${b.name}</span>`
  ).join("") + `<span class="legend__item"><span class="legend__sw" style="background:#fff;border-radius:50%"></span>Official station</span>`;
}
function buildDropdown(){
  $("areaSelect").innerHTML = AREAS.map(a=>`<option value="${a.id}">${a.name}</option>`).join("");
  $("areaSelect").value = state.current;
  $("areaSelect").addEventListener("change", e=>selectArea(e.target.value));
}

/* ---------- geolocation ---------- */
function locate(){
  if(!navigator.geolocation){ toast("Location isn't available in this browser"); return; }
  toast("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const me={ lat:pos.coords.latitude, lng:pos.coords.longitude };
      let best=AREAS[0], bestD=Infinity;
      for(const a of AREAS){ const d=haversine(me,a); if(d<bestD){ bestD=d; best=a; } }
      selectArea(best.id);
      toast(`Nearest area: ${best.name}`);
    },
    ()=>toast("Couldn't get your location"),
    { timeout:8000 }
  );
}

/* ============================================================
   INIT
   ============================================================ */
function init(){
  buildDropdown();
  buildLegend();
  try{ buildMap(); }
  catch(err){ console.warn("Map unavailable:", err); $("map").innerHTML = `<p class="placeholder" style="padding:18px">Map couldn't load (offline?). The rest of the app still works.</p>`; }

  $("refreshBtn").addEventListener("click", ()=>refreshAll(false));
  $("locateBtn").addEventListener("click", locate);
  if(!HAS_WAQI) renderStationPlaceholder();

  refreshAll(true);
  setInterval(()=>refreshAll(false), REFRESH_MS);
}

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
else init();
