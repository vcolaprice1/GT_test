# Storie di paese Piemonte

Repertorio bibliografico dei libri di storia dedicati ai comuni piemontesi (1960–2000). Sito statico in italiano, pubblicato con GitHub Pages e aggiornato dalla libreria Zotero.

## Avvio locale

Dalla cartella del repository eseguire `python -m http.server 8765` e aprire `http://localhost:8765/`.

## Pubblicazione e aggiornamenti

In GitHub scegliere **Settings → Pages → Source → GitHub Actions**. Il workflow **Aggiorna Zotero e pubblica** parte a ogni push su `main`, manualmente con **Run workflow** e ogni giorno alle **03:17 UTC**: **04:17 in Italia con ora solare**, **05:17 con ora legale**. È l'orario previsto di avvio; GitHub può ritardare l'esecuzione. Il sito cambia al completamento della pubblicazione, dopo download e controlli. Le modifiche devono prima essere sincronizzate da Zotero desktop alla libreria web.

Per aggiornare il codice, dalla cartella del repository in Git Bash:

```bash
git add index.html app.js styles.css README.md data tools .github .gitignore
git diff --cached
git commit -m "Aggiorna il sito"
git push origin main
```

La libreria pubblica non richiede chiavi. Se diventa privata, usare un secret GitHub Actions `ZOTERO_API_KEY` con accesso in lettura alle schede e alle note. Non inserire credenziali nei file.

## Dati e mappa

L'importatore recupera tutte le pagine dell'API, note e collegamenti SBN. Il catalogo aggiornato viene pubblicato nell'artefatto del sito; `data/catalogo.json` resta il dataset di riferimento dei test. Il periodo 1960–2000 nelle statistiche è fisso. Il conteggio autori considera nomi distinti nel campo autore, normalizzando maiuscole e accenti, senza sommare i curatori.

Il campo **Extra** di Zotero deve contenere `Location: Nome (PROVINCIA)` o `Località: Nome (PROVINCIA)`; più località possono essere separate da punto e virgola. Le coordinate redazionali in `data/geocodes.json` hanno precedenza. Le nuove località vengono geocodificate automaticamente durante l'importazione e memorizzate nella cache di Actions. Il risultato deve corrispondere al nome, alla provincia se indicata e al Piemonte; i casi ambigui non ricevono coordinate arbitrarie e sono elencati nel log.

La ricerca usa Nominatim: una sola richiesta ogni 15,1 secondi, massimo 20 nuove ricerche per esecuzione; risultati positivi e negativi sono conservati nella cache. Eventuali ulteriori luoghi saranno elaborati nelle esecuzioni successive. Gli errori temporanei sono riprovati al giro successivo. Per correggere un risultato incerto, aggiungere coordinate verificate a `data/geocodes.json`. Le cache Actions possono scadere; in quel caso le ricerche mancanti vengono ripetute. La variabile di repository `GEOCODER_URL` consente di configurare un endpoint Nominatim alternativo. [Condizioni d'uso Nominatim](https://operations.osmfoundation.org/policies/nominatim/).

I marcatori blu indicano comuni e frazioni; quelli viola, anche di forma diversa, indicano aree geografiche. Valli e territori storici sono rappresentati da punti di riferimento, non dai loro confini. La classificazione è in `tools/map_locations.py`. I gruppi di marcatori restano color terracotta.

La pubblicazione si interrompe se il download è incompleto, il catalogo è vuoto, scompaiono tutte le note o le schede calano di oltre il 20% rispetto al riferimento. Rimane online l'ultima versione riuscita.

## Contributi

Il modulo richiede titolo e autore/curatore e permette di aggiungere anno, località, URL SBN e altre informazioni. Prepara una GitHub Issue oppure un file di testo scaricabile. Non dispone di un caricamento diretto delle scansioni. Le Issues devono essere abilitate nel repository.

## Importazione RDF e controlli

```bash
python tools/import_zotero.py percorso/esportazione.rdf --geocode
python -m unittest discover -s tools -p 'test_*.py'
node --test tools/test_app.cjs
```

Esportare in formato Zotero RDF con le note incluse. Il PDF in `assets/` è dimostrativo. Le sigle S.l., S.d. e S.n. sono sciolte solo nei filtri e nelle schede aperte. Le parole chiave redazionali non sono mostrate al pubblico. Aggiornare il parametro di versione comune in HTML e JavaScript quando cambia il codice.

## Crediti

Dati bibliografici del progetto, gestiti con Zotero. Cartografia e coordinate: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Mappa: Leaflet e Leaflet.markercluster. Visualizzatore PDF: PDF.js.
