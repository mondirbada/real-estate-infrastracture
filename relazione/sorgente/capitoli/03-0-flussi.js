// 3. Come comunicano i componenti — introduzione ai flussi.
module.exports = ({ S }) => {
  const { p, h1, h3, tabella, dopoTabella } = S;
  return [
  h1("3. Come comunicano i componenti"),
  p("Il diagramma del capitolo 2 mostra tutte le frecce insieme. Qui lo scomponiamo in sette flussi: per ciascuno seguiamo una richiesta da un capo all'altro e diciamo, a ogni passaggio, **chi parla con chi** e **chi lo autorizza**. I dettagli dei servizi restano solo dove spiegano un collegamento."),
  h3("Lo schema comune"),
  p("Ogni flusso si apre con il problema e la soluzione, poi la figura, il percorso, la tabella dei collegamenti, le autorizzazioni chiave, cosa succede quando qualcosa va storto e le scelte. I concetti IAM generali sono nel capitolo 4, le alternative scartate nel 5, le policy complete nelle appendici."),
  h3("I sette flussi"),
  tabella(
    ["Sezione", "Flusso", "In una riga"],
    [
      ["3.1", "Scaricare l'applicazione", "CloudFront legge il bucket privato del sito con OAC"],
      ["3.2", "Login e chiamate all'API", "Cognito emette i token, l'authorizer JWT controlla l'access token"],
      ["3.3", "Dalla Lambda al database", "RDS Proxy con autenticazione IAM verso RDS PostgreSQL"],
      ["3.4", "Caricare e servire i file", "presigned POST verso S3, lettura tramite CloudFront"],
      ["3.5", "Le notifiche email", "SNS, SQS, Mailer e SES, con la dead-letter queue"],
      ["3.6", "Gestione e cancellazione dell'account", "la SPA con Cognito, i dati anonimizzati"],
      ["3.7", "Log, metriche e allarmi", "CloudWatch avvisa il team tramite SNS"],
    ],
    [900, 3200, 5500],
  ),
  dopoTabella(),
  ];
};
