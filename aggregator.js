const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');
const fs = require('fs/promises');
const cheerio = require('cheerio');

/* ==================== CONFIGURAZIONE ==================== */
const entriesPerFeed = 3;                  // quanti articoli prelevare da ciascun feed
const maxItemsPerCategory = 25;            // quanti articoli tenere per categoria
const concurrentFallbackFetches = 4;       // quante richieste parallele per arricchire immagini mancanti
/* ======================================================= */

/* ==================== FEED ==================== */
const feedsByCat = {
  Energia: [
    'https://www.rinnovabili.it/feed/',
    'https://energiaoltre.it/feed',
    // ... altri feed ...
  ],
  // ... altre categorie ...
};
/* ================================================ */

/* ==================== HELPERS ==================== */
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
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

function extractImageFromHtml(html, pageUrl) {
  let match;
  const metaRe = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi;
  while ((match = metaRe.exec(html)) !== null) {
    if (match[1]) return absolute(match[1], pageUrl);
  }
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = ldRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        if (obj.image) {
          if (typeof obj.image === 'string') return absolute(obj.image, pageUrl);
          if (Array.isArray(obj.image) && obj.image[0]) return absolute(obj.image[0], pageUrl);
          if (obj.image.url) return absolute(obj.image.url, pageUrl);
        }
        if (obj.mainEntityOfPage && obj.mainEntityOfPage.image) {
          const img = obj.mainEntityOfPage.image;
          if (typeof img === 'string') return absolute(img, pageUrl);
          if (Array.isArray(img) && img[0]) return absolute(img[0], pageUrl);
          if (img.url) return absolute(img.url, pageUrl);
        }
      }
    } catch {}
  }
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
  if ((match = imgRe.exec(html)) && match[1]) {
    return absolute(match[1], pageUrl);
  }
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
  return Array.from(seen.values()).sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
}

async function enrichMissingImages(items) {
  const missing = items.filter(i => !i.image && i.link);
  for (let i = 0; i < missing.length; i += concurrentFallbackFetches) {
    const batch = missing.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link, { redirect: 'follow' });
        const html = await res.text();
        const img = extractImageFromHtml(html, item.link);
        if (img) item.image = img;
      } catch {}
    }));
  }
}

function makePlaceholder(title) {
  const words = (title || 'EcoPower').split(' ').slice(0,2).join(' ');
  const text = encodeURIComponent(words || 'EcoPower');
  return `https://via.placeholder.com/320x180/007ACC/ffffff?text=${text}`;
}

function extractArticleBodyFromHtml(html) {
  const $ = cheerio.load(html);
  let text = $('article').first().text().trim();
  if (!text) text = $('.entry-content, .post-content').first().text().trim();
  if (!text) text = $('p').map((i, el) => $(el).text()).get().join('\n\n').trim();
  text = text.replace(/\r\n|\r/g, '\n');
  const paras = text.split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
  return paras.join('\n\n');
}

async function enrichArticleBodies(items) {
  const toFetch = items.filter(i => i.link);
  for (let i = 0; i < toFetch.length; i += concurrentFallbackFetches) {
    const batch = toFetch.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link, { redirect: 'follow' });
        const html = await res.text();
        const body = extractArticleBodyFromHtml(html);
        if (body) item.body = body;
      } catch {}
    }));
  }
}

async function aggregate() {
  const result = { categories: [] };
  for (const [categoryName, feedUrls] of Object.entries(feedsByCat)) {
    let collected = [];
    const responses = await Promise.all(
      feedUrls.map(url =>
        fetch(url, { redirect: 'follow' })
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
          entries = parsed.rss.channel.item || [];
        } else if (parsed.feed && parsed.feed.entry) {
          entries = parsed.feed.entry;
        }
      } catch {}
      entries = Array.isArray(entries) ? entries : [entries];
      entries.slice(0, entriesPerFeed).forEach(entry => {
        const title = extractTextField(entry.title).trim();
        let link = '';
        if (entry.link) {
          if (typeof entry.link === 'string') link = entry.link;
          else if (entry.link.href) link = entry.link.href;
          else if (Array.isArray(entry.link)) {
            const alt = entry.link.find(l => l.rel === 'alternate');
            link = (alt && alt.href) || entry.link[0].href || '';
          }
        }
        if (!link && entry.enclosure?.url) link = entry.enclosure.url;
        if (!link && entry['feedburner:origLink']) link = entry['feedburner:origLink'];
        const descriptionRaw = entry.description || entry.summary || '';
        const description = extractTextField(descriptionRaw).replace(/<[^>]*>?/gm, '').trim().substring(0,150);
        const pubDate = entry.pubDate || entry.updated || entry['dc:date'] || '';
        const source = resp.url ? new URL(resp.url).hostname.replace(/^www\./, '') : '';
        let image = entry.enclosure?.url || entry['media:content']?.url || entry['media:thumbnail']?.url || '';
        collected.push({ title, link, description, pubDate, source, image });
      });
    }
    let finalItems = dedupeKeepLatest(collected).slice(0, maxItemsPerCategory);
    await enrichMissingImages(finalItems);
    await enrichArticleBodies(finalItems);
    finalItems.forEach(item => {
      if (!item.image) item.image = makePlaceholder(item.title || item.source);
      if (!item.body) item.body = item.description;
    });
    result.categories.push({ category: categoryName, items: finalItems });
  }
  await fs.writeFile('news.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log('news.json generato con successo (ogni articolo ha immagine e body)');
}

aggregate().catch(err => {
  console.error('Errore durante l aggregazione:', err);
  process.exit(1);
});
