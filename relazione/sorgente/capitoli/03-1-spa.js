// 3.1 Scaricare l'applicazione
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, codice, tabella, dopoTabella, figura, elencoNumerato } = S;
  return [
  h2("3.1 Scaricare l'applicazione"),
  p("Prima di fare login o chiamare l'API il browser deve ricevere la SPA, un insieme di file statici. Il problema è servirli in HTTPS e vicino all'utente senza aprire il bucket a Internet. La soluzione: i file stanno in un **bucket S3 privato** e l'unica porta d'ingresso è una distribuzione **CloudFront**, che legge il bucket con **Origin Access Control** (OAC)."),
  ...figura(path.join(DIAGRAMMI, "spa.png"), 1311, 1756,
    "Figura 3.1 — Il download della SPA. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso"),
  ...elencoNumerato([
    "Il browser chiede il sito in HTTPS alla distribuzione; una richiesta HTTP viene reindirizzata.",
    "Se l'edge non ha il file in cache, lo chiede al bucket `real-estate-prod-website-<SUFFIX>` firmando la richiesta con OAC.",
    "S3 valuta la bucket policy e ammette la lettura solo dalla nostra distribuzione.",
    "Un percorso della SPA che non è un file fa rispondere S3 con 403: CloudFront restituisce `/index.html` e il routing lo fa il browser.",
    "A ogni risposta CloudFront aggiunge gli header di sicurezza.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["Browser → distribuzione del sito", "HTTPS", "nessuno: il sito è pubblico"],
      ["Distribuzione → bucket del sito", "`GetObject` firmato con OAC", "bucket policy, con `AWS:SourceArn` = la distribuzione"],
      ["Distribuzione → browser", "risposta con header di sicurezza", "response headers policy `real-estate-prod-site-security-headers`"],
    ],
    [3000, 3000, 3600],
  ),
  dopoTabella(),

  h3("L'autorizzazione chiave"),
  p("CloudFront **non ha un ruolo IAM**: si presenta come servizio e il permesso sta nella **resource policy del bucket**."),
  ...codice(leggiJson("iam/resource-policies/s3-website-bucket-policy.json"), "iam/resource-policies/s3-website-bucket-policy.json"),
  p("Il primo statement concede solo `s3:GetObject`. La condizione `AWS:SourceArn` lo lega alla **nostra** distribuzione: senza, il principal `cloudfront.amazonaws.com` vorrebbe dire qualunque distribuzione di qualunque account (il *confused deputy*, vedi 4.1). Il secondo statement nega le richieste senza TLS. Sul bucket sono attivi anche **Block Public Access** e le ACL disattivate, così un errore futuro in una policy non lo renderebbe pubblico."),
  p("Gli header aggiunti da CloudFront difendono i token che la SPA tiene in memoria: la **Content-Security-Policy** ammette solo i nostri script e le chiamate verso API, Cognito e il bucket degli upload. Gli altri header impongono HTTPS (`Strict-Transport-Security`), vietano di incorniciare la pagina (`X-Frame-Options: DENY`) e di indovinare il tipo dei file (`nosniff`)."),

  h3("Quando qualcosa va storto"),
  p("Un file inesistente dà 403 e non 404, perché CloudFront non ha `s3:ListBucket`; per la SPA va bene, ma per i file degli annunci un file mancante deve restare un errore, ed è il motivo per cui le distribuzioni sono due (3.4). Dopo un deploy si invalida la cache, altrimenti gli edge servono la versione vecchia fino alla scadenza. Un dominio della CSP dimenticato blocca una funzione: va provata con la SPA vera."),

  h3("Le scelte"),
  p("Bucket privato con OAC invece di un bucket pubblico con *static website hosting*, che darebbe solo HTTP e nessuna cache. Una CSP nostra, perché la policy gestita da AWS non la include. Nessuna logica sull'edge: il sito è statico e i dati protetti stanno dietro l'API (5.1)."),
  ];
};
