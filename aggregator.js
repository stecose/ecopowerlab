#!/usr/bin/env node

import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import { writeFile } from 'fs/promises';
import { load } from 'cheerio';

// CONFIGURAZIONE
const entriesPerFeed = 3;
const maxItemsPerCategory = 25;
const concurrentFetches = 4;

// FEEDS
const feedsByCat = {
  Energia: [
    'https://www.rinnovabili.it/feed/',
    'https://energiaoltre.it/feed'
  ],
  SmartHome: [
    // aggiungi altri feed qui
  ],
  Mobilita: [
    // aggiungi altri feed qui
  ],
  Clima: [
    // aggiungi altri feed qui
  ]
};

// HELPERS
const extractText = f => typeof f === 'object' ? (f._ || f['#text'] || '') : (f || '');
const absoluteUrl = (u, b) => { try { return new URL(u, b).href; } catch { return u; } };

async function fetchAndParse(url) {
  const xml = await fetch(url).then(r => r.text());
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
    const html = await fetch(item.link).then(r => r.text());
    const $ = load(html);
    const meta = $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content');
    if (meta) return absoluteUrl(meta, item.link);
    const src = $('img').first().attr('src');
    return src ? absoluteUrl(src, item.link) : '';
  } catch {
    return '';
  }
}

async function enrichBody(item) {
  try {
    const html = await fetch(item.link).then(r => r.text());
    const $ = load(html);
    let text = $('article').text().trim();
    if (!text) {
      text = $('p').map((i, el) => $(el).text()).get().join('\n\n');
    }
    return text.split(/\n\n+/).map(p => p.trim()).filter(p => p).join('\n\n');
  } catch {
    return item.description;
  }
}

async function aggregate() {
  const out = { categories: [] };
  for (const [category, urls] of Object.entries(feedsByCat)) {
    const collected = [];
    await Promise.all(urls.map(async u => {
      try {
        const xml = await fetchAndParse(u);
        const entries = xml.rss?.channel?.item || xml.feed?.entry || [];
        const list = Array.isArray(entries) ? entries : [entries];
        list.slice(0, entriesPerFeed).forEach(e => {
          const title = extractText(e.title).trim();
          const link = e.link?.href || e.link || '';
          const description = extractText(e.description || e.summary)
            .replace(/<[^>]*>/g, '')
            .slice(0, 150)
            .trim();
          const pubDate = e.pubDate || e.updated || '';
          const source = new URL(u).hostname.replace(/^www\./, '');
          collected.push({ title, link, description, pubDate, source, image: '', body: '' });
        });
      } catch {}
    }));
    let items = dedupe(collected).slice(0, maxItemsPerCategory);
    for (let i = 0; i < items.length; i += concurrentFetches) {
      const batch = items.slice(i, i + concurrentFetches);
      await Promise.all(batch.map(async it => {
        if (!it.image) {
          it.image = await enrichImage(it)
            || `https://via.placeholder.com/320x180?text=${encodeURIComponent(it.title)}`;
        }
        it.body = await enrichBody(it);
      }));
    }
    out.categories.push({ category, items });
  }
  await writeFile('news.json', JSON.stringify(out, null, 2), 'utf-8');
  console.log('news.json aggiornato con body');
}

aggregate().catch(err => {
  console.error(err);
  process.exit(1);
});
