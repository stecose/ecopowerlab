// aggregator.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs/promises";

/* ─── CONFIGURAZIONE ─────────────────────────────────────────── */
const entriesPerFeed = 3;                  // articoli prelevati da ciascun feed
const maxItemsPerCategory = 25;            // articoli mantenuti per categoria
const concurrentFallbackFetches = 4;       // parallelismo per lo scraping immagini
/* ────────────────────────────────────────────────────────────── */

/* ─── FEED ───────────────────────────────────────────────────── */
const feedsByCat = {
  Energia: [ /* ... i tuoi 20 URL ... */ ],
  SmartHome: [ /* ... */ ],
  Mobilita: [ /* ... */ ],
  Clima:    [ /* ... */ ]
};
/* ────────────────────────────────────────────────────────────── */

/* ─── ESTRAZIONE IMMAGINI ────────────────────────────────────── */
// 1) prova i meta tag og:image / twitter:image
// 2) prova JSON-LD (NewsArticle.image)
// 3) altrimenti prendi la PRIMA <img> trovata (niente filtri)
function extractImageFromHtml(html, pageUrl) {
  // OG / Twitter
  let m;
  const metaRe = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi;
  if ((m = metaRe.exec(html)) && m[1]) {
    try { return new URL(m[1], pageUrl).href; } catch {}
  }
  // JSON-LD
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        const img = obj.image;
        if (typeof img === "string") return img;
        if (Array.isArray(img)) return img[0];
        if (img && img.url) return img.url;
      }
    } catch {}
  }
  // Prima <img> qualsiasi
  const imgRe = /<img[^>]+src=["']([^"']+)["']/i;
  if ((m = imgRe.exec(html)) && m[1]) {
    try { return new URL(m[1], pageUrl).href; } catch { return m[1]; }
  }
  return "";
}
/* ────────────────────────────────────────────────────────────── */

/* ─── DEDUP & SORT ───────────────────────────────────────────── */
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
/* ────────────────────────────────────────────────────────────── */

/* ─── SCRAPING FALLBACK PER IMMAGINI ─────────────────────────── */
async function enrichMissingImages(items) {
  const missing = items.filter(i=>!i.image && i.link);
  for (let i=0; i<missing.length; i+=concurrentFallbackFetches) {
    const batch = missing.slice(i, i+concurrentFallbackFetches);
    await Promise.all(batch.map(async item=>{
      try {
        const res = await fetch(item.link, { redirect:"follow", timeout:8000 });
        const html = await res.text();
        const img = extractImageFromHtml(html, item.link);
        if (img) item.image = img;
      } catch {}
    }));
  }
}
/* ────────────────────────────────────────────────────────────── */

/* ─── AGGREGAZIONE PRINCIPALE ───────────────────────────────── */
async function aggregate() {
  const result = { categories: [] };

  for (const [cat, feeds] of Object.entries(feedsByCat)) {
    let allItems = [];

    // 1) fetch paralleli dei feed
    const responses = await Promise.all(
      feeds.map(url =>
        fetch(url, { redirect:"follow" })
          .then(r=>r.text().then(xml=>({url,xml})))
          .catch(()=>null)
      )
    );

    // 2) parse RSS/Atom e raccolta items
    for (const resp of responses) {
      if (!resp || !resp.xml) continue;
      let entries = [];
      try {
        const doc = await parseStringPromise(resp.xml, { explicitArray:false, mergeAttrs:true });
        if (doc.rss && doc.rss.channel) {
          const ch = doc.rss.channel;
          entries = Array.isArray(ch.item) ? ch.item : ch.item?[ch.item]:[];
        }
        else if (doc.feed && doc.feed.entry) {
          entries = Array.isArray(doc.feed.entry) ? doc.feed.entry : [doc.feed.entry];
        }
      } catch {}
      entries.slice(0, entriesPerFeed).forEach(e=>{
        // estrazione campi base
        const title = (e.title && (typeof e.title==="object"?e.title._:e.title)) || "";
        let link = "";
        if (e.link) {
          if (typeof e.link==="string") link=e.link;
          else if (e.link.href) link=e.link.href;
          else if (Array.isArray(e.link)) link=e.link[0].href||"";
        }
        if(!link && e.enclosure && e.enclosure.url) link=e.enclosure.url;
        if(!link && e["feedburner:origLink"]) link=e["feedburner:origLink"];
        const desc = (e.description && e.description._) || e.summary || "";
        const pubDate = e.pubDate||e.updated||e["dc:date"]||"";
        const source = new URL(resp.url).hostname.replace(/^www\./,"");
        // immagine inline feed
        let image = "";
        if (e.enclosure && e.enclosure.url) image=e.enclosure.url;
        if (!image && e["media:content"] && e["media:content"].url) image=e["media:content"].url;
        if (!image && e["media:thumbnail"] && e["media:thumbnail"].url) image=e["media:thumbnail"].url;

        allItems.push({title: title.trim(),link,description:desc.replace(/<[^>]*>?/gm,"").substring(0,150),pubDate,source,image});
      });
    }

    // 3) dedup + sort + slice
    let finalItems = dedupeKeepLatest(allItems).slice(0, maxItemsPerCategory);

    // 4) scraping fallback su tutti quelli rimasti senza image
    await enrichMissingImages(finalItems);

    // 5) se ancora nessuna image, lascia stringa vuota—l'iframe o il frontend potrà gestire con un css background (gradiente o pattern)
    //    ma **qui non usiamo più placeholder automatici**: image="" significa che non c'è immagine reale

    result.categories.push({ category: cat, items: finalItems });
  }

  // 6) scrivi il file
  await fs.writeFile("news.json", JSON.stringify(result, null,2), "utf-8");
  console.log("news.json generato senza placeholder");
}

aggregate().catch(err=>{
  console.error("Errore in aggregate():", err);
  process.exit(1);
});
