# Brief per chi scrive un capitolo della relazione (versione 2)

## Cos'è
La relazione d'esame (Servizi Cloud, ITS) del progetto **Real Estate Platform**: piattaforma immobiliare serverless su
AWS, regione eu-south-1. Si genera in .docx con `node genera.js` da questa cartella; ogni capitolo è un file
`capitoli/<nome>.js` che esporta `(ctx) => [elementi]`. Ordine e nomi dei file: array `CAPITOLI` in `genera.js`.

La **prima versione** completa è in `capitoli/_v1/` (non viene più caricata): è il materiale da cui partire, già
rivisto e corretto nei fatti. La v2 la riscrive più corta e con un'impostazione diversa. `capitoli/_v1/04-5-notifiche.js`
era il capitolo modello per il tono.

## Cosa ha detto chi l'ha letta (le sue parole)
1. "Alcune cose sono troppo in dettaglio."
2. "Voglio che la prima parte sia centrata su qual è il problema e come si risolve."
3. "Nessun riferimento a Spring: serviva a me, ma in una relazione cosa c'entra Java?"
4. "Troppo lunga: come target direi 25 pagine al massimo (di scritte, 40-45 con le immagini è ok)."
E sulle domande: niente riquadri "All'orale"; "il codice sì [toglierlo], tanto il resto è su GitHub"; le appendici con
policy e configurazioni complete restano (fuori dal conto delle pagine).

## Regole della v2
- **Niente** Spring, Java o analogie con altri framework. **Niente** riquadri "All'orale" né domande e risposte.
- **Niente codice**: niente codice delle Lambda, SQL, eventi d'esempio, payload, comandi da terminale. Nel testo restano
  solo le **policy IAM e le configurazioni che spiegano un collegamento** (con `leggiJson`, o un estratto identico al
  file), al massimo due o tre per flusso; il resto sta in appendice e si richiama ("testo completo in Appendice A").
- **Meno dettaglio sui componenti**, più su **come si collegano** e **chi autorizza cosa**. Un dettaglio resta solo se
  serve a capire un collegamento, una scelta o un rischio.
- Tono: italiano, narrativo ma asciutto, "noi" del gruppo, frasi brevi. Niente formule da IA ("è importante notare",
  "vale la pena", "in sintesi possiamo dire").
- **Budget di parole: è un vincolo, non un'indicazione.** ~450 parole = una pagina. Controlla con
  `node conta.js <tuoi-capitoli-separati-da-virgola>` e stai entro il budget (tolleranza +10%). Tabelle e didascalie
  contano.
- Schema di un flusso del capitolo 3 (compatto): un paragrafo con il problema che il flusso risolve e la soluzione;
  la figura; "Il percorso" (elenco numerato breve); "Chi parla con chi" (tabella `Da → A, Come, Chi lo autorizza`, al
  massimo 3 colonne o 4 se servono); le autorizzazioni chiave con 1-3 policy; un paragrafo su cosa succede quando
  qualcosa va storto; le scelte in due o tre frasi (le alternative scartate stanno nel capitolo 5).
- Rimandi: i concetti IAM generali stanno nel capitolo 4 (Sicurezza e IAM), che viene **dopo** i flussi: nei flussi
  basta una frase e un rimando ("vedi 4.1").

## Fonte di verità
`../../definitivo/` (Markdown + JSON in `iam/` e `config/`) e i capitoli di `capitoli/_v1/` già corretti. Non
inventare nulla. Nomi completi delle risorse (`real-estate-prod-*`), segnaposto `<ACCOUNT_ID>` invariati.

## Strumenti (da `stile.js`, in `ctx.S`)
`h1`, `h2`, `h3`, `p("testo con `codice` e **grassetto** e *corsivo*")`, `punto(t, livello)`,
`...elencoNumerato([voci])` (ricordati lo spread `...`), `...codice(testo, titolo)`, `tabella(intestazione, righe,
larghezze)` + `dopoTabella()`, `...riquadro(titolo, [paragrafi])` (solo per note brevi, non per domande),
`...figura(file, pxW, pxH, didascalia)`. In `ctx`: `leggiJson(percorsoRelativoADefinitivo)`, `DEF`, `DIAGRAMMI`.
Titoli: `h1` per i capitoli ("3. Come comunicano i componenti"), `h2` per i paragrafi numerati ("3.2 Login e
chiamate all'API"), `h3` per le sottosezioni non numerate.

## Figure (`relazione/diagrammi/`, px)
spa.png 1311x1756 · api.png 2750x942 · database.png 3216x1163 · file.png 2116x2275 · notifiche.png 4232x2327 ·
account.png 3237x1598 · osservabilita.png 3767x2571 · rete.png 3238x1704 · completo:
`path.join(DEF, "diagrammi/real-estate-v3.png")` 4232x3676. Numerazione per capitolo: Figura 2.1, Figura 3.1 … 3.7,
Figura 4.1.

## Confini
- Scrivi SOLO i file `capitoli/*.js` assegnati. Non toccare `stile.js`, `genera.js`, `conta.js`, `capitoli/_v1/`,
  gli altri capitoli, `definitivo/`, `diagrammi/`.
- Niente commit, niente push, mai `git stash`.
- Prova: `node genera.js --solo <tuoi-file> --out /private/tmp/claude-501/-Users-m-charrier-opt-akari/86bdfd14-4757-4c31-8748-13984c8634c1/scratchpad/<nome>.docx`
  senza errori; testo con `unzip -p <file> word/document.xml | sed -e 's/<[^>]*>/ /g' | tr -s ' '`: niente `**`,
  backtick, "Spring", "All'orale".

## Rapporto finale (massimo 12 righe)
File scritti con le parole di ciascuno (output di `conta.js`); cosa hai tolto rispetto alla v1; scelte da rivedere.
