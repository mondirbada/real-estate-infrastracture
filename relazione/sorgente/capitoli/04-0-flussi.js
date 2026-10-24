// 4. I flussi — introduzione
module.exports = ({ S }) => {
  const { p, h1, h3, tabella, dopoTabella, punto } = S;
  return [
  h1("4. I flussi, uno per uno"),
  p("Il diagramma del capitolo 2 mostra tutte le frecce insieme, e per questo è difficile da leggere. In questo capitolo lo scomponiamo: ogni sezione prende **un flusso**, ne mostra una vista in cui il resto è sbiadito, e segue la richiesta da un capo all'altro dicendo, a ogni passaggio, quale controllo di rete e quale controllo IAM la lascia passare."),
  h3("Lo schema comune"),
  p("Tutti i flussi hanno la stessa struttura, così da poterli confrontare:"),
  punto("una spiegazione di **che cosa succede e perché è progettato così**;"),
  punto("la **figura parziale**, con il flusso in evidenza;"),
  punto("*il percorso in sintesi*, un elenco numerato dei passaggi;"),
  punto("*chi parla con chi*, una tabella con, per ogni freccia, il modo, la rete e chi autorizza;"),
  punto("le **autorizzazioni**, passaggio per passaggio, con le policy vere del repository;"),
  punto("**cosa succede quando qualcosa va storto**: errori, limiti, rischi residui;"),
  punto("*perché così*: la tabella delle scelte con l'alternativa scartata, e un riquadro di domande e risposte da orale."),
  p("I flussi più semplici, come il 4.1, usano uno schema più corto; quelli più ricchi di IAM, come il 4.5, ne usano uno più lungo."),
  h3("I sette flussi"),
  tabella(
    ["Sezione", "Flusso", "Cosa copre"],
    [
      ["4.1", "Scaricare l'applicazione", "browser → CloudFront → bucket privato del sito; OAC, bucket policy, header di sicurezza"],
      ["4.2", "Login e chiamate all'API", "Cognito, access token, authorizer JWT di API Gateway, invocazione delle Lambda"],
      ["4.3", "Dalla Lambda al database", "RDS Proxy, autenticazione IAM, Secrets Manager, KMS, Aurora, security group"],
      ["4.4", "Caricare e servire i file", "presigned POST, notifica S3, registrazione nel database, lettura via CloudFront, cancellazione"],
      ["4.5", "Le notifiche email", "SNS → SQS → Mailer Lambda → SES; batch parziali, dead-letter queue e redrive"],
      ["4.6", "Gestione e cancellazione dell'account", "Cognito chiamato dal frontend, ordine della cancellazione"],
      ["4.7", "Log, metriche e allarmi", "CloudWatch, metric filter, allarmi e topic verso il team"],
    ],
    [900, 3000, 5700],
  ),
  dopoTabella(),
  ];
};
