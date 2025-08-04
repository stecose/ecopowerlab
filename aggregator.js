// aggregator.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs/promises";

/* ==================== CONFIGURAZIONE ==================== */
const entriesPerFeed = 3;                  // quanti articoli prelevare da ciascun feed
const maxItemsPerCategory = 25;            // quanti articoli tenere per categoria
const concurrentFallbackFetches = 4;       // quante richieste parallele per arricchire immagini mancanti
/* ======================================================= */

/* ==================== FEED ==================== */
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
/* ================================================ */

/* ==================== HELPERS ==================== */

// normalizza un campo testuale che può essere stringa, oggetto con "_" o altro
function extractTextField(field) {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object") {
    if (field._) return field._;
    if (field["#text"]) return field["#text"];
  }
  return String(field);
}

// rende URL assoluto rispetto a base
function absolute(src, base) {
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

// Estrae immagine da HTML: og:image/twitter:image, JSON-LD, poi prima <img>
function extractImageFromHtml(html, pageUrl) {
  let match;

  // 1. og:image / twitter:image
  const metaRe = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi;
  while ((match = metaRe.exec(html)) !== null) {
    if (match[1]) {
      return absolute(match[1], pageUrl);
    }
  }

  // 2. JSON-LD (es. NewsArticle)
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = ldRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        if (obj.image) {
          if (typeof obj.image === "string") return absolute(obj.image, pageUrl);
          if (Array.isArray(obj.image) && obj.image[0]) return absolute(obj.image[0], pageUrl);
          if (obj.image.url) return absolute(obj.image.url, pageUrl);
        }
        if (obj.mainEntityOfPage && obj.mainEntityOfPage.image) {
          const img = obj.mainEntityOfPage.image;
          if (typeof img === "string") return absolute(img, pageUrl);
          if (Array.isArray(img) && img[0]) return absolute(img[0], pageUrl);
          if (img.url) return absolute(img.url, pageUrl);
        }
      }
    } catch {}
  }

  // 3. Prima <img> valida
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
  if ((match = imgRe.exec(html)) && match[1]) {
    return absolute(match[1], pageUrl);
  }

  return "";
}

// dedup mantenendo il più recente per link
function dedupeKeepLatest(list) {
  const seen = new Map();
  list.forEach(item => {
    if (!item.link) return;
    const prev = seen.get(item.link);
    if (!prev || new Date(item.pubDate) > new Date(prev.pubDate)) {
      seen.set(item.link, item);
    }
  });
  return Array.from(seen.values()).sort((a,b)=> new Date(b.pubDate) - new Date(a.pubDate));
}

// fallback scraping per tutti gli articoli senza immagine (parallelizzato)
async function enrichMissingImages(items) {
  const missing = items.filter(i => !i.image && i.link);
  for (let i = 0; i < missing.length; i += concurrentFallbackFetches) {
    const batch = missing.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link, { redirect: "follow" });
        const html = await res.text();
        const img = extractImageFromHtml(html, item.link);
        if (img) item.image = img;
      } catch {}
    }));
  }
}

// placeholder finale (per sicurezza assoluta, dovrebbe essere raro)
function makePlaceholder(title) {
  const words = (title || "EcoPower").split(" ").slice(0,2).join(" ");
  const text = encodeURIComponent(words || "EcoPower");
  return `https://via.placeholder.com/320x180/007ACC/ffffff?text=${text}`;
}

/* ================================================ */

/* ==================== AGGREGAZIONE ==================== */
async function aggregate() {
  const result = { categories: [] };

  for (const [categoryName, feedUrls] of Object.entries(feedsByCat)) {
    let collected = [];

    // fetch paralleli dei feed
    const responses = await Promise.all(
      feedUrls.map(url =>
        fetch(url, { redirect: "follow" })
          .then(r => r.text().then(xml => ({ url, xml })))
          .catch(() => null)
      )
    );

    for (const resp of responses) {
      if (!resp || !resp.xml) continue;

      let entries = [];
      try {
        const parsed = await parseStringPromise(resp.xml, { explicitArray: false, mergeAttrs: true });
        if (parsed.rss && parsed.rss.channel) {
          const ch = parsed.rss.channel;
          const raw = ch.item;
          entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
        } else if (parsed.feed && parsed.feed.entry) {
          const raw = parsed.feed.entry;
          entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
        }
      } catch {}

      entries.slice(0, entriesPerFeed).forEach(entry => {
        const title = extractTextField(entry.title);
        let link = "";
        if (entry.link) {
          if (typeof entry.link === "string") link = entry.link;
          else if (entry.link.href) link = entry.link.href;
          else if (Array.isArray(entry.link)) {
            const alt = entry.link.find(l => l.rel === "alternate");
            link = (alt && alt.href) || (entry.link[0] && entry.link[0].href) || "";
          }
        }
        if (!link && entry.enclosure && entry.enclosure.url) link = entry.enclosure.url;
        if (!link && entry["feedburner:origLink"]) link = entry["feedburner:origLink"];
        const descriptionRaw = entry.description || entry.summary || "";
        const description = extractTextField(descriptionRaw).replace(/<[^>]*>?/gm, "").trim().substring(0,150);
        const pubDate = entry.pubDate || entry.updated || entry["dc:date"] || "";
        const source = resp && resp.url ? new URL(resp.url).hostname.replace(/^www\./,"") : "";

        // immagine iniziale dal feed
        let image = "";
        if (entry.enclosure && entry.enclosure.url) image = entry.enclosure.url;
        if (!image && entry["media:content"] && entry["media:content"].url) image = entry["media:content"].url;
        if (!image && entry["media:thumbnail"] && entry["media:thumbnail"].url) image = entry["media:thumbnail"].url;

        collected.push({
          title: title.trim(),
          link: link,
          description: description,
          pubDate: pubDate,
          source: source,
          image: image
        });
      });
    }

    // dedup + ordinamento + limit
    let finalItems = dedupeKeepLatest(collected).slice(0, maxItemsPerCategory);

    // fallback scraping immagini su quelli senza
    await enrichMissingImages(finalItems);

    // garantisce immagine per tutti, ultima risorsa placeholder
    finalItems.forEach(item => {
      if (!item.image || item.image.trim() === "") {
        item.image = makePlaceholder(item.title || item.source || "EcoPower");
      }
    });

    result.categories.push({ category: categoryName, items: finalItems });
  }

  // scrive file
  await fs.writeFile("news.json", JSON.stringify(result, null, 2), "utf-8");
  console.log("news.json generato con successo (ogni articolo ha immagine)");
}

/* ========== RUN ========== */
aggregate().catch(err => {
  console.error("Errore durante l'aggregazione:", err);
  process.exit(1);
});
