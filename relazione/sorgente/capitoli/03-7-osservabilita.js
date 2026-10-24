// 3.7 Log, metriche e allarmi
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, codice, tabella, dopoTabella, figura, elencoNumerato } = S;
  return [
  h2("3.7 Log, metriche e allarmi"),
  p("Con soli servizi gestiti non c'è un server su cui collegarsi a guardare cosa succede: l'osservabilità va progettata. Usiamo **CloudWatch** per raccogliere i log delle Lambda e dell'HTTP API, leggere le metriche che i servizi pubblicano da soli e far scattare pochi **allarmi**, che pubblicano sul topic SNS `real-estate-prod-ops-alerts`, iscritto all'email del team. È un topic separato da quello delle notifiche agli utenti: altro pubblico, altro pubblicatore."),
  ...figura(path.join(DIAGRAMMI, "osservabilita.png"), 3767, 2571,
    "Figura 3.7 — Log, metriche e allarmi. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso"),
  ...elencoNumerato([
    "Ogni Lambda scrive nel log group `/aws/lambda/<nome-funzione>`; lo stage dell'HTTP API scrive il suo access log.",
    "I servizi pubblicano le loro metriche: errori delle Lambda, CPU e connessioni di Aurora, età dei messaggi nelle code.",
    "Per ciò che esiste solo nei log, un **metric filter** trasforma le righe che corrispondono a un pattern in una metrica.",
    "Un allarme che supera la soglia pubblica sul topic, che consegna l'email al team.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["Lambda → CloudWatch Logs", "lo invia il servizio Lambda, non la rete della funzione", "policy gestita `AWSLambdaBasicExecutionRole`"],
      ["HTTP API → CloudWatch Logs", "access log dello stage", "nessun ruolo: basta indicare il log group"],
      ["Allarme → topic ops", "azione dell'allarme", "nessuna topic policy: stesso account, nessuna chiave KMS del cliente"],
      ["Operatore → log della Mailer", "`logs:FilterLogEvents`", "policy `ops-dlq-redrive`, sul solo log group della Mailer"],
    ],
    [2800, 3200, 3600],
  ),
  dopoTabella(),

  h3("Le autorizzazioni chiave"),
  p("Le Lambda nella VPC non hanno Internet, eppure scrivono i log senza un endpoint: li raccoglie il servizio Lambda. Il permesso di scrittura sta in una delle due policy gestite che usiamo; per i log la sua `Resource: \"*\"` è accettabile, mentre per gli altri servizi ogni ruolo ha una policy nostra sull'ARN preciso (4.1). L'allarme non ha un ruolo: con un topic nello stesso account e non cifrato con una nostra chiave KMS, la procedura standard funziona senza topic policy."),
  p("Un errore **permanente** della Mailer non viene ritentato e non arriva mai nella dead-letter queue: senza un controllo, l'email andrebbe persa in silenzio. La Mailer scrive log in JSON, senza indirizzi email, e un metric filter conta le righe di errore permanente:"),
  ...codice(leggiJson("config/cloudwatch-metric-filter-mailer-permanent-failures.json"), "config/cloudwatch-metric-filter-mailer-permanent-failures.json"),

  h3("Gli allarmi"),
  tabella(
    ["Allarme", "Cosa significa"],
    [
      ["Messaggi nella DLQ", "un'email non è partita dopo i tentativi (3.5)"],
      ["Messaggi vecchi in coda", "la Mailer è ferma; lo si vede prima della DLQ"],
      ["Errori permanenti della Mailer", "email scartate senza ritentare"],
      ["Errori delle Lambda", "una funzione sta fallendo"],
      ["CPU e connessioni di Aurora", "il database è sotto pressione (soglie da fissare)"],
      ["Pulizia dei file non riuscita", "cancellato un immobile, dei file sono rimasti su S3 (3.4)"],
    ],
    [3600, 6000],
  ),
  dopoTabella(),

  h3("Quando qualcosa va storto"),
  p("Se nessuno conferma la sottoscrizione email, gli allarmi non arrivano: è la prima cosa da verificare. Le soglie di Aurora sono ancora da fissare. Gli allarmi coprono il backend, non l'esperienza nel browser."),

  h3("Le scelte"),
  p("Pochi allarmi, ciascuno legato a un'azione umana, verso un solo topic separato. Nessun endpoint VPC per i log, che costerebbe senza servire."),
  ];
};
