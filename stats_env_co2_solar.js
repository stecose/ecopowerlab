// stats_env_co2_solar.js (ESM)
// https://github.com/tuo-username/tuo-repo

import fs from "fs/promises";

const USER_AGENT = "EcoPowerLabBot/1.0 (+https://tuo-sito.it)";
const DEFAULT_LAT = process.env.SOLAR_LAT || 41.9028;
const DEFAULT_LON = process.env.SOLAR_LON || 12.4964;
const PANEL_EFFICIENCY = 0.20;

// helper fetch con timeout (solo per GISTEMP e NASA POWER)
async function fetchWithTimeout(url, opts = {}, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(opts.headers || {}) }
    });
  } finally {
    clearTimeout(id);
  }
}

// 1) CO₂ da NOAA CSV senza timeout
async function fetchCO2() {
  const r = { weekly_ppm: null, week_begin: null, monthly_ppm: null, month: null, error: null };
  try {
    // weekly
    let resp = await fetch("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_weekly_mlo.txt");
    if (!resp.ok) throw new Error("CO2 weekly HTTP " + resp.status);
    let txt = await resp.text();
    let lines = txt.split("\n").filter(l => l && !l.startsWith("#"));
    let last = lines.pop().trim().split(/\s+/);
    const year = +last[0], doy = +last[1];
    const date = new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
    r.week_begin = date.toISOString().slice(0,10);
    r.weekly_ppm = parseFloat(last[2]);

    // monthly
    resp = await fetch("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt");
    if (!resp.ok) throw new Error("CO2 monthly HTTP " + resp.status);
    txt = await resp.text();
    lines = txt.split("\n").filter(l => l && !l.startsWith("#"));
    last = lines.pop().trim().split(/\s+/);
    const dt = new Date(`${last[0]}-${Math.round(+last[1])}-01`);
    const mm = String(dt.getMonth()+1).padStart(2,"0");
    r.month = `${last[0]}-${mm}`;
    r.monthly_ppm = parseFloat(last[2]);
  } catch (e) {
    r.error = e.message;
  }
  return r;
}

// 2) Temperatura globale – GISTEMP con timeout
async function fetchGlobalTempAnomaly() {
  const out = { global_monthly_anomaly_c: null, year: null, month: null, error: null };
  try {
    const url = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error("GISTEMP HTTP " + res.status);
    const text = await res.text();
    const lines = text.split("\n");
    const idx = lines.findIndex(l=>l.startsWith("Year,"));
    if (idx < 0) throw new Error("Header GISTEMP non trovato");
    const hdr = lines[idx].split(",").map(h=>h.trim());
    const data = lines.slice(idx+1)
      .filter(l=>l.trim()&&!l.startsWith("  "))
      .map(l=>Object.fromEntries(hdr.map((h,i)=>[h, l.split(",")[i].trim()])));
    const years = [...new Set(data.map(r=>r.Year))].sort((a,b)=>b-a);
    for (const y of years) {
      const row = data.find(r=>r.Year===y);
      for (let i=11;i>=0;i--) {
        const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i];
        const v = row[mon];
        if (v && v!=="***") {
          let a = parseFloat(v);
          if (Math.abs(a)>10) a /= 100;
          out.global_monthly_anomaly_c = +a.toFixed(2);
          out.year = +y;
          out.month = mon;
          return out;
        }
      }
    }
    throw new Error("Nessuna anomalia trovata");
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// helper data
function fmtDate(d) {
  return d.getUTCFullYear()
    + String(d.getUTCMonth()+1).padStart(2,"0")
    + String(d.getUTCDate()).padStart(2,"0");
}

// 3) Irraggiamento solare – NASA POWER con timeout
async function fetchSolarResource(lat=DEFAULT_LAT, lon=DEFAULT_LON) {
  const out = {
    location:{lat:+lat, lon:+lon},
    period:{start:null,end:null},
    average_irradiance_mj_m2_day:null,
    average_irradiance_kwh_m2_day:null,
    panel_efficiency_assumed:PANEL_EFFICIENCY,
    available_energy_kwh_m2_day:null,
    available_power_kw:null,
    error:null
  };
  try {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    const start = new Date(end); start.setDate(end.getDate()-6);
    out.period.start = fmtDate(start);
    out.period.end   = fmtDate(end);
    const api = `https://power.larc.nasa.gov/api/temporal/daily/point`
      + `?parameters=ALLSKY_SFC_SW_DWN&community=RE`
      + `&longitude=${lon}&latitude=${lat}`
      + `&start=${out.period.start}&end=${out.period.end}`
      + `&format=JSON`;
    const res = await fetchWithTimeout(api);
    if (!res.ok) throw new Error("NASA POWER HTTP " + res.status);
    const j = await res.json();
    const daily = j.properties?.parameter?.ALLSKY_SFC_SW_DWN || {};
    const vals = Object.values(daily).map(v=>parseFloat(v)).filter(v=>v>=0);
    if (!vals.length) throw new Error("No valid solar values");
    const avgMj = vals.reduce((a,b)=>a+b,0)/vals.length;
    out.average_irradiance_mj_m2_day  = +avgMj.toFixed(2);
    const avgKwh = avgMj * 0.27778;
    out.average_irradiance_kwh_m2_day = +avgKwh.toFixed(2);
    const avail = avgKwh * PANEL_EFFICIENCY;
    out.available_energy_kwh_m2_day   = +avail.toFixed(3);
    out.available_power_kw            = +(avail/24).toFixed(3);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// main
(async()=>{
  const [co2, temp, solar] = await Promise.all([
    fetchCO2(),
    fetchGlobalTempAnomaly(),
    fetchSolarResource()
  ]);

  const stats = {
    updated_at: new Date().toISOString(),
    co2,
    temperature: temp,
    solar,
    errors: { co2:co2.error, temperature:temp.error, solar:solar.error },
    _touched_at: new Date().toISOString()
  };

  await fs.writeFile("stats_env_co2_solar.json", JSON.stringify(stats,null,2), "utf-8");
  console.log("✅ stats_env_co2_solar.json aggiornato");
})();
