// stats_env_co2_solar.js (ESM)
import fs from "fs/promises";

const DEFAULT_LAT = process.env.SOLAR_LAT || 41.9028; // Roma
const DEFAULT_LON = process.env.SOLAR_LON || 12.4964;
const PANEL_EFFICIENCY = 0.20; // 20%

// helper fetch con timeout
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

// 1. CO2 da NOAA Mauna Loa (settimanale e mensile)
async function fetchCO2() {
  const result = { weekly_ppm: null, week_begin: null, monthly_ppm: null, month: null, error: null };
  try {
    // Settimanale
    const weeklyResp = await fetchWithTimeout("https://gml.noaa.gov/ccgg/trends/weekly.html");
    if (!weeklyResp.ok) throw new Error(`Weekly CO2 fetch HTTP ${weeklyResp.status}`);
    const weeklyHtml = await weeklyResp.text();
    const weekMatch = /Week beginning on ([\w\s\d,]+):\s*([\d.]+)\s*ppm/i.exec(weeklyHtml);
    if (weekMatch) {
      const weekBegin = new Date(weekMatch[1]);
      result.week_begin = weekBegin.toISOString().slice(0, 10);
      result.weekly_ppm = parseFloat(weekMatch[2]);
    }

    // Mensile
    const monthlyResp = await fetchWithTimeout("https://gml.noaa.gov/ccgg/trends/monthly.html");
    if (!monthlyResp.ok) throw new Error(`Monthly CO2 fetch HTTP ${monthlyResp.status}`);
    const monthlyHtml = await monthlyResp.text();
    const monthMatch = /([A-Za-z]+)\s+(\d{4}):\s+([\d.]+)\s*ppm/i.exec(monthlyHtml);
    if (monthMatch) {
      const monthName = monthMatch[1];
      const year = monthMatch[2];
      const ppm = parseFloat(monthMatch[3]);
      const dt = new Date(`${monthName} 1, ${year}`);
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      result.month = `${year}-${mm}`;
      result.monthly_ppm = ppm;
    }
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

// 2. Temperatura globale - GISTEMP (NASA)
async function fetchGlobalTempAnomaly() {
  const out = { global_monthly_anomaly_c: null, year: null, month: null, error: null };
  try {
    const url = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`GISTEMP fetch HTTP ${res.status}`);
    const text = await res.text();
    const all = text.split("\n");
    const headerIdx = all.findIndex(l => l.trim().startsWith("Year,"));
    if (headerIdx === -1) throw new Error("Header non trovato nel CSV GISTEMP");
    const header = all[headerIdx].split(",").map(h => h.trim());
    const dataLines = all.slice(headerIdx + 1).filter(l => l.trim() && !l.startsWith("  "));
    const rows = dataLines.map(l => {
      const parts = l.split(",").map(p => p.trim());
      const obj = {};
      header.forEach((h, i) => {
        obj[h] = parts[i];
      });
      return obj;
    });
    const years = [...new Set(rows.map(r => r["Year"]))].sort((a, b) => parseInt(b) - parseInt(a));
    let found = false;
    for (const y of years) {
      const row = rows.find(r => r["Year"] === y);
      if (!row) continue;
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      for (let i = months.length - 1; i >= 0; i--) {
        const monthKey = months[i];
        const val = row[monthKey];
        if (val && val !== "***") {
          let anomaly = parseFloat(val);
          if (Math.abs(anomaly) > 10) anomaly = anomaly / 100;
          out.global_monthly_anomaly_c = anomaly;
          out.year = parseInt(y);
          out.month = monthKey;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) throw new Error("Nessuna anomalia trovata nel CSV GISTEMP");
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

function formatDateYYYYMMDD(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// 3. Irraggiamento solare da NASA POWER
async function fetchSolarResource(lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  const out = {
    location: { lat: parseFloat(lat), lon: parseFloat(lon) },
    period: { start: null, end: null },
    average_irradiance_mj_m2_day: null,
    average_irradiance_kwh_m2_day: null,
    panel_efficiency_assumed: PANEL_EFFICIENCY,
    available_energy_kwh_m2_day: null,
    available_power_kw: null,
    error: null
  };
  try {
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const startDate = new Date(end);
    startDate.setDate(end.getDate() - 6);
    const startStr = formatDateYYYYMMDD(startDate);
    const endStr = formatDateYYYYMMDD(end);
    out.period.start = startStr;
    out.period.end = endStr;

    const parameters = "ALLSKY_SFC_SW_DWN";
    const apiUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${parameters}&community=RE&longitude=${lon}&latitude=${lat}&start=${startStr}&end=${endStr}&format=JSON&user=ecopowerlab`;
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) throw new Error(`NASA POWER fetch HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.properties?.parameter?.ALLSKY_SFC_SW_DWN) {
      throw new Error("Risposta NASA POWER in formato inatteso");
    }
    const daily = json.properties.parameter.ALLSKY_SFC_SW_DWN;
    const values = Object.values(daily).map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (!values.length) throw new Error("Nessun valore valido da NASA POWER");
    const avgMj = values.reduce((a, b) => a + b, 0) / values.length;
    out.average_irradiance_mj_m2_day = parseFloat(avgMj.toFixed(3));
    const avgKwh = avgMj * 0.2777777778;
    out.average_irradiance_kwh_m2_day = parseFloat(avgKwh.toFixed(3));
    const availableEnergy = avgKwh * PANEL_EFFICIENCY;
    out.available_energy_kwh_m2_day = parseFloat(availableEnergy.toFixed(4));
    out.available_power_kw = parseFloat((availableEnergy / 24).toFixed(4));
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

async function main() {
  const stats = {
    updated_at: new Date().toISOString(),
    co2: null,
    temperature: null,
    solar: null,
    errors: { co2: null, temperature: null, solar: null }
  };

  const [co2, temp, solar] = await Promise.all([
    fetchCO2(),
    fetchGlobalTempAnomaly(),
    fetchSolarResource()
  ]);

  stats.co2 = {
    weekly_ppm: co2.weekly_ppm,
    week_begin: co2.week_begin,
    monthly_ppm: co2.monthly_ppm,
    month: co2.month
  };
  stats.temperature = {
    global_monthly_anomaly_c: temp.global_monthly_anomaly_c,
    year: temp.year,
    month: temp.month
  };
  stats.solar = {
    location: solar.location,
    period: solar.period,
    average_irradiance_mj_m2_day: solar.average_irradiance_mj_m2_day,
    average_irradiance_kwh_m2_day: solar.average_irradiance_kwh_m2_day,
    panel_efficiency_assumed: solar.panel_efficiency_assumed,
    available_energy_kwh_m2_day: solar.available_energy_kwh_m2_day,
    available_power_kw: solar.available_power_kw
  };

  stats.errors.co2 = co2.error;
  stats.errors.temperature = temp.error;
  stats.errors.solar = solar.error;

  await fs.writeFile("stats_env_co2_solar.json", JSON.stringify(stats, null, 2), "utf-8");
  console.log("stats_env_co2_solar.json generato:", stats);
}

main().catch(e => {
  console.error("Errore nello script:", e);
  process.exit(1);
});
