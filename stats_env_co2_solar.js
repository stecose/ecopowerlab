// stats_env_co2_solar.js
import fs from "fs/promises";

const DEFAULT_LAT = process.env.SOLAR_LAT || 41.9028; // Roma
const DEFAULT_LON = process.env.SOLAR_LON || 12.4964;
const PANEL_EFFICIENCY = 0.20; // 20%

async function fetchWithTimeout(url, opts = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function fetchCO2() {
  const r = { weekly_ppm: null, week_begin: null, monthly_ppm: null, month: null, error: null };
  try {
    // Settimanale
    let resp = await fetchWithTimeout("https://gml.noaa.gov/ccgg/trends/weekly.html");
    if (!resp.ok) throw new Error(`CO2 weekly HTTP ${resp.status}`);
    let html = await resp.text();
    let m = /Week beginning on ([\w\s\d,]+):\s*([\d.]+)\s*ppm/i.exec(html);
    if (m) {
      r.week_begin = new Date(m[1]).toISOString().slice(0,10);
      r.weekly_ppm  = parseFloat(m[2]);
    }
    // Mensile
    resp = await fetchWithTimeout("https://gml.noaa.gov/ccgg/trends/monthly.html");
    if (!resp.ok) throw new Error(`CO2 monthly HTTP ${resp.status}`);
    html = await resp.text();
    m = /([A-Za-z]+)\s+(\d{4}):\s+([\d.]+)\s*ppm/i.exec(html);
    if (m) {
      const dt = new Date(`${m[1]} 1, ${m[2]}`);
      const mm = String(dt.getMonth()+1).padStart(2,"0");
      r.month = `${m[2]}-${mm}`;
      r.monthly_ppm = parseFloat(m[3]);
    }
  } catch (e) {
    r.error = e.message;
  }
  return r;
}

async function fetchGlobalTempAnomaly() {
  const out = { global_monthly_anomaly_c: null, year: null, month: null, error: null };
  try {
    const url = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) throw new Error(`GISTEMP HTTP ${resp.status}`);
    const lines = (await resp.text()).split("\n");
    const headerIdx = lines.findIndex(l=>l.startsWith("Year,"));
    if (headerIdx<0) throw new Error("Header GISTEMP non trovato");
    const header = lines[headerIdx].split(",").map(s=>s.trim());
    const data = lines.slice(headerIdx+1)
      .filter(l=>l.trim()&& !l.startsWith("  "))
      .map(l=>{
        const row = {};
        l.split(",").map(s=>s.trim()).forEach((v,i)=>row[header[i]] = v);
        return row;
      });
    const years = Array.from(new Set(data.map(r=>r.Year))).sort((a,b)=>b-a);
    let found=false;
    for (const y of years) {
      const row = data.find(r=>r.Year===y);
      if (!row) continue;
      for (let i=11;i>=0;i--) {
        const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i];
        const v = row[mon];
        if (v && v!=="***") {
          let a = parseFloat(v);
          if (Math.abs(a)>10) a = a/100;
          out.global_monthly_anomaly_c = a;
          out.year = +y;
          out.month = mon;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) throw new Error("Nessuna anomalia trovata");
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

function fmtDate(d){
  const y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,"0"), dd=String(d.getUTCDate()).padStart(2,"0");
  return `${y}${m}${dd}`;
}

async function fetchSolar(lat=DEFAULT_LAT, lon=DEFAULT_LON){
  const out = {
    location:{lat:+lat,lon:+lon}, period:{start:null,end:null},
    average_irradiance_mj_m2_day:null, average_irradiance_kwh_m2_day:null,
    panel_efficiency_assumed:PANEL_EFFICIENCY,
    available_energy_kwh_m2_day:null, available_power_kw:null,
    error:null
  };
  try {
    const now = new Date(), end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    const start=new Date(end); start.setDate(end.getDate()-6);
    out.period.start=fmtDate(start); out.period.end=fmtDate(end);
    const api = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&start=${out.period.start}&end=${out.period.end}&format=JSON`;
    const resp = await fetchWithTimeout(api);
    if (!resp.ok) throw new Error(`NASA POWER HTTP ${resp.status}`);
    const j = await resp.json();
    const daily = j.properties.parameter.ALLSKY_SFC_SW_DWN;
    const vals = Object.values(daily).map(v=>parseFloat(v)).filter(v=>!isNaN(v));
    if (!vals.length) throw new Error("No solar data");
    const avgMj = vals.reduce((a,b)=>a+b,0)/vals.length;
    out.average_irradiance_mj_m2_day = +avgMj.toFixed(3);
    const avgKwh = avgMj * 0.2777777778;
    out.average_irradiance_kwh_m2_day = +avgKwh.toFixed(3);
    const avail = avgKwh * PANEL_EFFICIENCY;
    out.available_energy_kwh_m2_day = +avail.toFixed(4);
    out.available_power_kw = +(avail/24).toFixed(4);
  } catch(e){
    out.error = e.message;
  }
  return out;
}

async function main(){
  const [co2, temp, solar] = await Promise.all([fetchCO2(), fetchGlobalTempAnomaly(), fetchSolar()]);
  const stats = {
    updated_at: new Date().toISOString(),
    co2: { weekly_ppm: co2.weekly_ppm, week_begin: co2.week_begin, monthly_ppm: co2.monthly_ppm, month: co2.month },
    temperature: { global_monthly_anomaly_c: temp.global_monthly_anomaly_c, year: temp.year, month: temp.month },
    solar: {
      location: solar.location, period: solar.period,
      average_irradiance_mj_m2_day: solar.average_irradiance_mj_m2_day,
      average_irradiance_kwh_m2_day: solar.average_irradiance_kwh_m2_day,
      panel_efficiency_assumed: solar.panel_efficiency_assumed,
      available_energy_kwh_m2_day: solar.available_energy_kwh_m2_day,
      available_power_kw: solar.available_power_kw
    },
    errors: { co2: co2.error, temperature: temp.error, solar: solar.error }
  };

  // Forzo sempre un touch sul file per commit (debug su ogni run)
  stats._touched_at = new Date().toISOString();

  await fs.writeFile("stats_env_co2_solar.json", JSON.stringify(stats,null,2), "utf-8");
  console.log("✅ stats_env_co2_solar.json aggiornato");
}

main().catch(e=>{
  console.error("❌ Errore script:", e);
  process.exit(1);
});
