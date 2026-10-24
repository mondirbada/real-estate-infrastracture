// Appendice B — Configurazioni: il testo integrale di ogni JSON in definitivo/config/, una riga ciascuno.
// I file di config/ non elencati qui si aggiungono in fondo da soli.
const fs = require("fs");
const path = require("path");

module.exports = ({ S, leggiJson, DEF }) => {
  const { p, h1, h3, codice } = S;
  // file -> [a cosa serve, dove se ne parla]
  const voci = [
    ["cognito-user-pool.json", "Il pool degli utenti: email come attributo di accesso, verificata.", "3.2, 3.6"],
    ["cognito-app-client.json", "L'app client della SPA: authorization code con PKCE, scope, callback, durata dei token.", "3.2, 3.6"],
    ["http-api-cors.json", "CORS dell'HTTP API: solo l'origine del sito.", "3.2"],
    ["presigned-post-conditions.json", "Chiave, scadenza e condizioni del presigned POST.", "3.4"],
    ["s3-files-cors.json", "CORS del bucket dei file per il `POST` dell'upload.", "3.4"],
    ["s3-files-notification.json", "Notifica `ObjectCreated` su `uploads/` verso la Files Lambda.", "3.4"],
    ["sns-subscription-attributes.json", "Sottoscrizione della coda al topic, con `RawMessageDelivery`.", "3.5"],
    ["sqs-notifications-queue-attributes.json", "Coda delle notifiche: timeout, retention, cifratura, `RedrivePolicy`.", "3.5"],
    ["sqs-notifications-dlq-attributes.json", "Dead-letter queue: retention di 14 giorni, cifratura, `RedriveAllowPolicy`.", "3.5"],
    ["lambda-mailer-event-source-mapping.json", "Lettura della coda per la Mailer: batch, `ReportBatchItemFailures`, concorrenza.", "3.5"],
    ["cloudwatch-alarm-notifications-dlq.json", "Allarme sulla DLQ verso il topic degli allarmi.", "3.5, 3.7"],
    ["cloudwatch-metric-filter-mailer-permanent-failures.json", "Metric filter sugli errori permanenti della Mailer.", "3.7"],
  ];
  // I JSON di config/ non elencati si aggiungono in fondo, senza descrizione.
  const presenti = fs.readdirSync(path.join(DEF, "config")).filter(f => f.endsWith(".json")).sort();
  for (const f of presenti) if (!voci.some(v => v[0] === f)) voci.push([f, null, null]);

  const out = [
    h1("Appendice B — Configurazioni"),
    p("Il testo integrale di ogni file in `definitivo/config/`: le configurazioni che non sono policy IAM (quelle sono nell'Appendice A), con segnaposto `<...>` al posto di account e ID reali."),
  ];
  for (const [file, uso, dove] of voci) {
    out.push(h3(file));
    if (uso) out.push(p(`${uso} Vedi ${dove}.`));
    out.push(...codice(leggiJson("config/" + file), "config/" + file));
  }
  return out;
};
