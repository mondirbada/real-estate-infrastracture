// Appendice B — Configurazioni
const fs = require("fs");
const path = require("path");

module.exports = ({ S, leggiJson, DEF }) => {
  const { p, h1, h3, codice } = S;
  // file -> [a cosa serve, dove se ne parla]
  const voci = [
    ["cognito-user-pool.json", "Parametri di `CreateUserPool`: l'email come attributo di accesso e verificata, cambio email solo dopo la verifica. Va scelta alla creazione.", "4.2 (login) e 4.6 (account)"],
    ["cognito-app-client.json", "L'app client della SPA: authorization code con PKCE, scope, URL di callback e logout, durata dei token, revoca attiva.", "4.2 e 4.6"],
    ["http-api-cors.json", "CORS dell'HTTP API: ammette solo l'origine del sito, con gli header `Authorization` e `Content-Type`.", "4.2"],
    ["presigned-post-conditions.json", "Chiave dell'oggetto, scadenza e condizioni (tipo e dimensione) del presigned POST firmato dalla Presigned Lambda.", "4.4"],
    ["s3-files-cors.json", "CORS del bucket dei file: permette il `POST` dell'upload dall'origine del sito.", "4.4"],
    ["s3-files-notification.json", "Notifica `ObjectCreated` sul prefisso `uploads/` che invoca la Files Lambda.", "4.4"],
    ["sns-subscription-attributes.json", "Attributi della sottoscrizione della coda al topic: `RawMessageDelivery`, per ricevere il messaggio senza la busta di SNS.", "4.5"],
    ["sqs-notifications-queue-attributes.json", "Attributi della coda delle notifiche: visibility timeout, retention, cifratura, `RedrivePolicy` verso la DLQ.", "4.5"],
    ["sqs-notifications-dlq-attributes.json", "Attributi della dead-letter queue: retention di 14 giorni, cifratura, `RedriveAllowPolicy`.", "4.5"],
    ["lambda-mailer-event-source-mapping.json", "Come il servizio Lambda legge la coda per la Mailer: batch, `ReportBatchItemFailures`, concorrenza massima.", "4.5"],
    ["cloudwatch-alarm-notifications-dlq.json", "Allarme sulla DLQ: scatta con almeno un messaggio e pubblica sul topic degli allarmi.", "4.5 e 4.7"],
    ["cloudwatch-metric-filter-mailer-permanent-failures.json", "Metric filter che conta gli errori permanenti della Mailer nei log.", "4.7"],
  ];
  // Controllo: ogni JSON di config/ deve comparire nell'elenco.
  const presenti = fs.readdirSync(path.join(DEF, "config")).filter(f => f.endsWith(".json"));
  const mancanti = presenti.filter(f => !voci.some(v => v[0] === f));
  if (mancanti.length) throw new Error("Appendice B: file di config/ non elencati: " + mancanti.join(", "));

  const out = [
    h1("Appendice B — Configurazioni"),
    p("Il testo integrale di ogni file in `definitivo/config/`: le configurazioni che non sono policy IAM (quelle sono nell'appendice A). Sono parametri di chiamate alle API di AWS, come `CreateUserPool` o `PutMetricAlarm`, con segnaposto `<...>` al posto di account e ID reali. Sotto il nome di ogni file, a cosa serve e dove se ne parla."),
  ];
  for (const [file, uso, dove] of voci) {
    out.push(h3(file));
    out.push(p(`${uso} Se ne parla in: ${dove}.`));
    out.push(...codice(leggiJson("config/" + file), "config/" + file));
  }
  return out;
};
