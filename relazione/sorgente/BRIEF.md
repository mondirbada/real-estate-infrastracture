# Brief per chi scrive un capitolo della relazione

## Cos'è
La relazione d'esame (Servizi Cloud, ITS) del progetto **Real Estate Platform**: piattaforma immobiliare serverless su
AWS, regione eu-south-1. Si genera in .docx con `node genera.js` da questa cartella; ogni capitolo è un file
`capitoli/<nome>.js` che esporta `(ctx) => [elementi]`. L'ordine dei capitoli e i nomi dei file sono in `genera.js`
(array `CAPITOLI`).

## Il taglio, con le parole di chi l'ha chiesta
"Nel dettaglio sì, ma serve più che altro capire come si collegano le cose. Non serve spiegare a fondo che cosa fa
ogni componente, quello lo si scrive ma in modo un po' meno approfondito. Ciò che importa è l'integrazione,
l'architettura e come le cose comunicano, e anche ovviamente le relazioni IAM e policies e tutto quel mondo lì."

E dopo aver visto la prova: "La prova mi piace: scrivi gli altri capitoli con lo stesso taglio."

## Il modello da seguire
`capitoli/04-5-notifiche.js` è il capitolo approvato: leggilo per intero prima di scrivere. Tono (italiano, narrativo
ma preciso, frasi brevi, "noi" del gruppo, analogie con Spring Boot quando aiutano: il lettore viene da
Java/Spring), struttura e livello di dettaglio vanno ripresi. Ogni **flusso** del capitolo 4 segue questo schema:
1. due o tre paragrafi: cosa succede e perché è progettato così;
2. la figura parziale (`figura(path.join(DIAGRAMMI, "<vista>.png"), w, h, "Figura 4.x — ...")`);
3. "Il percorso in sintesi": elenco numerato;
4. "Chi parla con chi": tabella `#, Da → A, Come, Rete, Chi lo autorizza`;
5. le autorizzazioni passaggio per passaggio, con **le policy vere** lette dal repo con `leggiJson("iam/...")` o
   `leggiJson("config/...")` (mai ricopiate a mano: se serve un estratto, scrivilo identico al file);
6. cosa succede quando qualcosa va storto (errori, limiti, rischi residui);
7. "Perché così": tabella `Scelta, Motivo, Alternativa scartata`;
8. riquadro "All'orale, in breve" con 3-5 domande e risposte brevi.
I capitoli che non sono flussi (1, 2, 3, 5, 6, appendici) adattano lo schema con buon senso, senza riquadri forzati.

## Fonte di verità
La cartella `../../definitivo/` (Markdown + JSON in `iam/` e `config/`): ogni fatto, nome, numero e policy viene da lì.
Leggi `definitivo/README.md` e `definitivo/00-architettura.md` per primi, poi i file dei servizi che ti servono.
Non inventare nulla. Se trovi una contraddizione in `definitivo/`, segui il file più specifico, NON correggerlo e
segnalala nel rapporto. Nomi completi delle risorse come in `definitivo/` (`real-estate-prod-*`), segnaposto
`<ACCOUNT_ID>` ecc. invariati.

## Strumenti (da `stile.js`, già in `ctx.S`)
`h1`, `h2`, `h3`, `p("testo con `codice` e **grassetto** e *corsivo*")`, `punto(t, livello)`,
`elencoNumerato([voci])` (riparte da 1: usalo per ogni elenco numerato), `codice(testo, titolo)`,
`tabella(intestazione, righe, larghezze)` seguita da `dopoTabella()`, `riquadro(titolo, [paragrafi])`,
`figura(file, pxW, pxH, didascalia)`. In `ctx`: `leggiJson(percorsoRelativoADefinitivo)`, `DEF`, `DIAGRAMMI`.
Non usare `numero()` (continua la numerazione tra capitoli). I titoli: `h1` solo per i capitoli (es. "3. Il modello di
sicurezza"), `h2` per i paragrafi numerati (es. "4.2 Login e chiamate all'API", "3.1 ..."), `h3` per le sottosezioni
non numerate.

## Figure disponibili (`relazione/diagrammi/`, larghezza x altezza in px)
spa.png 1311x1756 · api.png 2750x942 · database.png 3216x1163 · file.png 2116x2275 · notifiche.png 4232x2327 ·
account.png 3237x1598 · osservabilita.png 3767x2571 · rete.png 3238x1704 · diagramma completo
`path.join(DEF, "diagrammi/real-estate-v3.png")` 4232x3676. Sono viste della v3 con il flusso in evidenza e il resto
sbiadito. Le figure alte (spa, file) occupano molta pagina: va bene. Numera le figure per capitolo
("Figura 2.1", "Figura 4.3").

## Confini
- Scrivi SOLO i file `capitoli/*.js` che ti sono assegnati. Non toccare `stile.js`, `genera.js`, gli altri capitoli,
  `definitivo/`, `diagrammi/`. Se ti serve un aiuto grafico che non c'è, fallo dentro il tuo file.
- Niente commit, niente push, mai `git stash`.
- Prova il tuo lavoro con
  `node genera.js --solo <tuoi-file-separati-da-virgola> --out /private/tmp/claude-501/-Users-m-charrier-opt-akari/86bdfd14-4757-4c31-8748-13984c8634c1/scratchpad/<tuo-nome>.docx`:
  deve generare senza errori. Non c'è un renderer: controlla il contenuto con
  `unzip -p <file>.docx word/document.xml | sed -e 's/<[^>]*>/ /g' | tr -s ' ' | head -c 3000`.
- Lunghezza indicativa: un flusso come il 4.5 (6-9 pagine) se è ricco di IAM, meno se è semplice. Niente
  riempitivo: ogni paragrafo deve spiegare un collegamento, una scelta o un'autorizzazione.

## Rapporto finale (massimo 15 righe)
File scritti; da quali file di `definitivo/` hai preso cosa; contraddizioni trovate in `definitivo/`; scelte tue da
rivedere; cosa non hai potuto verificare.
