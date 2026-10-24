// 4.7 Log, metriche e allarmi
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, codice, riquadro, tabella, dopoTabella, figura, elencoNumerato } = S;
  return [
  h2("4.7 Log, metriche e allarmi"),
  p("Un'architettura fatta di tanti servizi gestiti ha un problema: nessun server su cui collegarsi e guardare cosa succede. L'osservabilità deve essere progettata. Il progetto usa **CloudWatch** per tre cose: raccogliere i **log** di tutte le Lambda e dell'HTTP API, leggere le **metriche** che i servizi pubblicano da soli, e far scattare degli **allarmi** che avvisano il team per email. È l'equivalente di Actuator più un sistema di log centralizzato, ma senza niente da installare."),
  p("Il punto di integrazione interessante è l'ultimo anello. Un allarme non ha un ruolo IAM e non chiama nessuna API: pubblica su un topic SNS, `real-estate-prod-ops-alerts`, a cui è iscritta l'email del team. È un topic **separato** da quello delle notifiche agli utenti, perché ha un altro pubblico (il team) e un altro pubblicatore (CloudWatch, non le Lambda)."),
  ...figura(path.join(DIAGRAMMI, "osservabilita.png"), 3767, 2571,
    "Figura 4.7 — Log, metriche e allarmi nel diagramma v3. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  ...elencoNumerato([
    "Ogni Lambda scrive i suoi log nel log group `/aws/lambda/<nome-funzione>`, con il permesso che le dà la policy gestita `AWSLambdaBasicExecutionRole`. Lo stage dell'HTTP API scrive il suo access log in un log group indicato nella configurazione dello stage.",
    "I servizi pubblicano le loro **metriche** da soli: invocazioni, errori e durata delle Lambda; CPU e connessioni di Aurora; messaggi visibili ed età del messaggio più vecchio per le code SQS.",
    "Per ciò che esiste solo nei log, come un errore permanente della Mailer, un **metric filter** trasforma le righe che corrispondono a un pattern in una metrica.",
    "Un **allarme** confronta una metrica con una soglia. Quando la supera (e quando torna a posto, per l'allarme della DLQ) pubblica sul topic `real-estate-prod-ops-alerts`.",
    "SNS consegna l'avviso alla sottoscrizione email del team, che l'ha confermata una volta dal link ricevuto.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "Lambda → CloudWatch Logs", "`CreateLogGroup`, `CreateLogStream`, `PutLogEvents`", "gestita dal servizio Lambda, non dalla rete della funzione", "policy gestita `AWSLambdaBasicExecutionRole` nell'execution role"],
      ["2", "HTTP API → CloudWatch Logs", "access log dello stage", "interno ad AWS", "basta indicare il log group nello stage: nessun ruolo"],
      ["3", "Servizi → CloudWatch Metrics", "metriche automatiche", "interno ad AWS", "nessun permesso da configurare"],
      ["4", "Log group → metrica", "metric filter sul pattern degli errori permanenti della Mailer", "interno ad AWS", "configurazione del filtro, nessun ruolo"],
      ["5", "Allarme → topic ops", "azione dell'allarme (`AlarmActions`, `OKActions`)", "interno ad AWS", "stesso account e nessuna chiave KMS del cliente: nessuna topic policy"],
      ["6", "Topic ops → team", "email", "Internet (verso la casella)", "sottoscrizione confermata dal destinatario"],
      ["7", "Operatore → log della Mailer", "`logs:FilterLogEvents`", "console o CLI", "policy dell'operatore `ops-dlq-redrive`"],
    ],
    [400, 2100, 2600, 2300, 3200],
  ),
  dopoTabella(),

  h3("I log"),
  p("Le Lambda nella VPC non hanno accesso a Internet, eppure scrivono i log senza che serva un endpoint per CloudWatch Logs: a inviarli non è la rete della funzione ma il **servizio Lambda**, che raccoglie l'output standard dell'ambiente di esecuzione. Per questo il flusso dei log non compare tra le regole dei security group."),
  p("Il permesso di scrittura è l'unico pezzo di IAM davvero necessario, e sta nella policy gestita da AWS che ogni execution role include:"),
  punto("`logs:CreateLogGroup` crea il log group della funzione al primo avvio;"),
  punto("`logs:CreateLogStream` crea un flusso per ogni ambiente di esecuzione;"),
  punto("`logs:PutLogEvents` scrive le righe."),
  p("È una delle due policy gestite che usiamo (l'altra serve alle interfacce di rete): per i log la larghezza di `Resource: \"*\"` è accettabile, mentre per SQS, SNS, S3, SES e il database ogni ruolo ha una policy nostra sull'ARN preciso. Per l'HTTP API, a differenza delle REST API, non serve il ruolo CloudWatch a livello di account: basta indicare il log group nello stage."),
  p("La Mailer scrive i log in **JSON strutturato**, una riga per evento, con un campo `level` e un campo `code`. È ciò che permette al metric filter di riconoscere un errore senza interpretare testo libero, e a **Logs Insights** di fare query. Per un criterio di minimizzazione dei dati, nei log non compare mai l'indirizzo email: bastano `messageId`, `eventId` e il tipo di evento per ricostruire un caso."),

  h3("Le metriche e gli allarmi"),
  p("Gli allarmi del progetto sono pochi e rispondono a una domanda sola: *c'è qualcosa che nessuno sta guardando e che richiede una persona?* Tutti hanno come azione il topic `real-estate-prod-ops-alerts`."),
  tabella(
    ["Allarme", "Metrica", "Condizione", "Cosa significa"],
    [
      ["Messaggi nella DLQ", "`ApproximateNumberOfMessagesVisible` della DLQ", "massimo > 0, periodo 5 min, 1 datapoint", "un'email non è partita dopo 5 ricezioni (procedura nel 4.5)"],
      ["Messaggi vecchi in coda", "`ApproximateAgeOfOldestMessage` della coda", "> 900 s, periodo 5 min", "la Mailer è ferma o in throttling; lo si scopre prima della DLQ"],
      ["Errori permanenti della Mailer", "`MailerPermanentFailures`, dal metric filter", "somma > 0, periodo 5 min", "email scartate senza ritentare: non finiscono nella DLQ"],
      ["Errori delle Lambda", "`Errors` di ciascuna funzione", "> 0", "una funzione sta fallendo"],
      ["CPU di Aurora", "`CPUUtilization`", "soglia da fissare", "il database è sotto pressione"],
      ["Connessioni di Aurora", "connessioni al database", "soglia da fissare", "le connessioni al database sono troppe"],
      ["Pulizia dei file non riuscita", "metric filter su `FILES_CLEANUP_FAILED` nei log della Property Lambda", "> 0", "cancellato un immobile, ma dei file sono rimasti su S3"],
    ],
    [2100, 3100, 2200, 2800],
  ),
  dopoTabella(),
  p("L'allarme sulla DLQ è l'unico a mandare anche il ritorno allo stato `OK`: così il team sa quando la coda è stata svuotata. Gli altri avvisano solo quando scattano. Il suo file di configurazione e la procedura che ne segue sono nel 4.5; qui basta notare un dettaglio che vale per tutti: `TreatMissingData: notBreaching`, cioè una metrica senza dati (coda vuota e inattiva) non fa scattare nulla."),

  h3("Contare gli errori che stanno solo nei log"),
  p("Un errore **permanente** della Mailer (messaggio malformato, email non verificata, destinatario rifiutato da SES) non viene ritentato e non arriva mai nella DLQ: il messaggio è considerato elaborato e cancellato. Senza un controllo, l'email andrebbe persa in silenzio. Il metric filter chiude questa lacuna: conta le righe di log con `level = \"ERROR\"` e `code = \"MAIL_PERMANENT_FAILURE\"` e ne fa una metrica su cui c'è l'allarme."),
  ...codice(leggiJson("config/cloudwatch-metric-filter-mailer-permanent-failures.json"), "config/cloudwatch-metric-filter-mailer-permanent-failures.json"),
  p("Il filtro non conta il caso previsto di un utente che ha cancellato l'account (`UserNotFoundException`): quello è loggato a livello `INFO` con un altro codice, e non deve svegliare nessuno. `defaultValue: 0` fa sì che la metrica valga zero anche quando non ci sono righe corrispondenti."),

  h3("Il topic verso il team"),
  tabella(
    ["Voce", "Valore"],
    [
      ["Topic", "`real-estate-prod-ops-alerts`, standard"],
      ["Sottoscrizione", "protocollo email, l'indirizzo del team; va confermata dal link che SNS invia"],
      ["Cifratura", "nessuna chiave KMS del cliente"],
      ["Pubblicano", "gli allarmi CloudWatch del nostro account"],
    ],
    [2200, 7400],
  ),
  dopoTabella(),
  p("Perché non serve una topic policy: con un topic nello stesso account e senza chiave KMS del cliente, la procedura standard di AWS (creare il topic, sottoscriverlo, sceglierlo come azione dell'allarme) funziona così com'è. Se il topic fosse in un altro account, o cifrato con una chiave nostra, servirebbe una policy che ammetta `cloudwatch.amazonaws.com` con `aws:SourceArn` (solo i nostri allarmi) e `aws:SourceAccount`, di nuovo contro il confused deputy; e una key policy che ammetta CloudWatch."),
  p("L'ultimo permesso del flusso riguarda chi indaga. Quando scatta un allarme, l'operatore deve poter leggere i log della Mailer per trovare la causa. Quel permesso è uno degli statement della policy dell'operatore (l'intera policy è nel 4.5):"),
  ...codice(`{
  "Sid": "ReadMailerLogsToFindTheCause",
  "Effect": "Allow",
  "Action": "logs:FilterLogEvents",
  "Resource": "arn:aws:logs:eu-south-1:<ACCOUNT_ID>:log-group:/aws/lambda/real-estate-prod-mailer:*"
}`, "iam/policies/ops-dlq-redrive.json (estratto)"),
  p("Il permesso è limitato al solo log group della Mailer: chi gestisce la DLQ non può leggere i log delle altre funzioni."),

  h3("Quando qualcosa va storto"),
  punto("**L'allarme stesso non arriva.** L'email del team è una sottoscrizione SNS: se nessuno ha cliccato il link di conferma, l'avviso non parte. È la prima cosa da verificare alla creazione."),
  punto("**Soglie non fissate.** CPU e connessioni di Aurora hanno la soglia ancora da fissare: è un punto aperto, da chiudere alla creazione del cluster."),
  punto("**Log che crescono.** I log si pagano per ingestione e conservazione; con i volumi del progetto sono pochi centesimi. Una retention esplicita sui log group limiterebbe la crescita."),
  punto("**Cosa non si vede.** Gli allarmi coprono i guasti del backend; non misurano l'esperienza dell'utente nel browser, né la salute della CDN."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["Pochi allarmi, tutti verso un solo topic", "ogni allarme corrisponde a un'azione umana; un solo canale da sorvegliare", "molti allarmi su ogni metrica: rumore che si impara a ignorare"],
      ["Topic degli allarmi separato da quello delle notifiche", "altro pubblico (team) e altro pubblicatore (CloudWatch)", "riusare il topic delle notifiche: gli utenti e il team sullo stesso canale"],
      ["Metric filter sugli errori permanenti", "sono scartati senza ritentare e non passano dalla DLQ: solo i log li mostrano", "ignorarli: email perse in silenzio"],
      ["Log in JSON senza indirizzi email", "filtrabili a macchina; nessun dato personale nei log", "log di testo libero con l'email del destinatario"],
      ["Nessun endpoint VPC per CloudWatch Logs", "i log li invia il servizio Lambda, non la funzione", "endpoint `logs`: un costo orario per AZ senza vantaggio"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Come monitorate che il sistema funziona?** Log di tutte le Lambda e dell'API, allarmi su errori delle Lambda, DLQ non vuota, messaggi vecchi in coda, errori permanenti della Mailer, CPU e connessioni di Aurora. È l'equivalente di Actuator più log centralizzati.",
    "**Chi riceve gli allarmi?** Il team, per email: gli allarmi pubblicano sul topic `real-estate-prod-ops-alerts`, che ha una sottoscrizione email.",
    "**Serve una topic policy perché CloudWatch pubblichi?** Non con un topic dello stesso account senza chiave KMS del cliente. Se la scrivessimo, ammetteremmo `cloudwatch.amazonaws.com` con `aws:SourceArn` e `aws:SourceAccount`.",
    "**Una Lambda in VPC senza Internet come scrive i log?** Li invia il servizio Lambda, non la rete della funzione: nessun endpoint necessario.",
  ]),
  ];
};
