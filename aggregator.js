// aggregator.js
import axios              from "axios";
import { parseStringPromise } from "xml2js";
import { load }              from "cheerio";
import fs                    from "fs/promises";

/* ===== CONFIGURAZIONE ===== */
const entriesPerFeed      = 3;    // articoli/fonte
const maxItemsPerCategory = 25;   // articoli/categoria
const concurrentFetches   = 4;    // parallelismi

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
  try { return new URL(src, base).href; }
  catch { return src; }
}
function extractImageFromHtml(html, pageUrl) {
  const $ = load(html);
  // 1) Open Graph / Twitter
  let img = $('meta[property="og:image"]').attr("content")
         || $('meta[name="twitter:image"]').attr("content");
  if (img) return absolute(img, pageUrl);
  // 2) JSON-LD
  $('script[type="application/ld+json"]').each((_,el) => {
    try {
      const data = JSON.parse($(el).text());
      const arr  = Array.isArray(data) ? data : [data];
      for (const o of arr) {
        if (o.image) {
          if (typeof o.image === "string") { img = o.image; break; }
          if (Array.isArray(o.image) && o.image[0]) { img = o.image[0]; break; }
          if (o.image.url) { img = o.image.url; break; }
        }
      }
    } catch{}
    if (img) return false;
  });
  if (img) return absolute(img, pageUrl);
  // 3) prima <img>
  img = $('img').first().attr("src");
  return img ? absolute(img, pageUrl) : "";
}
function dedupeKeepLatest(list) {
  const m = new Map();
  for (const i of list) {
    if (!i.link) continue;
    const prev = m.get(i.link);
    if (!prev || new Date(i.pubDate) > new Date(prev.pubDate)) {
      m.set(i.link,i);
    }
  }
  return [...m.values()].sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate));
}
async function enrichMissingImages(items) {
  const miss = items.filter(i=>!i.image && i.link);
  for (let i=0; i<miss.length; i+=concurrentFetches) {
    const batch = miss.slice(i,i+concurrentFetches);
    await Promise.all(batch.map(async it=>{
      try {
        const res  = await axios.get(it.link,{ timeout:15000 });
        const img  = extractImageFromHtml(res.data,it.link);
        if (img) it.image = img;
      } catch{}
    }));
  }
}
async function enrichContent(items) {
  for (let i=0; i<items.length; i+=concurrentFetches) {
    const batch = items.slice(i,i+concurrentFetches);
    await Promise.all(batch.map(async it=>{
      if (!it.link) { it.content=""; return; }
      try {
        const res  = await axios.get(it.link,{ timeout:15000 });
        const $    = load(res.data);
        let article = $("article").first();
        if (!article.length) article = $("[itemprop='articleBody']").first();
        if (!article.length) article = $("#content, .post-content, main").first();
        let html = article.length?article.html():"";
        if (!html) {
          html = $("p").slice(0,5).map((_,el)=>$.html(el)).get().join("");
        }
        it.content = html||"";
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

    // 1) Fetch + parse RSS/Atom
    const raws = await Promise.all(feeds.map(url =>
      axios.get(url,{ timeout:15000 })
           .then(r=>({url,xml:r.data}))
           .catch(()=>null)
    ));
    for (const r of raws) {
      if (!r) continue;
      let js;
      try { js = await parseStringPromise(r.xml,{ explicitArray:false, mergeAttrs:true }); }
      catch { continue; }

      let entries = [];
      if (js.rss?.channel?.item) {
        const it = js.rss.channel.item;
        entries = Array.isArray(it)?it:[it];
      } else if (js.feed?.entry) {
        const it = js.feed.entry;
        entries = Array.isArray(it)?it:[it];
      }

      entries.slice(0,entriesPerFeed).forEach(e=>{
        const title       = extractTextField(e.title).trim();
        let link          = "";
        if (e.link) {
          if (typeof e.link==="string") link = e.link;
          else if (e.link.href)         link = e.link.href;
          else if (Array.isArray(e.link)) {
            const alt = e.link.find(l=>l.rel==="alternate");
            link = alt?.href||e.link[0]?.href||"";
          }
        }
        if (!link && e["feedburner:origLink"]) link = e["feedburner:origLink"];
        const descRaw     = e.description||e.summary||"";
        const description = extractTextField(descRaw).replace(/<[^>]*>?/gm,"").trim();
        const pubDate     = e.pubDate||e.updated||e["dc:date"]||"";
        const source      = new URL(r.url).hostname.replace(/^www\./,"");
        let image         = e.enclosure?.url
                          || e["media:content"]?.url
                          || e["media:thumbnail"]?.url
                          || "";

        all.push({ title, link, description, pubDate, source, image, content:"" });
      });
    }

    // 2) dedupe, sort, slice
    let items = dedupeKeepLatest(all).slice(0,maxItemsPerCategory);

    // 3) enrich immagini + contenuto
    await enrichMissingImages(items);
    await enrichContent(items);

    // 4) placeholder immagine
    items.forEach(i=>{
      if (!i.image) {
        const txt = encodeURIComponent(i.title.split(" ").slice(0,2).join(" "));
        i.image = `https://via.placeholder.com/320x180/007ACC/ffffff?text=${txt}`;
      }
    });

    out.categories.push({ category:cat, items });
  }

  // Scrivi JSON
  await fs.writeFile("news.json",JSON.stringify(out,null,2),"utf-8");
  console.log("✅ news.json aggiornato!");
}

aggregate().catch(err=>{
  console.error("❌ errore aggregazione:",err);
  process.exit(1);
});
