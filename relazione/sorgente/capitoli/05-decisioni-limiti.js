// 5. Decisioni, alternative e limiti
module.exports = ({ S }) => {
  const { p, h1, h2, punto, tabella, dopoTabella } = S;
  return [
  h1("5. Decisioni, alternative e limiti"),
  p("Qui raccogliamo le decisioni che hanno dato forma al progetto, con l'alternativa lasciata, poi i limiti che dichiariamo e gli sviluppi possibili."),

  h2("5.1 Le decisioni principali"),
  tabella(
    ["Decisione", "Perché", "Alternativa scartata"],
    [
      ["Architettura serverless", "traffico basso e variabile: si paga per richiesta, scala da zero, nessun server da gestire", "container su ECS Fargate, sempre accesi"],
      ["Regione `eu-south-1`", "dati in Italia, latenza bassa; tutti i servizi usati ci sono", "Francoforte o Irlanda: dati fuori dall'Italia"],
      ["VPC senza Internet Gateway né NAT, con endpoint VPC", "il traffico utente entra da servizi fuori dalla VPC e non chiamiamo API esterne", "NAT Gateway: costo fisso orario senza necessità"],
      ["HTTP API con authorizer JWT nativo", "costa meno; verifica firma, issuer, `client_id` e scadenza senza codice nostro", "REST API; Lambda Authorizer, una funzione in più a ogni richiesta"],
      ["**Access token** all'API; la Mailer legge l'email da Cognito con `AdminGetUser` (discussa con il docente)", "l'ID token serve a dire al client chi è l'utente, non ad autorizzare le API; così nessuna email sta nei token, negli eventi o nel database", "ID token all'API (la nostra prima scelta); una Lambda Pre Token Generation che aggiunge l'email all'access token; l'endpoint `userInfo`, non raggiungibile dalla VPC senza NAT; una cache nelle Lambda; un Lambda Authorizer"],
      ["Upload con presigned POST e registrazione da notifica S3", "il file non passa dal backend; solo il POST limita la dimensione; il database vede solo gli upload riusciti", "presigned PUT; upload attraverso l'API; conferma dal client"],
      ["SPA e file via CloudFront, bucket privati con OAC", "HTTPS e cache; i file degli annunci li vede chi ha il link, ma mai dal bucket", "bucket pubblico con *static website hosting*; URL firmati, utili solo per documenti privati"],
      ["RDS Proxy con token IAM, un utente PostgreSQL e un secret per Lambda", "nessuna password nelle Lambda; IAM decide chi entra, i `GRANT` cosa fa", "connessione diretta ad Aurora, con rischio di esaurire le connessioni"],
      ["Aurora con writer e reader su due zone", "failover automatico se cade una zona", "Aurora Serverless v2; RDS Multi-AZ"],
      ["SNS → SQS → Mailer, DLQ dopo 5 ricezioni, visibility timeout 180 s", "buffer e ritentativi; SNS permette altri consumer; i valori seguono le raccomandazioni AWS", "EventBridge; solo SQS; DLQ sulla Lambda, che vale solo per invocazioni asincrone"],
      ["Alla cancellazione dell'account **anonimizziamo**", "resta il solo `sub`; offerte e immobili passano a `withdrawn`, l'altra parte viene avvisata e le chiavi esterne restano valide", "cancellazione a cascata, che toglie la storia all'altra parte"],
      ["Un ruolo IAM per Lambda; `aws:SourceArn` nelle resource policy", "permessi minimi e audit chiaro; niente *confused deputy*", "policy gestite larghe; principal di servizio senza condizioni"],
    ],
    [2700, 3900, 3000],
  ),
  dopoTabella(),

  h2("5.2 Limiti e rischi dichiarati"),
  punto("**Configurazione mai provata.** La relazione descrive la configurazione prevista: nessuna risorsa è stata creata. Connessione al proxy, failover del writer e Content-Security-Policy si verificano solo creandole."),
  punto("**Revoca dei token.** L'authorizer JWT non vede le revoche: un access token rubato resta valido fino alla scadenza, al massimo un'ora, anche dopo il logout (3.2). Dopo la cancellazione dell'account può solo leggere (3.6)."),
  punto("**Costo fisso.** Aurora, il proxy e gli interface endpoint costano anche a vuoto: è la parte che non segue R8. Una stima con il Pricing Calculator non l'abbiamo ancora fatta."),
  punto("**Una sola regione.** Le due zone coprono la caduta di un data center, non quella della regione."),
  punto("**La reader di Aurora** serve solo al failover: le letture vanno tutte al writer."),
  punto("**SES in sandbox.** Solo indirizzi verificati, 200 email al giorno, una al secondo: basta per la demo."),
  punto("**Email doppie, raramente.** La coda standard consegna almeno una volta; evitarlo richiederebbe un database nella Mailer."),
  punto("**Cosa resta di un account cancellato.** La riga con il solo `sub`, gli immobili ritirati con i loro file, il profilo nei backup di Aurora fino alla fine della retention (3.6)."),
  punto("**File e sicurezza dei contenuti.** Foto e video sono leggibili da chi ha il link, e nessun antivirus analizza i file caricati: restano solo i limiti di tipo e dimensione."),

  h2("5.3 Sviluppi possibili"),
  punto("Un **Backend For Frontend** che tenga i token e dia al browser un cookie `HttpOnly`: risolve il furto del token."),
  punto("**WAF** su una distribuzione CloudFront davanti all'API, perché non si associa direttamente a un'HTTP API."),
  punto("**Infrastructure as Code** e ambienti separati (oggi c'è solo `prod`); **rotazione automatica** dei secret."),
  punto("Un endpoint di sola lettura del proxy per **usare la reader**, o Aurora Serverless v2 per pagare solo la capacità usata."),
  punto("**SES in produzione** con il dominio verificato, e **altri canali** di notifica come nuovi sottoscrittori del topic."),
  punto("**Scansione antivirus** dei file, **pulizia dei file** degli immobili ritirati, URL firmati per eventuali **documenti privati**, un **dominio personalizzato**."),
  ];
};
