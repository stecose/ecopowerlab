#!/usr/bin/env node

import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import fs from 'fs/promises';
import cheerio from 'cheerio';

/* CONFIGURAZIONE */
const entriesPerFeed = 3;
const maxItemsPerCategory = 25;
const concurrentFetches = 4;

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

/* HELPERS */
const extractText = f => typeof f === 'object' ? (f._ || f['#text'] || '') : (f || '');
const absolute = (u, b) => { try { return new URL(u, b).href; } catch { return u; } };

async function fetchAndParse(url) {
  const xml = await (await fetch(url)).text();
  return parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
}

function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item.link) continue;
    const prev = seen.get(item.link);
    if (!prev || new Date(item.pubDate) > new Date(prev.pubDate)) {
      seen.set(item.link, item);
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

async function enrichImage(item) {
  try {
    const html = await (await fetch(item.link)).text();
    const $ = cheerio.load(html);
    const meta = $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content');
    if (meta) return absolute(meta, item.link);
    const img = $('article img').first().attr('src')
      || $('img').first().attr('src');
    return img ? absolute(img, item.link) : '';
  } catch { return ''; }
}

async function enrichBody(item) {
  try {
    const html = await (await fetch(item.link)).text();
    const $ = cheerio.load(html);
    let text = $('article').text().trim();
    if (!text) {
      text = $('p').map((i, el) => $(el).text()).get().join('\n\n');
    }
    const paras = text.split(/\n\n+/).map(p => p.trim()).filter(p => p);
    return paras.join('\n\n');
  } catch { return item.description; }
}

async function aggregate() {
  const result = { categories: [] };
  for (const [category, urls] of Object.entries(feedsByCat)) {
    const all = [];
    await Promise.all(
      urls.map(async url => {
        try {
          const xmlObj = await fetchAndParse(url);
          const entries = xmlObj.rss?.channel?.item || xmlObj.feed?.entry || [];
          const list = Array.isArray(entries) ? entries : [entries];
          list.slice(0, entriesPerFeed).forEach(e => {
            const title = extractText(e.title).trim();
            let link = e.link?.href || e.link || e.enclosure?.url || '';
            if (Array.isArray(e.link)) {
              const alt = e.link.find(l => l.rel === 'alternate');
              link = alt?.href || e.link[0]?.href || link;
            }
            const description = extractText(e.description || e.summary)
              .replace(/<[^>]*>?/gm, '')
              .slice(0, 150)
              .trim();
            const pubDate = e.pubDate || e.updated || e['dc:date'] || '';
            const source = new URL(url).hostname.replace(/^www\./, '');
            const image = e.enclosure?.url || '';
            all.push({ title, link, description, pubDate, source, image });
          });
        } catch {};
      })
    );
    let items = dedupe(all).slice(0, maxItemsPerCategory);
    for (let i = 0; i < items.length; i += concurrentFetches) {
      const batch = items.slice(i, i + concurrentFetches);
      await Promise.all(
        batch.map(async it => {
          if (!it.image) {
            it.image = await enrichImage(it)
              || `https://via.placeholder.com/320x180?text=${encodeURIComponent(it.title)}`;
          }
          it.body = await enrichBody(it);
        })
      );
    }
    result.categories.push({ category, items });
  }
  await fs.writeFile('news.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log('news.json aggiornato con body');
}

aggregate().catch(err => {
  console.error('Errore:', err);
  process.exit(1);
});
