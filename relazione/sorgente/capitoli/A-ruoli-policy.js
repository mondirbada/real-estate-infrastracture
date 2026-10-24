// Appendice A — Ruoli e policy: l'elenco completo e il testo integrale di ogni JSON in definitivo/iam/.
module.exports = ({ S, leggiJson }) => {
  const { p, h1, h2, h3, codice, tabella, dopoTabella } = S;
  const json = f => codice(leggiJson(f), f);

  return [
  h1("Appendice A — Ruoli e policy"),
  p("Il riferimento completo di IAM nel progetto: prima gli elenchi (ruoli, policy per le persone, resource policy, policy che non scriviamo), poi il testo integrale di ogni file JSON di `iam/`, raggruppato per tipo. I concetti sono nel capitolo 3, l'uso di ogni policy nel flusso indicato. I JSON sono template: `<ACCOUNT_ID>`, `<SUFFIX>` e gli altri segnaposto si sostituiscono al provisioning."),

  h2("A.1 I ruoli"),
  p("\"log\" = `AWSLambdaBasicExecutionRole`, \"VPC\" = `AWSLambdaVPCAccessExecutionRole`, entrambe gestite da AWS."),
  tabella(
    ["Ruolo", "Trust", "Policy gestite AWS", "Policy del progetto", "Flusso"],
    [
      ["`real-estate-prod-lambda-property-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-property.json`", "4.2-4.5"],
      ["`real-estate-prod-lambda-users-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-users.json`", "4.3, 4.5, 4.6"],
      ["`real-estate-prod-lambda-offers-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-offers.json`", "4.3, 4.5"],
      ["`real-estate-prod-lambda-presigned-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-presigned.json`", "4.3, 4.4"],
      ["`real-estate-prod-lambda-files-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-files.json`", "4.3, 4.4"],
      ["`real-estate-prod-lambda-mailer-role`", "`lambda.amazonaws.com`", "log", "`iam/policies/lambda-mailer.json`", "4.5"],
      ["`real-estate-prod-rds-proxy-secrets-role`", "`rds.amazonaws.com`", "—", "`iam/policies/rds-proxy-read-secrets.json` (+ `rds-proxy-decrypt-secrets.json` solo con una CMK)", "4.3"],
      ["`AWSServiceRoleForRDS` (service-linked)", "servizio RDS, gestita da AWS", "`AmazonRDSServiceRolePolicy`", "—", "4.3"],
    ],
    [2900, 1700, 1400, 2700, 900],
  ),
  dopoTabella(),
  p("La trust dei sei ruoli delle Lambda è la stessa (`iam/trust-relationships/lambda.json`); quella del proxy è `iam/trust-relationships/rds-proxy.json`. Il service-linked role di RDS non si crea né si modifica: va solo verificato che esista o possa essere creato."),

  h2("A.2 Le policy per le persone del team"),
  tabella(
    ["Policy", "Per chi", "Cosa permette", "Dove"],
    [
      ["`iam/policies/deploy-pass-role.json`", "l'identità di deploy", "`iam:PassRole` sui soli ruoli `real-estate-prod-*`, verso Lambda e RDS", "3.1"],
      ["`iam/policies/ops-dlq-redrive.json`", "chi gestisce la DLQ delle notifiche", "leggere e cancellare i messaggi della DLQ, avviare, seguire e fermare il redrive verso la sola coda principale, leggere i log della Mailer", "4.5"],
    ],
    [2900, 1900, 3900, 900],
  ),
  dopoTabella(),

  h2("A.3 Le resource policy"),
  tabella(
    ["Risorsa", "Chi ammette", "Condizioni", "File", "Flusso"],
    [
      ["Le 5 Lambda di business", "`apigateway.amazonaws.com`, `lambda:InvokeFunction`", "`AWS:SourceArn` = la nostra API", "`lambda-allow-api-gateway.json` (con `<FUNCTION_NAME>`)", "4.2"],
      ["Files Lambda", "`s3.amazonaws.com`, `lambda:InvokeFunction`", "`AWS:SourceArn` = bucket dei file, `AWS:SourceAccount` = nostro account", "`lambda-files-allow-s3.json`", "4.4"],
      ["Bucket del sito", "`cloudfront.amazonaws.com`, `s3:GetObject`; Deny a tutti senza TLS", "`AWS:SourceArn` = distribuzione del sito; `aws:SecureTransport`", "`s3-website-bucket-policy.json`", "4.1"],
      ["Bucket dei file", "`cloudfront.amazonaws.com`, `s3:GetObject` su `uploads/*`; Deny a tutti senza TLS", "`AWS:SourceArn` = distribuzione dei file; `aws:SecureTransport`", "`s3-files-bucket-policy.json`", "4.4"],
      ["Coda delle notifiche", "`sns.amazonaws.com`, `sqs:SendMessage`", "`aws:SourceArn` = il nostro topic", "`sqs-notifications-queue-policy.json`", "4.5"],
      ["Endpoint SNS (facoltativa)", "`sns:Publish` sul nostro topic", "`aws:PrincipalAccount` = nostro account", "`vpc-endpoint-sns-policy.json`", "4.5"],
    ],
    [1700, 2600, 2500, 2000, 800],
  ),
  dopoTabella(),
  p("Tutti i file sono in `iam/resource-policies/`. La resource policy delle Lambda non si scrive a mano: la crea `aws lambda add-permission` o la console quando si collega la route; il file documenta il risultato."),

  h3("Le policy che non scriviamo"),
  tabella(
    ["Risorsa", "Perché nessuna policy"],
    [
      ["Chiavi KMS `aws/rds`, `aws/secretsmanager`", "chiavi gestite da AWS, con key policy fissa. Con una CMK servirebbe una key policy che ammetta il ruolo del proxy (o `sns.amazonaws.com` per una coda cifrata con CMK)"],
      ["Coda e DLQ (cifratura)", "SSE-SQS: nessuna chiave KMS e nessuna key policy"],
      ["Secret di Secrets Manager", "nello stesso account basta l'identity policy del ruolo del proxy"],
      ["Topic `real-estate-prod-notifications`", "la policy di default ammette le identità del nostro account; il filtro lo fanno le identity policy delle Lambda"],
      ["Topic `real-estate-prod-ops-alerts`", "stesso account e nessuna chiave del cliente: la procedura di AWS non richiede una topic policy per gli allarmi"],
      ["Endpoint Secrets Manager, gateway S3", "policy di default"],
      ["Cognito, authorizer JWT, SES, HTTP API → log", "nessun ruolo né resource policy: l'unico permesso verso Cognito è `AdminGetUser` nel ruolo della Mailer"],
    ],
    [3200, 6400],
  ),
  dopoTabella(),

  h2("A.4 Testo integrale dei JSON"),
  h3("Trust relationship"),
  ...json("iam/trust-relationships/lambda.json"),
  ...json("iam/trust-relationships/rds-proxy.json"),

  h3("Identity policy dei ruoli delle Lambda"),
  ...json("iam/policies/lambda-property.json"),
  ...json("iam/policies/lambda-users.json"),
  ...json("iam/policies/lambda-offers.json"),
  ...json("iam/policies/lambda-presigned.json"),
  ...json("iam/policies/lambda-files.json"),
  ...json("iam/policies/lambda-mailer.json"),
  p("Template generico da cui derivano gli statement `rds-db:connect` delle cinque Lambda di business:"),
  ...json("iam/policies/lambda-connect-proxy.json"),

  h3("Identity policy del ruolo del proxy"),
  ...json("iam/policies/rds-proxy-read-secrets.json"),
  p("Solo se i secret fossero cifrati con una chiave del cliente:"),
  ...json("iam/policies/rds-proxy-decrypt-secrets.json"),

  h3("Policy per le persone del team"),
  ...json("iam/policies/deploy-pass-role.json"),
  ...json("iam/policies/ops-dlq-redrive.json"),

  h3("Resource policy delle Lambda"),
  ...json("iam/resource-policies/lambda-allow-api-gateway.json"),
  ...json("iam/resource-policies/lambda-files-allow-s3.json"),

  h3("Bucket policy"),
  ...json("iam/resource-policies/s3-website-bucket-policy.json"),
  ...json("iam/resource-policies/s3-files-bucket-policy.json"),

  h3("Queue policy"),
  ...json("iam/resource-policies/sqs-notifications-queue-policy.json"),

  h3("Endpoint policy"),
  ...json("iam/resource-policies/vpc-endpoint-sns-policy.json"),
  ];
};
