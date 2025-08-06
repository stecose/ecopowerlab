// aggregator.js
import fs from 'fs';
import Parser from 'rss-parser';
import cheerio from 'cheerio';

(async () => {
  const parser = new Parser();
  // Lista dei feed RSS da aggregare
  const feedList = [
    { title: 'CanaleEnergia', url: 'https://www.canaleenergia.com/feed/' },
    { title: 'GreenEconomy',  url: 'https://www.greeneconomy.it/feed/' },
    // aggiungi qui le tue altre categorie…
  ];

  const categories = [];

  for (const { title: categoryTitle, url: feedUrl } of feedList) {
    console.log(`Parsing feed ${categoryTitle}…`);
    const feed = await parser.parseURL(feedUrl);
    const items = [];

    for (const item of feed.items) {
      try {
        // Scarica l'HTML completo dell'articolo
        const resp = await fetch(item.link);
        const html = await resp.text();

        // Carica in Cheerio e ne estrae solo il testo
        const $ = cheerio.load(html);
        // Se esiste un <article>, prendi quello; altrimenti tutto <body>
        const container = $('article').length ? $('article') : $('body');
        // Estrai il testo, collapse di più spazi e trim
        const rawText = container.text();
        const bodyText = rawText
          .replace(/\s+/g, ' ')   // normalizza spazi
          .trim();

        // Cerca immagine via meta og:image
        const image = $('meta[property="og:image"]').attr('content') || '';

        items.push({
          title:       item.title || '',
          link:        item.link  || '',
          guid:        item.guid  || item.link,
          pubDate:     item.pubDate || '',
          source:      categoryTitle,
          image,
          description: item.contentSnippet || '',
          body:        bodyText
        });
      } catch (err) {
        console.error(`Errore su articolo ${item.link}:`, err.message);
      }
    }

    categories.push({ title: categoryTitle, items });
  }

  // Scrive il JSON con indentazione per debug
  const output = {
    date:       new Date().toISOString(),
    categories
  };
  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log('news.json generato correttamente.');
})();
