# Storie di paese Piemonte

Web app statica, in italiano, per consultare una bibliografia Zotero. È pronta per GitHub Pages e non richiede un server applicativo.

## Avvio locale

Dalla cartella del progetto:

```powershell
python -m http.server 8765
```

Apri `http://localhost:8765/`. Il catalogo viene caricato da `data/catalogo.json`, quindi aprire direttamente `index.html` come file non basta.

## Pubblicazione su GitHub Pages

1. Su GitHub crea un repository **vuoto**, senza aggiungere README, `.gitignore` o licenza: questi file sono già nella cartella del sito. Prima di renderlo pubblico, verifica di poter distribuire il PDF dimostrativo incluso in `assets/`.
2. Apri **Git Bash** ed esegui i comandi seguenti. La cartella del sito è dentro un'altra cartella Git: entra esattamente in `storie-di-paese-piemonte`, così non carichi gli altri progetti vicini. Sostituisci `UTENTE` e `REPOSITORY` con i dati del repository appena creato.

```bash
cd "/c/Users/vcola/Documents/ChatGPT/IN_Gen/storie-di-paese-piemonte"
git init -b main
git add .gitignore .nojekyll README.md index.html styles.css app.js assets data tools
git status
git commit -m "Pubblica Storie di paese Piemonte"
git remote add origin https://github.com/UTENTE/REPOSITORY.git
git remote -v
git credential-manager github login --username UTENTE --web --force
git push -u origin main
```

Il comando `git credential-manager ... login` apre la pagina di accesso sicura di GitHub nel browser. Accedi lì: la normale password dell'account non è accettata direttamente da `git push`. Se questa cartella ha già un repository Git o un remote `origin`, non ripetere rispettivamente `git init` o `git remote add origin`: controlla prima con `git status` e `git remote -v`.

Se compare `Invalid username or token`, forza nuovamente l'accesso e ripeti il push:

```bash
git credential-manager github login --username UTENTE --web --force
git push -u origin main
```

3. Nel repository GitHub vai su **Settings → Pages**. In **Build and deployment** scegli **Deploy from a branch**, branch `main`, cartella `/(root)`, poi salva. L'indirizzo del sito sarà `https://UTENTE.github.io/REPOSITORY/`.

Per caricare aggiornamenti successivi, sempre dalla cartella del sito in Git Bash:

```bash
git add .gitignore .nojekyll README.md index.html styles.css app.js assets data tools
git status
git commit -m "Aggiorna il sito"
git push
```

