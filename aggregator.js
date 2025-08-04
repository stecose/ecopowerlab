// aggregator.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs/promises";

/* CONFIGURAZIONE */
const entriesPerFeed = 3;
const maxItemsPerCategory = 25;
const fallbackOgImageLimitPerCategory = 10;
const concurrentFallbackFetches = 4;

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
  Mobilità: [
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

/* ESTRAZIONE IMMAGINI */

// JSON-LD (NewsArticle ecc.)
function extractFromJsonLd(html) {
  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldRegex.exec(html)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const candidates = Array.isArray(obj) ? obj : [obj];
      for (const item of candidates) {
        if (item.image) {
          if (typeof item.image === "string") return item.image;
          if (Array.isArray(item.image)) return item.image[0];
          if (item.image.url) return item.image.url;
        }
        if (item.mainEntityOfPage && item.mainEntityOfPage.image) {
          const img = item.mainEntityOfPage.image;
          if (typeof img === "string") return img;
          if (Array.isArray(img)) return img[0];
          if (img.url) return img.url;
        }
      }
    } catch (e) {
      // skip invalid JSON-LD
    }
  }
  return "";
}

// Estrae immagine da HTML: og:image / twitter:image, JSON-LD, poi prima <img> valida
function extractImageFromHtml(html, pageUrl) {
  // 1. og:image / twitter:image
  const metaRegex = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi;
  let m;
  while ((m = metaRegex.exec(html)) !== null) {
    try { return new URL(m[1], pageUrl).href; } catch {}
  }

  // 2. JSON-LD
  const jsonLdImg = extractFromJsonLd(html);
  if (jsonLdImg) {
    try { return new URL(jsonLdImg, pageUrl).href; } catch {}
  }

  // 3. Prima <img> sensata con heuristica
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let best = "";
  let bestScore = -1;
  while ((m = imgRegex.exec(html)) !== null) {
    let src = m[1];
    if (!src) continue;
    src = src.trim();
    if (src.startsWith("data:")) continue;
    const lower = src.toLowerCase();
    if (lower.includes("logo") || lower.includes("icon") || lower.endsWith(".svg")) continue;
    let score = 1;
    const context = m[0];
    const widthMatch = context.match(/width=["']?(\d+)["']?/i);
    const heightMatch = context.match(/height=["']?(\d+)["']?/i);
    if (widthMatch) score += parseInt(widthMatch[1], 10) / 100;
    if (heightMatch) score += parseInt(heightMatch[1], 10) / 100;
    if (score > bestScore) {
      bestScore = score;
      try {
        best = new URL(src, pageUrl).href;
      } catch {
        best = src;
      }
    }
  }
  if (best) return best;
  return "";
}

// Dedup e mantieni il più recente per link
function dedupeKeepLatest(list) {
  const seen = new Map();
  list.forEach(item => {
    if (!item.link) return;
    const existing = seen.get(item.link);
    if (!existing) seen.set(item.link, item);
    else if (new Date(item.pubDate) > new Date(existing.pubDate)) {
      seen.set(item.link, item);
    }
  });
  return Array.from(seen.values()).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

// Arricchisce i mancanti con scraping parallelo (fino al limite)
async function enrichMissingImages(items, limit) {
  const toProcess = items.filter(i => !i.image && i.link);
  let processed = 0;
  for (let i = 0; i < toProcess.length && processed < limit; i += concurrentFallbackFetches) {
    const batch = toProcess.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link, { redirect: "follow", timeout: 10000 });
        const html = await res.text();
        const img = extractImageFromHtml(html, item.link);
        if (img) {
          item.image = img;
          processed++;
        }
      } catch (e) {
        // silenzia errori individuali
      }
    }));
  }
}

// placeholder garantito
function makePlaceholder(title) {
  const words = (title || "EcoPower").split(" ").slice(0, 2).join(" ");
  const text = encodeURIComponent(words || "EcoPower");
  return `https://via.placeholder.com/320x180/007ACC/ffffff?text=${text}`;
}

/* AGGREGAZIONE PRINCIPALE */

async function aggregate() {
  const result = { categories: [] };

  for (const [categoryName, feedUrls] of Object.entries(feedsByCat)) {
    let collected = [];

    // fetch paralleli dei feed
    const feedFetches = feedUrls.map(url =>
      fetch(url, { redirect: "follow" })
        .then(res => res.text().then(txt => ({ url, xml: txt })))
        .catch(() => null)
    );
    const feedResponses = await Promise.all(feedFetches);

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

          // immagine iniziale
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
        // parsing fallito
      }
    }

    // dedup e limit
    let finalItems = dedupeKeepLatest(collected).slice(0, maxItemsPerCategory);

    // fallback scraping immagini per i mancanti
    await enrichMissingImages(finalItems, fallbackOgImageLimitPerCategory);

    // ultimo fallback placeholder garantito
    finalItems.forEach(item => {
      if (!item.image || item.image.trim() === "") {
        item.image = makePlaceholder(item.title || item.source || "EcoPower");
      }
    });

    result.categories.push({ category: categoryName, items: finalItems });
  }

  // scrivi news.json
  await fs.writeFile("news.json", JSON.stringify(result, null, 2), "utf-8");
  console.log("news.json generato con successo");
}

/* EXEC */
aggregate().catch(err => {
  console.error("Errore aggregazione:", err);
  process.exit(1);
});
