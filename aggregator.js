// aggregator.js
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs/promises";
import cheerio from "cheerio";

/* ==================== CONFIGURAZIONE ==================== */
const entriesPerFeed = 3;                  // quanti articoli prelevare da ciascun feed
const maxItemsPerCategory = 25;            // quanti articoli tenere per categoria
const concurrentFallbackFetches = 4;       // quante richieste parallele per arricchire immagini mancanti
/* ======================================================= */

/* ==================== FEED ==================== */
const feedsByCat = {
  Energia: [
    "https://www.rinnovabili.it/feed/",
    "https://energiaoltre.it/feed"
  ],
  // ... le altre categorie
};

/* ========== HELPERS ========= */

// Estrae immagine (esistente)
function extractImageFromHtml(html, baseUrl) {
  // ... (codice originale)
}

// Arricchisce immagini mancanti
async function enrichMissingImages(items) {
  // ... (codice originale)
}

// Genera placeholder
function makePlaceholder(title) {
  const words = (title || "EcoPower").split(" ").slice(0,2).join(" ");
  const text = encodeURIComponent(words || "EcoPower");
  return `https://via.placeholder.com/320x180/007ACC/ffffff?text=${text}`;
}

// Nuovo: estrae testo dell’articolo
function extractArticleBodyFromHtml(html) {
  const $ = cheerio.load(html);
  let text = $("article").first().text().trim();
  if (!text) text = $(".entry-content, .post-content").first().text().trim();
  if (!text) text = $("p").map((i, el) => $(el).text()).get().join("\n\n").trim();
  return text.substring(0, 10000);
}

// Nuovo: arricchisce il campo `body`
async function enrichArticleBodies(items) {
  const toFetch = items.filter(i => i.link);
  for (let i = 0; i < toFetch.length; i += concurrentFallbackFetches) {
    const batch = toFetch.slice(i, i + concurrentFallbackFetches);
    await Promise.all(batch.map(async item => {
      try {
        const res = await fetch(item.link, { redirect: "follow" });
        const html = await res.text();
        const body = extractArticleBodyFromHtml(html);
        if (body) item.body = body;
      } catch {
        // silenzia errori
      }
    }));
  }
}

/* ==================== AGGREGAZIONE ==================== */
async function aggregate() {
  const result = { categories: [] };

  for (const [categoryName, feedUrls] of Object.entries(feedsByCat)) {
    let collected = [];

    // 1) fetch paralleli dei feed
    const responses = await Promise.all(feedUrls.map(url => fetch(url).then(r => r.text())));
    const parsed = await Promise.all(responses.map(xml => parseStringPromise(xml)));

    // 2) trasformazione in item (title, link, description, pubDate, source)
    //    e raccolta in `collected`...
    //    (codice originale di parsing XML e mapping)

    // 3) ordinamento, dedup, slice
    let finalItems = /* ... */ collected.slice(0, maxItemsPerCategory);

    // 4) fallback scraping immagini
    await enrichMissingImages(finalItems);

    // 5) estrai il corpo completo
    await enrichArticleBodies(finalItems);

    // 6) fallback generale
    finalItems.forEach(item => {
      if (!item.image) item.image = makePlaceholder(item.title || item.source);
      if (!item.body) item.body = item.description;
    });

    result.categories.push({ category: categoryName, items: finalItems });
  }

  // scrive file
  await fs.writeFile("news.json", JSON.stringify(result, null, 2), "utf-8");
  console.log("news.json generato con successo (ogni articolo ha image e body)");
}

/* ========== RUN ========== */
aggregate().catch(err => {
  console.error("Errore durante l'aggregazione:", err);
  process.exit(1);
});
