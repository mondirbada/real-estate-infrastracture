// 2. La soluzione in sintesi
const path = require("path");

module.exports = ({ S, DEF }) => {
  const { p, h1, h2, h3, punto, tabella, dopoTabella, figura } = S;
  return [
  h1("2. La soluzione in sintesi"),

  h2("2.1 L'idea e il diagramma"),
  p("La piattaforma è **serverless**: non ci sono server nostri, e ogni pezzo è un servizio gestito da AWS che si paga per uso e scala da sé. Il frontend è una SPA React servita da CloudFront; il backend è un'HTTP API di API Gateway che invoca funzioni Lambda; i dati stanno in RDS PostgreSQL, i file in S3, gli utenti in Cognito. Il database vive in una **rete privata senza accesso a Internet**, raggiunta solo dalle Lambda che ne hanno bisogno. Ciò che l'utente non deve aspettare, come l'invio di un'email o la registrazione di un file caricato, viaggia in modo **asincrono**, con ritentativi."),
  ...figura(path.join(DEF, "diagrammi/real-estate-v4.png"), 4232, 3676,
    "Figura 2.1 — Il diagramma completo dell'infrastruttura."),
  p("Una freccia piena è una richiesta o un passaggio di dati, una tratteggiata un controllo o un passaggio asincrono. Le frecce blu numerate seguono l'utente: (1) scarica la SPA, (2) fa login e gestisce l'account, (3) chiama l'API con l'access token, (4) carica un file, (5) legge i file pubblici. Il riquadro verde tratteggiato è un security group, il casco un ruolo IAM. Conviene leggere la figura in tre zone, perché dove sta un servizio decide come lo si protegge."),
  punto("**In alto, il mondo esterno e i servizi globali**: il browser, le due distribuzioni CloudFront e IAM."),
  punto("**Al centro, i servizi regionali fuori dalla VPC**: Cognito, API Gateway, S3, SNS, SQS, SES, CloudWatch, Secrets Manager e la Mailer Lambda. Non hanno interfacce di rete nostre, quindi niente security group: li protegge solo IAM."),
  punto("**In basso, la VPC**: il database, l'RDS Proxy, le cinque Lambda di business e gli endpoint VPC, su due sottoreti private in due zone. Qui valgono sia i security group sia IAM."),
  h3("Un esempio: un'offerta"),
  p("Seguiamo un `buyer` che fa un'offerta. Il browser ha già la SPA da CloudFront e un access token da Cognito. Manda la richiesta all'API: l'authorizer JWT verifica il token e API Gateway invoca la Offers Lambda. La Lambda legge il gruppo dai claim e accetta solo un `buyer`; poi entra nell'RDS Proxy con un token IAM e scrive l'offerta nel database. Poi pubblica un evento su SNS, attraverso l'endpoint VPC, e risponde subito al browser. L'email all'agente parte dopo, per conto suo: SNS consegna l'evento alla coda SQS, la Mailer lo legge, chiede a Cognito l'indirizzo dell'agente e invia con SES. Chi autorizza ciascun passaggio è il tema del capitolo 3, flusso per flusso, e del 4.3."),

  h2("2.2 Dai requisiti alla soluzione"),
  p("La tabella riprende i requisiti del capitolo 1 e dice come li risolviamo; l'ultima colonna rimanda al flusso che lo mostra nel dettaglio."),
  tabella(
    ["Req.", "Come lo risolviamo", "Servizi (flusso)"],
    [
      ["R1", "la SPA e i file escono da CloudFront, che legge bucket privati; le route di lettura degli annunci non richiedono il token", "CloudFront, S3, API Gateway (3.1, 3.4)"],
      ["R2", "un user pool con i gruppi `buyer`, `agent`, `admin`; il browser manda l'access token e un authorizer JWT lo verifica senza codice nostro", "Cognito, API Gateway (3.2)"],
      ["R3", "una Lambda per gli immobili: il ruolo arriva nel token e lo controlla la Lambda, la proprietà dell'immobile la dice il database", "API Gateway, Lambda, RDS Proxy, RDS PostgreSQL (3.2, 3.3)"],
      ["R4", "il browser carica direttamente su S3 con un presigned POST firmato da una Lambda, che fissa chiave, tipo e dimensione; una notifica di S3 registra il file nel database", "Lambda, S3, CloudFront (3.4)"],
      ["R5", "una Lambda per le offerte, con lo stato nel database; ogni passaggio pubblica un evento", "Lambda, RDS PostgreSQL, SNS (3.2, 3.3)"],
      ["R6", "l'evento porta solo il `sub` del destinatario; passa da un topic a una coda, e la Mailer chiede l'email a Cognito e invia", "SNS, SQS, Lambda, Cognito, SES (3.5)"],
      ["R7", "profilo e cancellazione vanno dal browser a Cognito; la Users Lambda anonimizza il profilo e ritira le offerte in sospeso, avvisando l'altra parte", "Cognito, Lambda, RDS PostgreSQL, SNS (3.6)"],
      ["R8", "Lambda e HTTP API si pagano per richiesta e scalano da zero; il proxy protegge il database dai picchi di connessioni; throttling sull'API", "Lambda, API Gateway, RDS Proxy (3.2, 3.3)"],
      ["R9", "solo servizi gestiti: nessuna macchina virtuale da amministrare", "tutti"],
      ["R10", "VPC senza porte verso Internet; un ruolo IAM e un utente PostgreSQL per Lambda; password solo in Secrets Manager, lette dal proxy; TLS ovunque, cifratura a riposo con KMS; email solo in Cognito", "VPC, IAM, RDS Proxy, Secrets Manager, KMS (3.3, 4.1, 4.2)"],
      ["R11", "database Multi-AZ con standby sincrona, Lambda e proxy su entrambe; le email fallite si ritentano e finiscono in una dead-letter queue sorvegliata", "RDS PostgreSQL, VPC, SQS (3.3, 3.5)"],
      ["R12", "tutto nella regione `eu-south-1` (Milano)", "tutti"],
      ["R13", "log di Lambda e API, metriche dei servizi, allarmi che scrivono al gruppo via email", "CloudWatch, SNS (3.7)"],
    ],
    [800, 5900, 2900],
  ),
  dopoTabella(),

  h2("2.3 Le scelte di fondo"),
  p("Le decisioni di dettaglio, con le alternative scartate, sono nel capitolo 5. Qui le quattro che danno forma all'intera architettura."),
  h3("Serverless"),
  p("Il traffico è basso e irregolare, e non vogliamo server da gestire (R8, R9). Lambda e un'HTTP API si pagano per richiesta e scalano da zero; un'applicazione sempre accesa costerebbe anche a vuoto. Il prezzo è il cold start sulle istanze nuove e un codice effimero, che non tiene nulla in memoria tra una richiesta e l'altra: lo stato sta nel database e in S3."),
  h3("Una regione, due zone"),
  p("Tutto è in `eu-south-1`, per tenere i dati in Italia (R12). Dentro la regione la VPC ha due sottoreti in due zone di disponibilità: il database e il proxy lo richiedono, e se una zona cade RDS promuove la standby dell'altra (R11). Non c'è replica su una seconda regione: è un limite dichiarato nel capitolo 5."),
  h3("Una VPC senza Internet Gateway né NAT"),
  p("Nella VPC sta solo ciò che deve stare vicino al database. Il traffico degli utenti entra da CloudFront e API Gateway, che sono fuori, e il backend non chiama API esterne: un NAT sarebbe un costo fisso per niente. I pochi servizi AWS necessari si raggiungono con gli **endpoint VPC**; la Mailer, che non usa il database, sta fuori (4.2)."),
  h3("Sincrono e asincrono"),
  p("Le richieste degli utenti sono sincrone: il browser chiama l'API e la Lambda risponde. Ciò che può aspettare è asincrono, così un servizio lento non rallenta l'utente e un errore non si perde. Le email passano da SNS e SQS, con ritentativi e una dead-letter queue (3.5); la registrazione di un file parte da una notifica di S3 e non da una conferma del browser, che potrebbe non arrivare o mentire (3.4)."),
  ];
};
