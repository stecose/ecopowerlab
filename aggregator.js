// aggregator.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs/promises";

/* CONFIGURAZIONE */
const entriesPerFeed = 4;                  // articoli presi per ogni feed
const maxItemsPerCategory = 25;            // pool finale per categoria
const fallbackOgImageLimitPerCategory = 10; // quanti fallback og:image per categoria
const concurrentFallbackFetches = 4;        // quanti fetch paralleli per page-scraping immagini

/* FEED PER CATEGORIA */
const feedsByCat = {
  Energia: [
    "https://www.rinnovabili.it/feed/",
    "https://energiaoltre.it/feed",
    "https://www.qualenergia.it/feed",
    "https://www.canaleenergia.com/feed",
    "https://www.solareb2b.it/feed",
    "https://www.nextville.it/feed",
    "https://www.greenplanner.it/feed",
    "https://www.energiamagazine.it/feed",
    "https://www.energeticambiente.it/blogs/feed",
    "https://www.energoclub.org/feed",
    "https://www.staffettaonline.com/rss.aspx",
    "https://www.mercatoelettrico.org/it/feed/",
    "https://www.smart-grid.it/feed",
    "https://www.windenergyitalia.it/feed",
    "https://www.hydrogen-news.it/feed",
    "https://www.geotermia.news/feed",
    "https://www.bioenergyitaly.it/feed",
    "https://www.energycue.it/feed",
    "https://www.powerengineeringint.com/feed/",
    "https://www.oilgasnews.it/feed"
  ],
  SmartHome: [
    "https://www.smartworld.it/feed",
    "https://iotitaly.net/feed",
    "https://www.domotica.it/feed",
    "https://www.digitalic.it/feed",
    "https://www.hwupgrade.it/news/rss.xml",
    "https://www.tomshw.it/feed",
    "https://www.gadgetblog.it/feed",
    "https://www.tecnologia.libero.it/feed",
    "https://www.macitynet.it/feed",
    "https://www.androidworld.it/feed",
    "https://www.hdblog.it/rss",
    "https://www.wired.it/feed/rss",
    "https://www.aranzulla.it/feed",
    "https://www.dday.it/rss",
    "https://www.corriere.it/tecnologia/rss.xml",
    "https://www.repubblica.it/rss/tecnologia/rss2.0.xml",
    "https://www.internet4things.it/feed",
    "https://www.webnews.it/feed",
    "https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml",
    "https://www.sicurezzamagazine.it/feed"
  ],
  Mobilita: [
    "https://www.electricmotornews.com/feed/",
    "https://insideevs.it/feed",
    "https://www.quattroruote.it/news/rss.xml",
    "https://www.automoto.it/rss/news.xml",
    "https://www.autoblog.it/feed",
    "https://www.alvolante.it/rss.xml",
    "https://www.vaielettrico.it/feed/",
    "https://www.ev-news.it/feed",
    "https://www.formulapassion.it/feed",
    "https://www.ecomobilitytoday.it/feed",
    "https://www.motorage.it/feed",
    "https://www.greencarcongress.com/index.xml",
    "https://www.hybridcars.com/feed",
    "https://www.fleetmagazine.com/feed",
    "https://www.moto.it/rss/news.xml",
    "https://www.cycleworld.com/rss.xml",
    "https://www.trasporti-italia.com/feed",
    "https://www.truck.it/feed",
    "https://www.motorionline.com/feed",
    "https://www.electric-vehicles.com/feed"
  ],
  Clima: [
    "https://www.lifegate.it/feed",
    "https://www.ansa.it/canale_ambiente/notizie/rss/ambiente_rss.xml",
    "https://www.greenreport.it/feed/",
    "https://www.ecoalleanza.it/feed",
    "https://www.eco-news.it/feed",
    "https://www.greenstyle.it/feed",
    "https://www.ilfattoquotidiano.it/ambiente/feed/",
    "https://www.wwf.it/rss",
    "https://www.isprambiente.gov.it/it/feed/RSS",
    "https://www.environmentsustainability.it/feed",
    "https://www.arpat.toscana.it/feed",
    "https://www.euractiv.it/feed/",
    "https://www.reteclima.it/feed",
    "https://www.legambiente.it/feed",
    "https://www.climalteranti.it/feed",
    "https://www.copernicus.eu/en/rss.xml",
    "https://www.nature.com/subjects/climate-change.rss",
    "https://www.fai-platform.it/feed",
    "https://www.consorziobiogas.it/feed"
  ]
};

/* HELPERS */

