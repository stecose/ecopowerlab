// aggregator.js

// POLYFILL per undici (usato da global.fetch su Node 18+)
if (typeof File === 'undefined') {
  globalThis.File = class File {
    constructor(parts, filename, options) {
      this.parts = parts; this.name = filename;
      this.lastModified = options?.lastModified || Date.now();
    }
  };
}

import { parseStringPromise } from "xml2js";
import { load }              from "cheerio";
import fs                    from "fs/promises";

/* ===== CONFIGURAZIONE ===== */
const entriesPerFeed      = 3;    // articoli da ciascun feed
const maxItemsPerCategory = 25;   // articoli totali per categoria
const concurrentFetches   = 4;    // parallelismo per scraping

const feedsByCat = {
  Energia: [
    /* … 20 RSS/Atom per Energia … */
  ],
  SmartHome: [
    /* … 20 per Smart Home … */
  ],
  Mobilita: [
    /* … 20 per Mobilità … */
  ],
  Clima: [
    /* … 20 per Clima … */
  ]
};
/* =========================== */

/* ===== HELPERS ===== */
function extractTextField(f) {
  if (!f) return "";
  if (typeof f === "string") return f;
  if (f._) return f._;
  if (f["#text"]) return f["#text"];
  return String(f);
}
function absolute(src, base) {
  try { return new URL(src, base).href }
  catch { return src }
}
function extractImageFromHtml(html, pageUrl) {
  const $ = load(html);
  let img = $('meta[property="og:image"]').attr("content")
         || $('meta[name="twitter:image"]').attr("content");
  if (img) return absolute(img, pageUrl);

  $('script[type="application/ld+json"]').each((_,el) => {
    try {
      const data = JSON.parse($(el).text());
      const arr  = Array.isArray(data) ? data : [data];
      for (const o of arr) {
        if (o.image) {
          if (typeof o.image === "string") { img = o.image; break }
          if (Array.isArray(o.image) && o.image[0]) { img = o.image[0]; break }
          if (o.image.url) { img = o.image.url; break }
        }
      }
    } catch {}
    if (img) return false;
  });
  if (img) return absolute(img, pageUrl);

  img = $('img').first().attr("src");
  return img ? absolute(img, pageUrl) : "";
}
function dedupeKeepLatest(list) {
  const m = new Map();
  for (const i of list) {
    if (!i.link) continue;
    const prev = m.get(i.link);
    if (!prev || new Date(i.pubDate) > new Date(prev.pubDate)) {
      m.set(i.link, i);
    }
  }
  return [...m.values()].sort((a,b)=> new Date(b.pubDate) - new Date(a.pubDate));
}
async function enrichMissingImages(items) {
  const missing = items.filter(i=>!i.image && i.link);
  for (let i=0; i<missing.length; i+=concurrentFetches) {
    const batch = missing.slice(i, i+concurrentFetches);
    await Promise.all(batch.map(async it => {
      try {
        const res  = await fetch(it.link);
        const html = await res.text();
        const img  = extractImageFromHtml(html, it.link);
        if (img) it.image = img;
      } catch{}
    }));
  }
}
async function enrichContent(items) {
  for (let i=0; i<items.length; i+=concurrentFetches) {
    const batch = items.slice(i, i+concurrentFetches);
    await Promise.all(batch.map(async it => {
      if (!it.link) { it.content = ""; return; }
      try {
        const res  = await fetch(it.link);
        const html = await res.text();
        const $    = load(html);

        let article = $("article").first();
        if (!article.length) article = $("[itemprop='articleBody']").first();
        if (!article.length) article = $("#content, .post-content, main").first();

        let contentHtml = article.length ? article.html() : "";
        if (!contentHtml) {
          contentHtml = $("p").slice(0,5)
                             .map((_,el)=>$.html(el))
                             .get()
                             .join("");
        }
        it.content = contentHtml || "";
      } catch {
        it.content = "";
      }
    }));
  }
}
/* ==================== */

/* ===== AGGREGAZIONE ===== */
async function aggregate() {
  const out = { categories: [] };

  for (const [cat, feeds] of Object.entries(feedsByCat)) {
    let all = [];

    // 1) fetch e parse RSS/Atom
    const raws = await Promise.all(feeds.map(url =>
      fetch(url)
        .then(r=>r.text().then(xml=>({url,xml})))
        .catch(()=>null)
    ));

    for (const r of raws) {
      if (!r) continue;
      let js;
      try {
        js = await parseStringPromise(r.xml, { explicitArray:false, mergeAttrs:true });
      } catch { continue; }

      let entries = [];
      if (js.rss?.channel?.item) {
        const it = js.rss.channel.item;
        entries = Array.isArray(it)?it:[it];
      } else if (js.feed?.entry) {
        const it = js.feed.entry;
        entries = Array.isArray(it)?it:[it];
      }

      entries.slice(0, entriesPerFeed).forEach(e => {
        const title       = extractTextField(e.title).trim();
        let link          = "";
        const descRaw     = e.description||e.summary||"";
        const description = extractTextField(descRaw).replace(/<[^>]*>?/gm,"").trim();
        const pubDate     = e.pubDate||e.updated||e["dc:date"]||"";
        const source      = new URL(r.url).hostname.replace(/^www\./,"");
        let image         = e.enclosure?.url
                          || e["media:content"]?.url
                          || e["media:thumbnail"]?.url
                          || "";

        if (e.link) {
          if (typeof e.link === "string") link = e.link;
          else if (e.link.href)  link = e.link.href;
          else if (Array.isArray(e.link)) {
            const alt = e.link.find(l=>l.rel==="alternate");
            link = alt?.href || e.link[0]?.href || "";
          }
        }
        if (!link && e["feedburner:origLink"]) link = e["feedburner:origLink"];

        all.push({ title, link, description, pubDate, source, image, content:"" });
      });
    }

    // 2) dedupe, ordina, limita
    let items = dedupeKeepLatest(all).slice(0, maxItemsPerCategory);

    // 3) completa immagini e contenuto
    await enrichMissingImages(items);
    await enrichContent(items);

    // 4) placeholder per immagini mancanti
    items.forEach(i => {
      if (!i.image) {
        const txt = encodeURIComponent(i.title.split(" ").slice(0,2).join(" "));
        i.image = `https://via.placeholder.com/320x180/007ACC/ffffff?text=${txt}`;
      }
    });

    out.categories.push({ category: cat, items });
  }

  await fs.writeFile("news.json", JSON.stringify(out,null,2), "utf-8");
  console.log("✅ news.json aggiornato!");
}

aggregate().catch(err => {
  console.error("❌ errore aggregazione:", err);
  process.exit(1);
});
