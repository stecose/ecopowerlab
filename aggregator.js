// aggregator.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs/promises";

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

// helper per estrarre og:image (solo se manca)
async function fetchOgImage(url) {
  try {
    const res = await fetch(url, { redirect: "follow" , timeout: 8000});
    const html = await res.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (match) return match[1];
  } catch (e) {
    // ignore
  }
  return "";
}

function dedupeKeepLatest(list) {
  const seen = new Map(); // link -> item
  list.forEach(item => {
    if (!item.link) return;
    const existing = seen.get(item.link);
    if (!existing) seen.set(item.link, item);
    else {
      // tieni quello con data più recente
      if (new Date(item.pubDate) > new Date(existing.pubDate)) {
        seen.set(item.link, item);
      }
    }
  });
  // ordina
  return Array.from(seen.values()).sort((a,b)=> new Date(b.pubDate) - new Date(a.pubDate));
}

async function aggregate() {
  const result = { categories: [] };

  for (const [cat, feedUrls] of Object.entries(feedsByCat)) {
    let collected = [];

    // parallelo
    const fetches = feedUrls.map(url =>
      fetch(url, { redirect: "follow" })
        .then(res => res.text())
        .then(txt => ({ url, xml: txt }))
        .catch(() => null)
    );
    const responses = await Promise.all(fetches);

    for (const resp of responses) {
      if (!resp || !resp.xml) continue;
      try {
        const parsed = await parseStringPromise(resp.xml, { explicitArray: false, mergeAttrs: true });
        let items = [];
        if (parsed.rss && parsed.rss.channel) {
          const raw = parsed.rss.channel.item;
          items = Array.isArray(raw) ? raw : raw ? [raw] : [];
        } else if (parsed.feed && parsed.feed.entry) {
          const raw = parsed.feed.entry;
          items = Array.isArray(raw) ? raw : raw ? [raw] : [];
        }

        items.slice(0, 3).forEach(entry => {
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
        // parsing fallito, salta
      }
    }

    // dedup, ordina e prendi top 25
    let finalItems = dedupeKeepLatest(collected).slice(0, 25);

    // fallback og:image per i primi senza immagine (max 5 per categoria)
    let missing = 0;
    for (let item of finalItems) {
      if (missing >= 5) break;
      if (!item.image && item.link) {
        const og = await fetchOgImage(item.link);
        if (og) {
          item.image = og;
          missing++;
        }
      }
    }

    result.categories.push({ category: cat, items: finalItems });
  }

  // scrivi file
  await fs.writeFile("news.json", JSON.stringify(result));
}

aggregate().catch(console.error);