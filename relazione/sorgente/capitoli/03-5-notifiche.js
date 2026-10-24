// 3.5 Le notifiche email e la dead-letter queue — catena SNS → SQS → Mailer → SES, con il ciclo di vita del messaggio fino alla DLQ.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, tabella, dopoTabella, figura } = S;

  return [
  h2("3.5 Le notifiche email e la dead-letter queue"),
  p("Quando succede qualcosa che un utente deve sapere (un acquirente fa un'offerta, l'offerta viene accettata o rifiutata, un nuovo utente si registra) il sistema gli manda un'email. Se l'invio avvenisse dentro la richiesta, un servizio di posta lento o fermo farebbe aspettare l'utente e l'email andrebbe persa. Per questo l'invio è **asincrono**: la Lambda che registra l'offerta pubblica un evento e risponde subito; l'email parte dopo, lungo la catena SNS → SQS → Mailer Lambda → SES. La coda permette di ritentare; la **dead-letter queue** (DLQ) raccoglie ciò che fallisce anche dopo i tentativi, e un allarme avvisa il team."),
  ...figura(path.join(DIAGRAMMI, "notifiche.png"), 4232, 2327,
    "Figura 3.5 — Il flusso delle notifiche, dalla pubblicazione dell'evento alla DLQ e all'allarme. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso"),
  ...elencoNumerato([
    "Una Lambda di business (Property, Users o Offers) pubblica un evento sul topic SNS `real-estate-prod-notifications`. Dalla VPC, senza Internet, raggiunge SNS con un **interface endpoint**.",
    "SNS consegna l'evento alla coda SQS `real-estate-prod-notifications-queue`, sua unica sottoscrittrice.",
    "Il servizio Lambda legge la coda a gruppi di 10 messaggi e invoca la **Mailer Lambda**, al massimo due invocazioni alla volta.",
    "Per ogni messaggio la Mailer chiede a **Cognito** l'indirizzo del destinatario e invia l'email con **SES**.",
    "Se un invio fallisce per un errore temporaneo il messaggio viene ritentato; dopo 5 tentativi SQS lo sposta nella DLQ `real-estate-prod-notifications-dlq` e un allarme avvisa il team.",
  ]),
  p("L'evento indica il destinatario con il suo `sub`, l'identificativo Cognito che non cambia mai, e non contiene l'indirizzo email: la Mailer lo legge da Cognito al momento dell'invio. Così nessun messaggio in coda, nella DLQ o nei log espone un indirizzo, e se l'utente cambia email la notifica successiva va già a quello nuovo."),

  h3("Chi parla con chi"),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["Lambda di business → SNS", "`sns:Publish` via HTTPS, attraverso l'interface endpoint", "execution role della Lambda; endpoint policy; `sg-endpoint-sns` accetta 443 solo da `sg-lambda-internal`"],
      ["SNS → coda", "consegna della sottoscrizione", "queue policy, solo dal nostro topic"],
      ["Coda → Mailer", "event source mapping: il servizio Lambda legge e invoca", "execution role della Mailer"],
      ["Mailer → Cognito, SES", "`AdminGetUser`, `SendEmail` sugli endpoint pubblici (la Mailer è fuori dalla VPC)", "execution role della Mailer"],
      ["Coda → DLQ", "redrive policy, dopo 5 ricezioni", "nessun permesso IAM: lo fa SQS"],
      ["Allarme → topic ops → team", "azione dell'allarme CloudWatch, email", "stesso account, nessuna policy aggiuntiva"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),

  h3("Le autorizzazioni"),
  p("In questo flusso ci sono i due casi del 4.1: chi chiama è un servizio AWS, e il permesso sta nella resource policy; chi chiama è un nostro ruolo, e sta nella sua identity policy."),
  p("**Entrare nella coda.** A scrivere nella coda è il servizio SNS, non un nostro ruolo: il permesso sta nella **queue policy**."),
  ...codice(leggiJson("iam/resource-policies/sqs-notifications-queue-policy.json"), "iam/resource-policies/sqs-notifications-queue-policy.json"),
  p("Senza `aws:SourceArn` qualunque topic SNS, anche di un altro account, potrebbe scrivere nella nostra coda (il *confused deputy*, vedi 4.1). Il permesso di pubblicare sta invece nel ruolo di ciascuna Lambda di business, limitato al topic, e l'endpoint policy di SNS lascia passare solo quelle pubblicazioni (Appendice A)."),
  p("**Leggere, cercare l'indirizzo, spedire.** Tutto ciò che fa la Mailer è nel suo ruolo:"),
  ...codice(leggiJson("iam/policies/lambda-mailer.json"), "iam/policies/lambda-mailer.json"),
  punto("A leggere la coda non è il codice della Mailer ma il servizio Lambda, con l'event source mapping; lo fa **con il ruolo della funzione**, per questo i permessi su SQS stanno qui."),
  punto("`AdminGetUser` vale su un solo user pool ed è autorizzato con IAM, non con il token di un utente."),
  punto("La condizione `ses:FromAddress` impedisce di inviare da un mittente diverso da quello del progetto."),
  p("Una Mailer compromessa potrebbe leggere quella coda e gli utenti del pool e inviare email da un solo mittente: nient'altro."),

  h3("Quando qualcosa va storto: la dead-letter queue"),
  p("**Il ciclo di vita di un messaggio.** La coda è di tipo standard: ogni messaggio viene consegnato *almeno una volta*. Quando il servizio Lambda lo riceve per la Mailer, il messaggio diventa invisibile per il *visibility timeout*, 180 secondi. Se l'invio riesce, il messaggio viene cancellato dalla coda. Se fallisce, allo scadere dei 180 secondi torna visibile e viene ricevuto di nuovo. SQS conta le ricezioni: un messaggio già ricevuto 5 volte senza essere cancellato non viene consegnato una sesta, ma spostato nella DLQ. Con cinque tentativi a tre minuti l'uno dall'altro, un'email che continua a fallire arriva nella DLQ dopo circa **15 minuti**."),
  p("I due numeri sono legati. I 180 secondi sono sei volte il timeout della Mailer (30 secondi), come raccomanda AWS: un messaggio non torna visibile mentre è ancora in lavorazione. I 5 tentativi sono il minimo raccomandato, perché anche le invocazioni rifiutate per troppa concorrenza contano come ricezioni: con un valore più basso un picco di traffico manderebbe nella DLQ messaggi validi."),
  p("**Batch parziali.** La Mailer riceve fino a 10 messaggi alla volta. Se un solo invio fallisse e la funzione segnalasse un errore, l'intero gruppo tornerebbe in coda: gli altri nove destinatari riceverebbero l'email due volte e consumerebbero tentativi senza motivo. Per questo l'event source mapping accetta i fallimenti parziali: la Mailer indica **solo i messaggi da ritentare**, e gli altri vengono cancellati."),
  p("**Concorrenza 2.** L'event source mapping non lascia lavorare più di due invocazioni della Mailer insieme. Protegge SES, che in sandbox accetta una email al secondo, e Cognito. Se il limite si supera comunque, l'errore di throttling è trattato come temporaneo e il messaggio aspetta il tentativo successivo."),
  p("**Errori temporanei e permanenti.** La Mailer li distingue:"),
  tabella(
    ["Tipo", "Esempi", "Esito"],
    [
      ["Temporaneo", "throttling o errore 5xx di SES o Cognito, timeout di rete", "ritentato; dopo 5 ricezioni va nella DLQ"],
      ["Permanente", "messaggio malformato, email non verificata, destinatario rifiutato da SES", "log di errore e messaggio cancellato; un filtro sui log fa scattare un allarme"],
      ["Previsto", "l'utente ha cancellato l'account e Cognito non lo trova", "log informativo, messaggio cancellato senza allarme"],
    ],
    [1800, 4300, 3500],
  ),
  dopoTabella(),
  p("Ritentare un errore permanente occuperebbe la coda per un quarto d'ora e finirebbe comunque nella DLQ, confuso con i messaggi da rimandare. Così nella DLQ c'è solo ciò che è fallito per una causa **rimediabile**."),
  p("**Quanto resta un messaggio.** La scadenza si conta dal momento in cui il messaggio è entrato nella coda originale, non nella DLQ. Per questo la coda principale tiene i messaggi 4 giorni e la DLQ 14, il massimo: un messaggio arrivato in DLQ resta analizzabile per almeno una decina di giorni."),
  p("**Perché la DLQ sta sulla coda e non sulla Lambda.** La DLQ di Lambda e le *on-failure destination* valgono per le invocazioni asincrone, come quella di S3 (3.4). Con SQS come sorgente è la coda a contare le ricezioni, e la sua redrive policy decide quando spostare un messaggio. Lo spostamento lo esegue SQS, senza permessi IAM; sulla DLQ una regola ammette come sorgente solo la nostra coda (Appendice B)."),

  h3("L'allarme e cosa fa il team"),
  p("Un allarme CloudWatch controlla ogni 5 minuti quanti messaggi ci sono nella DLQ e, appena sono più di zero, pubblica sul topic `real-estate-prod-ops-alerts`, a cui è iscritta l'email del team. Un secondo allarme guarda l'età del messaggio più vecchio nella coda principale: se supera i 15 minuti la Mailer è ferma o troppo lenta, e lo si scopre prima che i messaggi arrivino nella DLQ."),
  p("Il redrive dalla DLQ verso la coda principale è **manuale** e viene dopo aver capito la causa: chi è di turno guarda i messaggi, cerca nei log della Mailer perché sono falliti, corregge il problema (una quota di SES, un servizio fermo, un errore nel modello dell'email) e solo allora li rimanda nella coda, a velocità bassa. Ripartono da zero ricezioni; un messaggio da scartare si annota e si cancella. Un redrive automatico ripeterebbe un errore non risolto. Chi esegue la procedura ha la policy dedicata `ops-dlq-redrive` (Appendice A)."),

  h3("Le scelte"),
  p("SNS davanti a SQS permette di aggiungere altri canali (SMS, push) senza toccare chi pubblica. La Mailer sta fuori dalla VPC perché non usa il database, e raggiunge Cognito e SES senza endpoint privati. Le alternative sono nel capitolo 5."),
];
};
