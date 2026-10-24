// 4.1 Scaricare l'applicazione
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, codice, riquadro, tabella, dopoTabella, figura, elencoNumerato } = S;
  return [
  h2("4.1 Scaricare l'applicazione"),
  p("È il flusso più semplice, ed è il primo perché apre tutti gli altri: prima di fare login o chiamare l'API, il browser deve ricevere la SPA. L'applicazione è un insieme di file statici (HTML, JavaScript, CSS) che stanno in un **bucket S3 privato**; davanti al bucket c'è una distribuzione **CloudFront**, che è l'unica porta d'ingresso. Nessun server esegue codice: il browser scarica i file e la logica di presentazione gira lì."),
  p("Il bucket è privato per scelta. Un bucket pubblico con lo *static website hosting* sarebbe stato più rapido da configurare, ma darebbe solo HTTP, nessuna cache vicino all'utente e un'altra porta aperta da sorvegliare. Con CloudFront il bucket non ha alcun accesso diretto da Internet, il traffico è HTTPS e i file sono serviti dalla *edge location* più vicina. È come mettere Nginx davanti a una cartella di file statici, invece di esporre la cartella."),
  ...figura(path.join(DIAGRAMMI, "spa.png"), 1311, 1756,
    "Figura 4.1 — Il download della SPA nel diagramma v3. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  ...elencoNumerato([
    "Il browser chiede il sito in HTTPS alla distribuzione CloudFront del sito. Una richiesta HTTP viene reindirizzata su HTTPS.",
    "Se l'edge ha il file in cache (*cache hit*) risponde subito. Altrimenti (*cache miss*) lo chiede al bucket `real-estate-prod-website-<SUFFIX>`, firmando la richiesta con **Origin Access Control** (OAC).",
    "S3 valuta la **bucket policy**: ammette `s3:GetObject` solo se la richiesta arriva dalla nostra distribuzione.",
    "Un percorso della SPA che non è un file (per esempio `/properties/42`) fa rispondere S3 con 403: CloudFront lo sostituisce con `/index.html` e codice 200, e il routing lo fa React nel browser.",
    "A ogni risposta CloudFront aggiunge gli **header di sicurezza**, tra cui la Content-Security-Policy.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "Browser → distribuzione del sito", "HTTPS (HTTP reindirizzato)", "Internet", "nessuno: il sito è pubblico"],
      ["2", "Distribuzione → bucket del sito", "`GetObject` firmato con OAC (SigV4)", "rete interna di AWS", "bucket policy del sito, con `AWS:SourceArn` = la distribuzione"],
      ["3", "Distribuzione → browser", "risposta con header di sicurezza", "Internet", "response headers policy `real-estate-prod-site-security-headers`"],
      ["4", "Deploy → bucket del sito", "upload dei file e invalidazione della cache", "console o CLI", "permessi dell'identità di deploy"],
    ],
    [400, 2300, 2600, 1800, 3200],
  ),
  dopoTabella(),

  h3("Le autorizzazioni"),
  p("CloudFront **non ha un ruolo IAM**. Per leggere il bucket si presenta come servizio (`cloudfront.amazonaws.com`) e firma le richieste con OAC, che ha sostituito il vecchio OAI. Il permesso non sta quindi in un'identity policy ma nella **resource policy del bucket**:"),
  ...codice(leggiJson("iam/resource-policies/s3-website-bucket-policy.json"), "iam/resource-policies/s3-website-bucket-policy.json"),
  p("Il primo statement dà il permesso di lettura, e solo di lettura: `s3:GetObject` sugli oggetti del bucket. La condizione `AWS:SourceArn` lega il permesso alla **nostra** distribuzione. Senza di essa, il principal `cloudfront.amazonaws.com` vorrebbe dire *qualunque* distribuzione, di qualunque account: chi conoscesse il nome del bucket potrebbe crearne una e leggere il nostro sito. È il **confused deputy** descritto nel paragrafo 3.1."),
  p("Il secondo statement è un **Deny** esplicito delle richieste senza TLS (`aws:SecureTransport` = `false`). CloudFront parla già in HTTPS, ma il Deny garantisce che nessun altro cammino possa leggere il bucket in chiaro. In IAM un Deny vince sempre su un Allow."),
  p("Oltre alla policy, sul bucket sono attivi **Block Public Access** e le ACL disattivate (*bucket owner enforced*): anche un errore futuro in una policy non renderebbe il bucket pubblico. La scrittura nel bucket spetta solo a chi fa il deploy, con i permessi della sua identità; dopo ogni deploy si carica la nuova versione e si invalida la cache (`/*`), altrimenti gli edge servono la vecchia fino alla scadenza del TTL."),

  h3("Gli header di sicurezza"),
  p("La SPA tiene i token dell'utente in memoria, non in `localStorage`. Se uno script malevolo riuscisse a girare nella pagina (XSS) potrebbe leggerli. Una *response headers policy* nostra, collegata alla distribuzione, aggiunge a ogni risposta gli header che riducono questo rischio. Serve una policy personalizzata e non quella gestita da AWS (`SecurityHeadersPolicy`) perché quest'ultima non contiene la **Content-Security-Policy** (CSP), che dipende dai domini del progetto."),
  tabella(
    ["Header", "Valore", "A cosa serve"],
    [
      ["`Content-Security-Policy`", "`default-src 'self'`; `script-src 'self'`; `style-src 'self'`; `img-src 'self'` e il dominio dei file; `media-src` il dominio dei file; `connect-src 'self'`, l'API, Cognito, il dominio del login gestito e il bucket dei file; `object-src 'none'`; `base-uri 'self'`; `frame-ancestors 'none'`", "gli script vengono solo dal nostro sito (niente script inline o di terzi) e la pagina può fare richieste solo verso API, Cognito e bucket degli upload"],
      ["`Strict-Transport-Security`", "`max-age=31536000`", "il browser usa solo HTTPS per il sito"],
      ["`X-Content-Type-Options`", "`nosniff`", "il browser non indovina il tipo dei file"],
      ["`X-Frame-Options`", "`DENY`", "la pagina non si può incorniciare in un altro sito (clickjacking)"],
      ["`Referrer-Policy`", "`strict-origin-when-cross-origin`", "verso altri siti si manda solo l'origine, non il percorso"],
    ],
    [2400, 4200, 3000],
  ),
  dopoTabella(),
  p("I domini esatti della CSP (`<FILES_DOMAIN>`, `<API_ID>`, `<COGNITO_DOMAIN>`) sono segnaposto da riempire alla creazione. La policy va provata con la SPA vera: un dominio dimenticato blocca una funzione, e il browser lo segnala in console. È uno dei punti aperti del capitolo 5."),

  h3("Quando qualcosa va storto"),
  p("Un file che non esiste dà 403 e non 404, perché CloudFront non ha `s3:ListBucket` e S3 non rivela se un oggetto esiste. Per una SPA va bene: entrambi i codici diventano `/index.html`. Nella distribuzione dei file, dove un file mancante deve restare un errore, questa regola non c'è: è il motivo per cui le distribuzioni sono due (sezione 4.4). Se la cache serve una versione vecchia dopo un deploy, basta invalidarla. Per il sito usiamo il dominio `*.cloudfront.net`: un dominio personalizzato richiederebbe un certificato ACM creato in `us-east-1`, non a Milano."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["Bucket privato con OAC", "nessun accesso diretto, HTTPS e cache; il permesso sta in una policy con `AWS:SourceArn`", "bucket pubblico con static website hosting: solo HTTP, niente cache, superficie d'attacco maggiore"],
      ["403 e 404 → `/index.html`", "il routing della SPA lo fa React; il 403 perché manca `s3:ListBucket`", "pagina di errore del bucket: ogni link diretto darebbe errore"],
      ["Distribuzione del sito separata da quella dei file", "la regola SPA vale per tutta la distribuzione e non deve toccare i file", "una sola distribuzione con un behavior `/files/*`"],
      ["CSP da una response headers policy", "limita script e destinazioni delle richieste: difesa contro il furto dei token via XSS", "policy gestita `SecurityHeadersPolicy`: non include la CSP"],
      ["Nessuna Lambda@Edge o CloudFront Functions", "il sito è statico e pubblico, i dati protetti stanno dietro l'API", "logica sull'edge: complessità senza vantaggio"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Perché CloudFront e non un bucket pubblico?** HTTPS, cache vicino all'utente, bucket privato leggibile solo dalla nostra distribuzione, possibilità di aggiungere WAF.",
    "**Cos'è OAC e dove sta il permesso?** CloudFront firma le richieste come servizio `cloudfront.amazonaws.com`; il permesso sta nella bucket policy, con `AWS:SourceArn` della nostra distribuzione. CloudFront non ha ruoli.",
    "**A cosa serve `AWS:SourceArn`?** A impedire che la distribuzione di un altro account legga il nostro bucket (confused deputy).",
    "**CloudFront autentica gli utenti?** No. Serve solo file; il login lo fa la SPA con Cognito e i dati protetti stanno dietro l'API.",
  ]),
  ];
};
