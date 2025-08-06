// aggregator.js
const fetch = require('node-fetch');            // v2.x
const { parseStringPromise } = require('xml2js');
const fs = require('fs/promises');
const cheerio = require('cheerio');

/* CONFIGURATION */
const entriesPerFeed = 3;
const maxItemsPerCategory = 25;
const concurrentFallbackFetches = 4;

/* FEEDS */
const feedsByCat = {
  Energia: [
    'https://www.rinnovabili.it/feed/',
    'https://energiaoltre.it/feed',
    // … altri feed …
  ],
  // … altre categorie …
};

/* HELPERS */
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
  let m;
  const metaRe = /<meta[^>]*(?:property|name)=[\"'](?:og:image|twitter:image)[\"'][^>]*content=[\"']([^\"']+)[\"']/gi;
  while ((m = metaRe.exec(html))) if (m[1]) return absolute(m[1], pageUrl);
  const imgRe = /<img[^>]+src=[\"']([^\"']+)[\"'][^>]*>/i;
  if ((m = imgRe.exec(html))) return absolute(m[1], pageUrl);
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
  return Array.from(seen.values())
    .sort((a,b)=>new Date(b.pubDate)-new Date(a.pubDate));
}
async function enrichMissingImages(items) {
  const missing = items.filter(i=>!i.image && i.link);
  for (let i=0;i<missing.length;i+=concurrentFallbackFetches) {
    const batch = missing.slice(i,i+concurrentFallbackFetches);
    await Promise.all(batch.map(async it=>{
      try {
        const res = await fetch(it.link);
        const html = await res.text();
        const img = extractImageFromHtml(html, it.link);
        if (img) it.image = img;
      }catch{}
    }));
  }
}
function makePlaceholder(title) {
  const words = title? title.split(' ').slice(0,2).join(' '):'EcoPower';
  return `https://via.placeholder.com/320x180/007ACC/ffffff?text=${encodeURIComponent(words)}`;
}
function extractArticleBodyFromHtml(html) {
  const $ = cheerio.load(html);
  let txt = $('article').first().text().trim();
  if (!txt) txt = $('p').map((i,el)=>$(el).text()).get().join('\n\n').trim();
  const paras = txt.replace(/\r\n|\r/g,'\n')
    .split(/\n\s*\n/).map(p=>p.trim()).filter(p=>p);
  return paras.join('\n\n');
}
async function enrichArticleBodies(items) {
  const toFetch = items.filter(i=>i.link);
  for (let i=0;i<toFetch.length;i+=concurrentFallbackFetches) {
    const batch = toFetch.slice(i,i+concurrentFallbackFetches);
    await Promise.all(batch.map(async it=>{
      try {
        const res = await fetch(it.link);
        const html = await res.text();
        const body = extractArticleBodyFromHtml(html);
        if (body) it.body = body;
      }catch{}
    }));
  }
}

/* AGGREGATION */
async function aggregate() {
  const out = { categories: [] };
  for (const [cat, urls] of Object.entries(feedsByCat)) {
    const coll = [];
    const resps = await Promise.all(
      urls.map(u=> fetch(u)
        .then(r=>r.text().then(xml=>({url:u,xml})))
        .catch(()=>null))
    );
    for (const r of resps) {
      if (!r?.xml) continue;
      let entries = [];
      try {
        const p = await parseStringPromise(r.xml, {explicitArray:false,mergeAttrs:true});
        if (p.rss) entries = p.rss.channel.item || [];
        else if (p.feed) entries = p.feed.entry || [];
      }catch{}
      [].concat(entries).slice(0,entriesPerFeed).forEach(e=>{
        const title = extractTextField(e.title).trim();
        const link = e.link?.href||e.link||e.enclosure?.url||'';
        const desc = extractTextField(e.description||e.summary||'').replace(/<[^>]*>?/gm,'').trim().slice(0,150);
        const pubDate = e.pubDate||e.updated||e['dc:date']||'';
        const source = new URL(r.url).hostname.replace(/^www\./,'');
        const image = e.enclosure?.url||'';
        coll.push({title,link,description:desc,pubDate,source,image});
      });
    }
    let items = dedupeKeepLatest(coll).slice(0, maxItemsPerCategory);
    await enrichMissingImages(items);
    await enrichArticleBodies(items);
    items.forEach(it=>{
      if (!it.image) it.image = makePlaceholder(it.title||it.source);
      if (!it.body) it.body = it.description;
    });
    out.categories.push({category:cat,items});
  }
  await fs.writeFile('news.json', JSON.stringify(out,null,2),'utf-8');
  console.log('news.json generato con successo');
}

aggregate().catch(e=>{
  console.error('Errore aggregazione:',e);
  process.exit(1);
});
