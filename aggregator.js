const { parseStringPromise } = require('xml2js');
const fs = require('fs/promises');
const cheerio = require('cheerio');

/* ========== CONFIGURATION ========== */
const entriesPerFeed = 3;
const maxItemsPerCategory = 25;
const concurrentFallbackFetches = 4;
/* =================================== */

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

// Using Node.js 18+ built-in fetch

function extractTextField(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    if (field._) return field._;
    if (field['#text']) return field['#text'];
  }
  return String(field);
}

function absolute(src, base) {
  try { return new URL(src, base).href; } catch { return src; }
}

function extractImageFromHtml(html, pageUrl) {
  let match;
  const metaRe = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi;
  while ((match = metaRe.exec(html))) {
    if (match[1]) return absolute(match[1], pageUrl);
  }
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
  if ((match = imgRe.exec(html))) return absolute(match[1], pageUrl);
  return '';
}

function dedupeKeepLatest(list) {
  const seen = new Map();
  list.forEach(item => {
    if (!item.link) return;
    const prev = seen.get(item.link);
    if (!prev || new Date(item.pubDate) > new Date(prev.pubDate)) {
      seen.set(item.link, item);
    }
  });
  return Array.from(seen.values()).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

async function enrichMissingImages(items) {
  const missing = items.filter(i => !i.image && i.link);
  for (let i = 0; i < missing.length; i += concurrentFallbackFetches) {
    const batch = missing.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link);
        const html = await res.text();
        const img = extractImageFromHtml(html, item.link);
        if (img) item.image = img;
      } catch (e) {
        // ignore
      }
    }));
  }
}

function makePlaceholder(title) {
  const words = title ? title.split(' ').slice(0,2).join(' ') : 'EcoPower';
  const text = encodeURIComponent(words);
  return `https://via.placeholder.com/320x180/007ACC/ffffff?text=${text}`;
}

function extractArticleBodyFromHtml(html) {
  const $ = cheerio.load(html);
  let text = $('article').first().text().trim();
  if (!text) {
    text = $('p').map((i, el) => $(el).text()).get().join('\n\n').trim();
  }
  text = text.replace(/\r\n|\r/g, '\n');
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p);
  return paras.join('\n\n');
}

async function enrichArticleBodies(items) {
  const toFetch = items.filter(i => i.link);
  for (let i = 0; i < toFetch.length; i += concurrentFallbackFetches) {
    const batch = toFetch.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link);
        const html = await res.text();
        const body = extractArticleBodyFromHtml(html);
        if (body) item.body = body;
      } catch (e) {
        // ignore
      }
    }));
  }
}

async function aggregate() {
  const result = { categories: [] };
  for (const [category, feedUrls] of Object.entries(feedsByCat)) {
    const collected = [];
    const responses = await Promise.all(
      feedUrls.map(url =>
        fetch(url)
          .then(r => r.text().then(xml => ({ url, xml })))
          .catch(() => null)
      )
    );
    for (const resp of responses) {
      if (!resp?.xml) continue;
      let entries = [];
      try {
        const parsed = await parseStringPromise(resp.xml, { explicitArray: false, mergeAttrs: true });
        if (parsed.rss) entries = parsed.rss.channel.item || [];
        else if (parsed.feed) entries = parsed.feed.entry || [];
      } catch {}
      entries = Array.isArray(entries) ? entries : [entries];
      entries.slice(0, entriesPerFeed).forEach(e => {
        const title = extractTextField(e.title).trim();
        const link = e.link?.href || e.link || e.enclosure?.url || '';
        const descRaw = e.description || e.summary || '';
        const description = extractTextField(descRaw).replace(/<[^>]*>?/gm, '').slice(0, 150).trim();
        const pubDate = e.pubDate || e.updated || e['dc:date'] || '';
        const source = new URL(resp.url).hostname.replace(/^www\./, '');
        const image = e.enclosure?.url || '';
        collected.push({ title, link, description, pubDate, source, image });
      });
    }
    let items = dedupeKeepLatest(collected).slice(0, maxItemsPerCategory);
    await enrichMissingImages(items);
    await enrichArticleBodies(items);
    items.forEach(item => {
      if (!item.image) item.image = makePlaceholder(item.title || item.source);
      if (!item.body) item.body = item.description;
    });
    result.categories.push({ category, items });
  }
  await fs.writeFile('news.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log('news.json generato con successo');
}

aggregate().catch(err => { console.error(err); process.exit(1); });