// prova a estrarre og:image / twitter:image / prima immagine significativa
function extractImageFromHtml(html, pageUrl) {
  // 1. og:image o twitter:image
  const metaRegex = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i;
  const mMeta = html.match(metaRegex);
  if (mMeta && mMeta[1]) {
    try {
      return new URL(mMeta[1], pageUrl).href;
    } catch {}
  }

  // 2. prima <img> sensata (escludi svg, icone, data:, logo)
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1];
    if (!src) continue;
    src = src.trim();
    // ignora data URI, SVG, icone banali
    if (src.startsWith("data:")) continue;
    if (src.toLowerCase().includes("logo")) continue;
    if (src.toLowerCase().includes("icon")) continue;
    if (src.toLowerCase().endsWith(".svg")) continue;
    // normalizza
    try {
      return new URL(src, pageUrl).href;
    } catch {}
  }
  return "";
}

// dedup per link tenendo il più recente
function dedupeKeepLatest(list) {
  const seen = new Map();
  list.forEach(item => {
    if (!item.link) return;
    const existing = seen.get(item.link);
    if (!existing) seen.set(item.link, item);
    else {
      if (new Date(item.pubDate) > new Date(existing.pubDate)) {
        seen.set(item.link, item);
      }
    }
  });
  return Array.from(seen.values()).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

// fallback per arricchire immagini con limitata concorrenza
async function enrichMissingImages(items, limit) {
  let missing = 0;
  // processa in batch di concurrentFallbackFetches
  for (let i = 0; i < items.length && missing < limit; ) {
    const batch = [];
    for (let j = 0; j < concurrentFallbackFetches && i < items.length && missing < limit; i++) {
      const item = items[i];
      if (!item.image && item.link) {
        batch.push(item);
        missing++;
      }
      j++;
    }
    if (batch.length === 0) continue;
    // esegui batch in parallelo
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link, { redirect: "follow", timeout: 10000 });
        const html = await res.text();
        const found = extractImageFromHtml(html, item.link);
        if (found) item.image = found;
      } catch (e) {
        // silenzioso
      }
    }));
  }
}

/* AGGREGAZIONE PRINCIPALE */

async function aggregate() {
  const result = { categories: [] };

  for (const [categoryName, feedUrls] of Object.entries(feedsByCat)) {
    let collected = [];

    // fetch paralleli dei feed
    const fetchPromises = feedUrls.map(url =>
      fetch(url, { redirect: "follow" })
        .then(res => res.text().then(txt => ({ url, xml: txt })))
        .catch(() => null)
    );
    const feedResponses = await Promise.all(fetchPromises);

    for (const resp of feedResponses) {
      if (!resp || !resp.xml) continue;
      try {
        const parsed = await parseStringPromise(resp.xml, { explicitArray: false, mergeAttrs: true });
        let entries = [];
        if (parsed.rss && parsed.rss.channel) {
          const raw = parsed.rss.channel.item;
          entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
        } else if (parsed.feed && parsed.feed.entry) {
          const raw = parsed.feed.entry;
          entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
        }

        entries.slice(0, entriesPerFeed).forEach(entry => {
          const title = (entry.title && (typeof entry.title === "object" ? entry.title._ : entry.title)) || "";
          let link = "";
          if (entry.link) {
            if (typeof entry.link === "string") link = entry.link;
            else if (entry.link.href) link = entry.link.href;
            else if (Array.isArray(entry.link)) {
              const alt = entry.link.find(l => l.rel === "alternate");
              link = (alt && alt.href) || entry.link[0].href || "";
            }
          }
          if (!link && entry.enclosure && entry.enclosure.url) link = entry.enclosure.url;
          if (!link && entry["feedburner:origLink"]) link = entry["feedburner:origLink"];
          const description = (entry.description && entry.description._) || entry.summary || "";
          const pubDate = entry.pubDate || entry.updated || entry["dc:date"] || "";
          const source = new URL(resp.url).hostname.replace(/^www\./, "");

          // immagine dal feed
          let image = "";
          if (entry.enclosure && entry.enclosure.url) image = entry.enclosure.url;
          if (!image && entry["media:content"] && entry["media:content"].url) image = entry["media:content"].url;
          if (!image && entry["media:thumbnail"] && entry["media:thumbnail"].url) image = entry["media:thumbnail"].url;

          collected.push({
            title: title.trim(),
            link: link,
            description: description.replace(/<[^>]*>?/gm, "").substring(0, 150),
            pubDate: pubDate,
            source: source,
            image: image
          });
        });
      } catch (e) {
        // parsing fallito, continua
      }
    }

    // dedup, ordina e riduci
    let finalItems = dedupeKeepLatest(collected).slice(0, maxItemsPerCategory);

    // fallback immagini mancanti
    await enrichMissingImages(finalItems, fallbackOgImageLimitPerCategory);

    result.categories.push({ category: categoryName, items: finalItems });
  }

  // scrivi news.json
  await fs.writeFile("news.json", JSON.stringify(result, null, 2), "utf-8");
  console.log("news.json generato con successo");
}

/* ENTRY POINT */
aggregate().catch(err => {
  console.error("Errore durante l'aggregazione:", err);
  process.exit(1);
});
