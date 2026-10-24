// 4.5 Le notifiche email — capitolo modello: tono, struttura e livello di dettaglio da seguire negli altri flussi.
const path = require("path");
const { Paragraph, AlignmentType } = require("docx");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;
  const eventoJson = `{
  "eventId": "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  "type": "OFFER_CREATED",
  "recipientSub": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
  "occurredAt": "2026-10-22T10:15:00Z",
  "data": {
    "propertyId": "1042",
    "propertyTitle": "Trilocale in centro",
    "offerId": "5531",
    "amount": 250000
  }
}`;

  return [
  h2("4.5 Le notifiche email"),
  p("Quando succede qualcosa che un utente deve sapere — un acquirente fa un'offerta su un immobile, l'offerta viene accettata o rifiutata, un nuovo utente si registra — il sistema gli manda un'email. L'invio però **non avviene dentro la richiesta** che ha causato l'evento: la Lambda che registra l'offerta pubblica un evento e risponde subito all'utente; l'email parte dopo, da un'altra funzione, attraverso una catena asincrona SNS → SQS → Mailer Lambda → SES."),
  p("Il motivo è lo stesso per cui in un'applicazione Spring Boot non si chiama un server SMTP dentro una transazione: se il servizio di posta è lento o non risponde, l'utente non deve aspettare né vedere un errore, e l'email non deve andare persa. La coda fa da cuscinetto e permette di ritentare; la dead-letter queue raccoglie ciò che non è riuscito nemmeno dopo i tentativi."),
  ...figura(path.join(DIAGRAMMI, "notifiche.png"), 4232, 2330,
    "Figura 4.5 — Il flusso delle notifiche nel diagramma v3. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  ...elencoNumerato([
    "Una Lambda di business (Property, Users o Offers) pubblica un evento sul topic SNS `real-estate-prod-notifications`. È dentro la VPC, che non ha accesso a Internet: raggiunge SNS attraverso un **interface endpoint**.",
    "SNS consegna l'evento alla coda SQS `real-estate-prod-notifications-queue`, sua unica sottoscrittrice.",
    "Il servizio Lambda legge la coda a gruppi di 10 messaggi (**event source mapping**) e invoca la Mailer Lambda, al massimo due invocazioni alla volta.",
    "Per ogni messaggio la Mailer chiede a **Cognito** l'indirizzo email del destinatario e lo invia con **SES**.",
    "Se un invio fallisce per un errore temporaneo, il messaggio torna in coda e viene ritentato; dopo 5 tentativi SQS lo sposta nella **dead-letter queue** e un allarme avvisa il team.",
  ]),

  h3("Chi parla con chi"),
  p("La tabella mette in fila ogni passaggio con tre informazioni: come avviene, su quale rete viaggia e chi lo autorizza. È il modo più rapido per vedere che ogni freccia del diagramma ha **un controllo di rete e un controllo IAM**, e che dove manca uno dei due c'è un motivo."),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "Offers Lambda → endpoint SNS", "`sns:Publish` via HTTPS (443)", "subnet privata → ENI dell'endpoint; `sg-endpoint-sns` ammette 443 solo da `sg-lambda-internal`", "identity policy del ruolo `lambda-offers-role` + endpoint policy"],
      ["2", "SNS → coda SQS", "consegna della sottoscrizione", "rete interna di AWS", "queue policy della coda, con `aws:SourceArn` = il nostro topic"],
      ["3", "Coda → Mailer Lambda", "event source mapping: il servizio Lambda legge la coda e invoca la funzione", "rete interna di AWS (la Mailer è fuori dalla VPC)", "execution role della Mailer: `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`"],
      ["4", "Mailer → Cognito", "`AdminGetUser` con il `sub` del destinatario", "endpoint pubblico regionale di Cognito", "execution role della Mailer: `cognito-idp:AdminGetUser` sul solo user pool"],
      ["5", "Mailer → SES", "`SendEmail`", "endpoint pubblico regionale di SES", "execution role della Mailer: `ses:SendEmail` solo dal mittente `<MAIL_FROM>`"],
      ["6", "Coda → DLQ", "redrive policy, dopo 5 ricezioni", "interno a SQS", "nessun permesso IAM: `RedrivePolicy` sulla coda, `RedriveAllowPolicy` sulla DLQ"],
      ["7", "Allarme → topic ops → team", "azione dell'allarme CloudWatch", "interno ad AWS", "stesso account: nessuna topic policy aggiuntiva"],
      ["8", "Operatore → DLQ → coda", "redrive manuale (`StartMessageMoveTask`)", "console o CLI", "policy dell'operatore `ops-dlq-redrive`"],
    ],
    [400, 2000, 2300, 2700, 2700],
  ),
  dopoTabella(),

  h3("Il contenuto dell'evento"),
  p("L'evento contiene **chi** avvisare e **cosa** scrivergli, ma non l'indirizzo email. Il destinatario è indicato dal suo `sub`, l'identificativo che Cognito assegna a ogni utente alla registrazione e che non cambia mai. La Lambda che pubblica lo prende dal database (per una nuova offerta è il proprietario dell'immobile) o dai claim del token già verificato, mai dal corpo della richiesta, che il client potrebbe falsificare."),
  ...codice(eventoJson, "evento pubblicato sul topic (esempio)"),
  p("Tenere l'email fuori dall'evento ha tre conseguenze utili. Nessun messaggio che finisce in coda, nella DLQ o in un log espone l'indirizzo di qualcuno. L'email resta **in un solo posto**, Cognito: se l'utente la cambia, la notifica successiva va già al nuovo indirizzo. E il database applicativo non conserva un dato personale che non gli serve, come chiede il principio di minimizzazione del GDPR."),

  h3("Le autorizzazioni, passaggio per passaggio"),
  p("Nello stesso account basta un `Allow` da una delle due parti (paragrafo 3.1): quando chi chiama è un nostro ruolo il permesso sta nella sua identity policy, quando chi chiama è un servizio AWS sta nella resource policy della risorsa. In questo flusso si vedono tutti e due i casi, più un filtro in più sulla rete, l'endpoint policy."),

  p("**Ogni Lambda indossa un ruolo.** Le Lambda non hanno credenziali proprie: il servizio Lambda assume il loro *execution role*, grazie alla trust verso `lambda.amazonaws.com` vista nel paragrafo 3.1, e passa al codice credenziali temporanee."),

  new Paragraph({ children: S.runs("**Passo 1 — pubblicare.** Il ruolo della Offers Lambda può pubblicare solo sul nostro topic:"), spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED }),
  ...codice(`{
  "Sid": "PublishNotifications",
  "Effect": "Allow",
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications"
}`, "iam/policies/lambda-offers.json (estratto)"),
  p("La richiesta però esce da una subnet senza Internet, quindi deve passare dall'interface endpoint di SNS. Lì ci sono altri due controlli. Il security group `sg-endpoint-sns` accetta traffico sulla porta 443 solo dal security group delle Lambda. L'**endpoint policy** decide cosa può transitare dall'endpoint: solo pubblicazioni sul nostro topic, solo da principal del nostro account. Anche una Lambda con permessi più larghi, o compromessa, non potrebbe usare l'endpoint per mandare dati verso un topic di un altro account."),
  ...codice(leggiJson("iam/resource-policies/vpc-endpoint-sns-policy.json"), "iam/resource-policies/vpc-endpoint-sns-policy.json"),

  new Paragraph({ children: S.runs("**Passo 2 — entrare nella coda.** Qui chi chiama è il servizio SNS, non un nostro ruolo: il permesso non può stare in una identity policy, sta nella **queue policy** della coda."), spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED }),
  ...codice(leggiJson("iam/resource-policies/sqs-notifications-queue-policy.json"), "iam/resource-policies/sqs-notifications-queue-policy.json"),
  p("La condizione `aws:SourceArn` è essenziale: senza, qualunque topic SNS, anche di un altro account, potrebbe scrivere nella nostra coda. È il **confused deputy** del paragrafo 3.1, e la condizione lo chiude legando il permesso al nostro topic."),

  new Paragraph({ children: S.runs("**Passi 3, 4 e 5 — leggere, cercare l'indirizzo, spedire.** Tutto ciò che fa la Mailer è nel suo ruolo:"), spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED }),
  ...codice(leggiJson("iam/policies/lambda-mailer.json"), "iam/policies/lambda-mailer.json"),
  punto("`ConsumeNotificationQueue`: a leggere la coda non è il codice della Mailer ma il servizio Lambda, con l'event source mapping. Lo fa **con il ruolo della funzione**, per questo i permessi su SQS stanno qui e la Mailer non ha bisogno di una resource policy. È l'equivalente di un `@RabbitListener` gestito dal framework."),
  punto("`ReadRecipientEmailFromUserPool`: `AdminGetUser` su un solo user pool. È un'operazione *admin* di Cognito, autorizzata con IAM e non con il token dell'utente."),
  punto("`SendEmailFromProjectAddressOnly`: la condizione `ses:FromAddress` impedisce di inviare da un mittente diverso da quello del progetto."),
  p("La Mailer sta **fuori dalla VPC**: non usa il database, e così raggiunge Cognito e SES sui loro endpoint pubblici senza bisogno di endpoint privati. Se fosse compromessa potrebbe leggere quella coda, leggere gli utenti del pool e inviare email da un solo mittente: nient'altro."),

  h3("Quando qualcosa va storto: la dead-letter queue"),
  p("La coda è di tipo standard: garantisce che ogni messaggio venga consegnato **almeno una volta**, non esattamente una. Quando la Mailer riceve un messaggio, questo diventa invisibile per il *visibility timeout* (180 secondi). Se la Mailer lo elabora con successo, l'event source mapping lo cancella; altrimenti allo scadere dei 180 secondi torna visibile e viene ricevuto di nuovo. SQS conta le ricezioni: alla quinta senza cancellazione (`maxReceiveCount` = 5) sposta il messaggio nella DLQ `real-estate-prod-notifications-dlq`."),
  tabella(
    ["Tentativo", "Momento (circa)", "Cosa succede"],
    [
      ["1", "0 s", "ricezione, errore temporaneo, il messaggio resta invisibile 180 s"],
      ["2", "3 min", "seconda ricezione, nuovo errore"],
      ["3", "6 min", "terza ricezione"],
      ["4", "9 min", "quarta ricezione"],
      ["5", "12 min", "quinta ricezione: se fallisce ancora, allo scadere del timeout SQS sposta il messaggio nella DLQ"],
      ["—", "≈ 15 min", "messaggio nella DLQ, l'allarme scatta entro il periodo successivo"],
    ],
    [1200, 1800, 6600],
  ),
  dopoTabella(),
  p("I due numeri sono legati. I 180 secondi sono sei volte il timeout della Mailer (30 secondi), come raccomanda AWS: un messaggio non torna visibile mentre è ancora in lavorazione. I 5 tentativi sono il minimo raccomandato perché anche le invocazioni che Lambda rifiuta per troppa concorrenza contano come ricezioni: con un valore più basso un picco di traffico manderebbe nella DLQ messaggi perfettamente validi."),

  new Paragraph({ children: S.runs("**Batch parziali.** La Mailer riceve fino a 10 messaggi alla volta. Senza accorgimenti, un solo invio fallito farebbe ripetere l'intero gruppo: gli altri nove destinatari riceverebbero l'email due volte, e i loro messaggi si avvicinerebbero alla DLQ senza avere alcun problema. Per questo l'event source mapping è configurato con `ReportBatchItemFailures` e la Mailer restituisce **solo i messaggi da ritentare**:"), spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED }),
  ...codice(leggiJson("config/lambda-mailer-event-source-mapping.json"), "config/lambda-mailer-event-source-mapping.json"),
  ...codice(`{ "batchItemFailures": [ { "itemIdentifier": "<messageId>" } ] }`, "risposta della Mailer: solo i messaggi da ritentare"),
  p("`MaximumConcurrency` a 2 limita quante invocazioni della Mailer lavorano insieme. Protegge SES, che in sandbox accetta una email al secondo, e Cognito: se si supera comunque il limite, l'errore di throttling è trattato come temporaneo e il messaggio viene ritentato."),

  new Paragraph({ children: S.runs("**Non tutti gli errori meritano un nuovo tentativo.** La Mailer distingue due casi:"), spacing: { after: 80 } }),
  tabella(
    ["Tipo", "Esempi", "Cosa fa la Mailer", "Esito"],
    [
      ["Temporaneo", "throttling o errore 5xx di SES o Cognito, timeout di rete", "mette il messaggio in `batchItemFailures`", "ritentato; dopo 5 ricezioni va nella DLQ"],
      ["Permanente", "messaggio malformato, email non verificata, destinatario rifiutato da SES", "log a livello ERROR, il messaggio è considerato elaborato", "cancellato; un metric filter sui log fa scattare un allarme"],
      ["Previsto", "`UserNotFoundException`: l'utente ha cancellato l'account", "log a livello INFO", "cancellato senza allarme"],
    ],
    [1500, 3000, 2800, 2300],
  ),
  dopoTabella(),
  p("Ritentare un errore permanente non servirebbe a nulla: occuperebbe la coda per un quarto d'ora e finirebbe comunque nella DLQ, mescolandosi ai messaggi che valgono la pena di essere rimandati. Così la DLQ contiene solo ciò che è fallito per una causa **rimediabile**."),

  new Paragraph({ children: S.runs("**Perché la DLQ sta sulla coda e non sulla Lambda.** Lambda ha anche una sua DLQ e le *on-failure destination*, ma valgono per le invocazioni asincrone (per esempio quelle di S3). Con SQS come sorgente è la coda stessa a gestire i fallimenti, con la sua `RedrivePolicy`; le on-failure destination dell'event source mapping esistono solo per Kinesis, DynamoDB Streams e Kafka."), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED }),
  ...codice(leggiJson("config/sqs-notifications-queue-attributes.json"), "config/sqs-notifications-queue-attributes.json"),
  p("`RedrivePolicy` è una stringa che contiene a sua volta un JSON: è il formato che l'API di SQS si aspetta. Lo spostamento nella DLQ lo esegue SQS stesso, quindi **non serve alcun permesso IAM**. Sulla DLQ, la `RedriveAllowPolicy` stabilisce che solo la nostra coda può usarla come dead-letter queue."),

  new Paragraph({ children: S.runs("**Quanto resta un messaggio nella DLQ.** La scadenza di un messaggio si conta dal momento in cui è entrato nella **coda originale**, non nella DLQ. Per questo la DLQ ha la retention massima (14 giorni) e la coda principale 4: un messaggio arrivato in DLQ resta analizzabile per almeno una decina di giorni."), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED }),

  h3("L'allarme e cosa fa il team"),
  p("Un messaggio nella DLQ è un'email che non è partita: qualcuno deve saperlo. Un allarme CloudWatch controlla ogni 5 minuti il numero di messaggi visibili nella DLQ e, appena è maggiore di zero, pubblica sul topic SNS `real-estate-prod-ops-alerts`, a cui è iscritta l'email del team. Un secondo allarme guarda l'età del messaggio più vecchio nella coda principale: se supera i 15 minuti, la Mailer è ferma o troppo lenta, e lo si scopre prima che i messaggi arrivino nella DLQ."),
  ...codice(leggiJson("config/cloudwatch-alarm-notifications-dlq.json"), "config/cloudwatch-alarm-notifications-dlq.json"),
  p("Quando l'allarme scatta, la procedura è questa:"),
  ...elencoNumerato([
    "**Guardare i messaggi** nella DLQ, dalla console (*Poll for messages*) o con `aws sqs receive-message`, annotando `MessageId` e tipo di evento.",
    "**Trovare la causa** nei log della Mailer, cercando il `messageId`.",
    "**Correggere la causa**: per esempio una quota di SES, un servizio non disponibile, un errore nel modello dell'email.",
    "**Rimandare i messaggi** nella coda principale con il *redrive*: `aws sqs start-message-move-task`, o *Start DLQ redrive* in console, a una velocità bassa per non saturare SES. Ripartono come messaggi nuovi, con il contatore delle ricezioni a zero.",
    "Se un messaggio è da buttare, annotarlo e cancellarlo dalla DLQ prima del redrive.",
  ]),
  p("Chi esegue la procedura ha una policy dedicata, con i soli permessi necessari: leggere e cancellare messaggi della DLQ, avviare e controllare il redrive, scrivere nella coda principale (il redrive invia i messaggi con l'identità di chi lo avvia) e leggere i log della Mailer."),
  ...codice(leggiJson("iam/policies/ops-dlq-redrive.json"), "iam/policies/ops-dlq-redrive.json"),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["SNS davanti a SQS", "si possono aggiungere altri canali (SMS, push) senza toccare chi pubblica", "solo SQS: più semplice, ma ogni nuovo consumer richiede di cambiare le Lambda"],
      ["Mailer fuori dalla VPC", "non usa il database; raggiunge Cognito e SES senza endpoint, con meno cold start", "Mailer in VPC: servirebbero endpoint per SQS, SES e Cognito"],
      ["Email letta da Cognito al momento dell'invio", "un solo posto per l'email, sempre aggiornata; nessun dato personale negli eventi e nel database", "email nel database o nel token: duplicata e da tenere allineata"],
      ["Batch parziali e concorrenza 2", "niente email doppie per colpa di un altro messaggio; SES e Cognito protetti", "batch intero: duplicati e messaggi buoni spinti verso la DLQ"],
      ["DLQ con allarme e redrive manuale", "nessuna email persa in silenzio; si rimanda solo dopo aver capito la causa", "redrive automatico: ripeterebbe all'infinito un errore non risolto"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Perché l'email non la manda la Offers?** Perché la richiesta dell'utente non deve dipendere da SES: si pubblica un evento e si risponde subito; la coda ritenta se l'invio fallisce.",
    "**Chi sposta i messaggi nella DLQ?** SQS stesso, secondo la `RedrivePolicy`: nessun ruolo, nessun permesso.",
    "**Cosa succede a un'email che non parte?** Viene ritentata per circa 15 minuti; poi va nella DLQ, scatta l'allarme, il team trova la causa nei log e la rimanda con il redrive.",
    "**Perché la queue policy ha `aws:SourceArn`?** Senza, qualunque topic SNS, anche di un altro account, potrebbe scrivere nella nostra coda.",
  ]),
];
};