Riferimenti: [caricare codice locale su GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github) e [configurare la sorgente di GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

La sezione “Segnalazioni” apre una nuova GitHub Issue quando il sito è su GitHub Pages. Abilita le Issues nelle impostazioni del repository. Fuori da GitHub Pages, il modulo prepara un testo scaricabile e non invia dati a un server.

## Aggiornare la bibliografia

Esporta l'intera biblioteca o collezione Zotero in formato **Zotero RDF**, con **Esporta note** attivo. Poi esegui:

```powershell
python tools/import_zotero.py "C:/percorso/nuova-esportazione.rdf" --geocode
```

Lo script conserva in `data/geocodes.json` le coordinate già trovate: alle importazioni successive interroga OpenStreetMap Nominatim solo per nuove località, rispettando una pausa tra le richieste. Controlla l'output per eventuali località irrisolte. Il campo `Location:` o `Località:` in `Extra` indica il luogo trattato; il normale campo Zotero del luogo di pubblicazione resta separato.

Il filtro **Anno di edizione** seleziona un anno preciso; in alternativa, **Periodo di pubblicazione — Dal / Al** consente un intervallo personalizzato (es. 1970–1973, estremi inclusi). È possibile lasciare un estremo libero. Se l'anno finale precede quello iniziale, compare un avviso. Scegliere un anno singolo azzera l'intervallo e viceversa. Le opere con date su più anni (es. `1978-1980`) sono incluse quando il loro periodo interseca quello scelto; schede e statistiche rispettano l'intero periodo.

**Luoghi di pubblicazione** e **Località trattate** permettono selezioni multiple tramite caselle di spunta, con ricerca all'interno dell'elenco e pulsante per deselezionare. All'interno di ogni gruppo le scelte sono alternative (OR); i due gruppi e gli altri filtri si combinano (AND). Senza caselle selezionate il gruppo non limita i risultati. Il collegamento “Vedi nel catalogo” nella mappa sostituisce la selezione delle località con quella del marcatore. **Azzera i filtri** ripristina tutto, comprese selezioni multiple, ricerche negli elenchi e intervallo di anni. I tag Zotero sono conservati nei dati come informazioni redazionali, ma non sono mostrati nelle schede né inclusi nella ricerca pubblica. Nelle schede il blocco **Note** appare solo se contiene testo; il pulsante SBN rimane senza il paragrafo descrittivo.

I nomi delle località vengono normalizzati all'importazione: spazi, maiuscole/minuscole, ordine delle province e un elenco esplicito di refusi in `PLACE_NAMES` nello script. Le etichette cambiate conservano `originalName` e `originalProvince`; il campo `extra` mantiene il testo originale. Le coordinate esistenti sono riutilizzate. Frazioni, valli e aree storiche non vengono fuse con il comune usato come riferimento cartografico; nomi incerti e province discordanti richiedono revisione redazionale, non correzioni automatiche per somiglianza.

I menu geografici si chiudono cliccando all'esterno, senza perdere le selezioni. La normalizzazione corregge inoltre il luogo di edizione `Sant' Albano Stura` in `Sant'Albano Stura`. Le sigle rimangono inalterate nei dati e nelle schede sintetiche: **solo nei menu dei filtri e nelle schede aperte** vengono mostrate come `S.l. (senza luogo di edizione)`, `S.n. (senza nome)` e `S.d. (senza data)`. Il filtro per anno include `S.d. (senza data)` per le cinque opere esplicitamente contrassegnate come senza data; non comprende i campi semplicemente vuoti e non compare negli estremi numerici Dal/Al.

Nel nuovo RDF **Novara : pagine di storia** riporta già correttamente **Novara, 1977**. La riparazione mirata dell'inversione resta nell'importatore per compatibilità con il vecchio export. Il file RDF originale non viene modificato.

CSS, JavaScript e catalogo hanno un parametro di versione comune (`v=20261020-5`) per evitare che il browser combini file di rilasci diversi. A ogni modifica del codice incrementare quel valore in `index.html` e `app.js`; il catalogo viene comunque rivalidato a ogni caricamento. Se dopo il push appare una vecchia scheda, attendere il completamento di GitHub Pages e ricaricare con **Ctrl + F5**.

Test di regressione, dalla cartella del sito:

```bash
python -m unittest discover -s tools -p 'test_*.py'
node --test tools/test_app.cjs
```

I collegamenti SBN vengono estratti sia dal record bibliografico sia dagli allegati web che Zotero collega tramite `link:link`. Il campo `sbnUrls` contiene gli URL originali: 482 schede dell'esportazione corrente dispongono del pulsante **Consulta nel catalogo SBN**; 26 non hanno un collegamento esportato. Le note restano visibili e ricercabili. La sezione **Il progetto** contiene testi segnaposto lorem ipsum per obiettivi, metodo e fonti, da sostituire con quelli definitivi.

Il catalogo corrente, ricavato da `Storie_di_paese_Piemonte_20_10_2026.rdf`, contiene 508 pubblicazioni; 208 hanno note Zotero testuali, mostrate in testo leggibile nella scheda e ricercabili. Il nuovo export contiene aggiornamenti ma nessun nuovo titolo rispetto al precedente (508 elementi Book in entrambi). Tutte le 484 pubblicazioni che riportano una località trattata sono rappresentate sulla mappa; le altre 24 non hanno quel metadato nell'esportazione. Il confine del Piemonte è salvato in `data/piemonte.geojson` e proviene da OpenStreetMap/Nominatim. Il PDF in `assets/cfp-inwood.pdf` è un documento dimostrativo associato temporaneamente a tutte le schede. Per PDF specifici, aggiorna il percorso `pdf` in `data/catalogo.json` o estendi lo script di importazione con una mappatura stabile degli allegati.

## Crediti

Dati bibliografici: esportazione Zotero fornita dal progetto. Coordinate: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ottenute tramite Nominatim. Cartografia: OpenStreetMap. Librerie mappa: Leaflet e Leaflet.markercluster.
