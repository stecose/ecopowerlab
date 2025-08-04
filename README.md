# Eco Power Lab News Aggregator

Questo repository costruisce `news.json` aggregando 20 feed per categoria (Energia, SmartHome, Mobilità, Clima), deduplica, ordina e applica fallback `og:image` limitato.

## Cosa c'è

- `aggregator.js`: script Node.js che genera `news.json`
- `package.json`: dipendenze (`node-fetch`, `xml2js`)
- `.github/workflows/aggiorna-news.yml`: GitHub Action per eseguire ogni 10 minuti

## Primo setup (locale o GitHub)

1. Clona o crea il repository:
   ```bash
   git clone https://github.com/TUOUSER/REPO.git
   cd REPO
   ```

2. Installa dipendenze:
   ```bash
   npm ci
   ```

3. Esegui manualmente per generare `news.json`:
   ```bash
   node aggregator.js
   ```

4. Controlla che `news.json` sia stato creato. Commit e push:
   ```bash
   git add news.json
   git commit -m "Prima generazione news"
   git push
   ```

## Automazione

La GitHub Action (`.github/workflows/aggiorna-news.yml`) gira ogni 10 minuti e aggiorna `news.json`.

## Pubblica

Abilita GitHub Pages dalle impostazioni del repository su `main` branch (root) e poi potrai ottenere `news.json` all'URL:
```
https://TUOUSER.github.io/REPO/news.json
```

Usalo nel tuo frontend su Blogger sostituendo `URL_TO_JSON` con quel link.

## Debug

- Se vuoi testare offline, modifica `aggregator.js` per limitare feed o aumentare i log.
- Verifica che il file `news.json` sia leggibile e contenga la chiave `categories`.
