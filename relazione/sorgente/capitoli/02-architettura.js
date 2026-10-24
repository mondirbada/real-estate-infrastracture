// 2. Architettura d'insieme
const path = require("path");

module.exports = ({ S, DEF }) => {
  const { p, h1, h2, h3, punto, tabella, dopoTabella, figura, elencoNumerato } = S;
  return [
  h1("2. Architettura d'insieme"),
  p("Il frontend è una SPA React servita da CloudFront. Il backend è un'HTTP API di API Gateway che invoca sei funzioni Lambda. I dati relazionali stanno in Aurora PostgreSQL dietro un RDS Proxy, i file degli annunci in S3, e le notifiche email passano da SNS, SQS e SES. Le utenze e i ruoli li gestisce Cognito."),

  h2("2.1 Il diagramma completo"),
  ...figura(path.join(DEF, "diagrammi/real-estate-v3.png"), 4232, 3676,
    "Figura 2.1 — Il diagramma completo dell'infrastruttura (versione v3)."),
  p("La legenda del diagramma: una freccia **piena** è una richiesta o un passaggio di dati; una freccia **tratteggiata** è un controllo, un passaggio asincrono o un punto ancora da verificare. Le frecce blu numerate da 1 a 5 seguono il percorso dell'utente: (1) scarica la SPA, (2) login e gestione dell'account, (3) chiamate all'API con l'access token, (4) upload con il presigned POST, (5) lettura dei file pubblici. Il riquadro verde tratteggiato è un *security group*; l'icona del casco è un ruolo IAM, cioè l'*execution role* di una Lambda."),

  h3("Lettura guidata per zone"),
  p("Il modo più semplice per leggere la figura è dividerla in tre zone, perché dove sta un servizio decide **come lo si protegge**."),
  punto("**In alto, il mondo esterno e i servizi globali.** Il browser dell'utente, le due distribuzioni CloudFront (una per il sito, una per i file) e IAM. CloudFront e IAM non appartengono a una regione."),
  punto("**Al centro, i servizi regionali fuori dalla VPC.** Cognito, API Gateway, i due bucket S3, SNS, SQS, SES, CloudWatch, Secrets Manager e la Mailer Lambda. Non hanno interfacce di rete nostre, quindi **non hanno security group**: si proteggono solo con IAM, cioè con identity policy e resource policy."),
  punto("**In basso, la VPC.** Aurora, l'RDS Proxy, le interfacce di rete delle cinque Lambda di business e gli endpoint VPC, su due sottoreti private in due zone di disponibilità. Qui valgono sia i controlli di rete (i security group) sia quelli IAM."),
  p("Il diagramma mostra anche che **la VPC non ha porte verso Internet**: né Internet Gateway né NAT. Le Lambda al suo interno raggiungono i pochi servizi AWS che servono tramite gli endpoint, e tutto il traffico degli utenti entra da CloudFront e da API Gateway, che stanno fuori."),

  h2("2.2 I componenti in breve"),
  p("La tabella elenca ogni componente con il suo ruolo e la zona in cui sta. Qui i servizi sono descritti in modo volutamente breve: i collegamenti tra loro e i permessi sono il tema del capitolo 4. Per ciascun servizio esiste un file di dettaglio in `definitivo/`."),
  tabella(
    ["Componente", "Ruolo nel progetto", "Dove sta"],
    [
      ["**CloudFront**, due distribuzioni", "CDN con HTTPS: una serve la SPA (con la regola per il routing e gli header di sicurezza), l'altra le foto e i video degli annunci; entrambe leggono bucket privati con OAC", "globale"],
      ["**S3**, due bucket privati", "`real-estate-prod-website-<SUFFIX>` contiene la SPA; `real-estate-prod-files-<SUFFIX>` i file degli annunci, scritti dal browser con un presigned POST", "regionale, fuori dalla VPC"],
      ["**Cognito**, user pool", "registrazione, login, token; i gruppi `buyer`, `agent`, `admin` danno il ruolo; è l'unico posto dove sta l'email degli utenti", "regionale, fuori dalla VPC"],
      ["**API Gateway**, HTTP API", "porta d'ingresso del backend: verifica il token con un authorizer JWT, applica CORS e throttling, invoca la Lambda dello scope", "regionale, fuori dalla VPC"],
      ["**Lambda di business** (Property, Users, Offers, Presigned, Files)", "la logica dell'applicazione, una funzione per scope con un router interno, ognuna con il proprio ruolo IAM", "dentro la VPC, in entrambe le sottoreti"],
      ["**Lambda Mailer**", "legge la coda delle notifiche, chiede l'email a Cognito e invia con SES; non usa il database", "regionale, fuori dalla VPC"],
      ["**VPC** e sottoreti", "rete privata `10.0.0.0/16` con due sottoreti `/24` in due zone di disponibilità, senza accesso a Internet", "regionale"],
      ["**Endpoint VPC**", "unica strada verso i servizi AWS dalla VPC: interface per SNS e Secrets Manager, gateway (gratuito) per S3", "dentro la VPC"],
      ["**RDS Proxy**", "pooler di connessioni tra le Lambda e Aurora; le Lambda entrano con un token IAM, il proxy con la password del secret", "dentro la VPC"],
      ["**Aurora PostgreSQL**", "database relazionale: utenti, immobili, offerte, metadati dei file; un writer e un reader su due zone", "dentro la VPC"],
      ["**Secrets Manager** e **KMS**", "le credenziali degli utenti PostgreSQL, che legge solo il proxy; le chiavi KMS gestite da AWS che cifrano database e secret (la coda usa la cifratura SSE-SQS, gestita da SQS)", "regionale, fuori dalla VPC"],
      ["**SNS**, topic delle notifiche", "riceve gli eventi da Property, Users e Offers e ne consegna una copia a ogni sottoscrittore", "regionale, fuori dalla VPC"],
      ["**SQS**, coda e dead-letter queue", "buffer con ritentativi tra l'evento e l'invio; la DLQ raccoglie i messaggi non elaborati dopo 5 ricezioni", "regionale, fuori dalla VPC"],
      ["**SES**", "invia le email dal mittente del progetto (in sandbox per la demo)", "regionale, fuori dalla VPC"],
      ["**CloudWatch** e topic `real-estate-prod-ops-alerts`", "log, metriche e allarmi; il topic porta gli avvisi al team per email", "regionale, fuori dalla VPC"],
      ["**IAM**", "ruoli `real-estate-prod-*`, policy e trust relationship: decide chi può fare cosa su quale risorsa", "globale"],
    ],
    [2500, 5600, 1800],
  ),
  dopoTabella(),
  p("Tre idee tengono insieme il progetto. Il **frontend è statico** (CloudFront e S3): nessun server, la logica di presentazione gira nel browser. Il **backend è serverless** (API Gateway e Lambda): si paga per richiesta e AWS gestisce i server. Lo **stato sta nei servizi di dati** (Aurora e S3), non nelle Lambda, che sono effimere: ogni istanza può nascere e sparire in qualsiasi momento, come un controller Spring che non tiene mai nulla in memoria da una richiesta all'altra."),

  h2("2.3 Le scelte di fondo"),
  p("Le decisioni di dettaglio sono nel capitolo 5. Qui le quattro che determinano la forma dell'intera architettura."),
  h3("Serverless"),
  p("Il traffico previsto è basso e irregolare. Con Lambda e un'HTTP API si paga per richiesta e il sistema scala da zero; con un'applicazione sempre accesa (per esempio un container su ECS Fargate, la cosa più vicina a un `docker-compose` in produzione) si pagherebbe un costo fisso anche a vuoto. Il prezzo è un cold start sulle istanze nuove e il fatto che il codice sia effimero, da cui la regola di tenere lo stato nei servizi di dati."),
  h3("Una regione, due zone di disponibilità"),
  p("Tutto sta in `eu-south-1` (Milano): dati in Italia e latenza bassa. È una regione *opt-in*, da abilitare nell'account, ma tutti i servizi usati ci sono. Dentro la regione, la VPC ha due sottoreti in due zone: Aurora e l'RDS Proxy chiedono almeno due zone, e due zone vogliono dire sopravvivere alla caduta di un data center (Aurora promuove la reader dell'altra zona in decine di secondi). Non c'è invece replica su una seconda **regione**: è un limite che dichiariamo nel capitolo 6."),
  h3("Una VPC senza Internet Gateway né NAT"),
  p("Nella VPC vive solo ciò che deve stare vicino al database. Il traffico degli utenti entra da CloudFront e da API Gateway, che sono fuori; il progetto non chiama API esterne; un NAT sarebbe un costo fisso orario per niente. Le Lambda nella VPC raggiungono i servizi AWS che servono con gli **endpoint VPC**: SNS e Secrets Manager con interface endpoint, S3 con un gateway endpoint gratuito. Se un giorno servisse un'API esterna, si aggiungerebbe una sottorete pubblica per zona con un NAT."),
  h3("Sincrono e asincrono"),
  p("Le richieste degli utenti sono **sincrone**: il browser chiama l'API, la Lambda risponde. Tutto ciò che può aspettare è **asincrono**, così che un servizio lento non rallenti l'utente e un errore non vada perso. L'invio delle email passa da SNS e SQS con ritentativi e una dead-letter queue; la registrazione di un file caricato parte da una notifica di S3 e non da una conferma del client, che potrebbe mentire o non arrivare mai. La Mailer sta fuori dalla VPC proprio perché è l'unica Lambda che non ha bisogno del database."),
  p("Le scelte trasversali di sicurezza, cioè un ruolo IAM per Lambda, un utente PostgreSQL per Lambda, nessuna password nel codice, cifratura in transito e a riposo, sono il tema del capitolo 3."),
  ];
};
