// Appendice A — Ruoli e policy: l'elenco dei ruoli e delle resource policy, poi il testo integrale di ogni JSON in definitivo/iam/.
module.exports = ({ S, leggiJson }) => {
  const { p, h1, h2, h3, codice, tabella, dopoTabella } = S;
  const json = f => codice(leggiJson(f), f);

  return [
  h1("Appendice A — Ruoli e policy"),
  p("I concetti sono nel capitolo 4, l'uso di ogni policy nel flusso indicato. I JSON sono template: `<ACCOUNT_ID>`, `<SUFFIX>` e gli altri segnaposto si sostituiscono al provisioning."),

  h2("A.1 I ruoli"),
  p("\"log\" = `AWSLambdaBasicExecutionRole`, \"VPC\" = `AWSLambdaVPCAccessExecutionRole`, entrambe gestite da AWS."),
  tabella(
    ["Ruolo", "Trust", "Policy gestite AWS", "Policy del progetto", "Flusso"],
    [
      ["`real-estate-prod-lambda-property-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-property.json`", "3.2-3.5"],
      ["`real-estate-prod-lambda-users-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-users.json`", "3.3, 3.5, 3.6"],
      ["`real-estate-prod-lambda-offers-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-offers.json`", "3.3, 3.5"],
      ["`real-estate-prod-lambda-presigned-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-presigned.json`", "3.3, 3.4"],
      ["`real-estate-prod-lambda-files-role`", "`lambda.amazonaws.com`", "log, VPC", "`iam/policies/lambda-files.json`", "3.3, 3.4"],
      ["`real-estate-prod-lambda-mailer-role`", "`lambda.amazonaws.com`", "log", "`iam/policies/lambda-mailer.json`", "3.5"],
      ["`real-estate-prod-rds-proxy-secrets-role`", "`rds.amazonaws.com`", "—", "`iam/policies/rds-proxy-read-secrets.json` (+ `rds-proxy-decrypt-secrets.json` solo con una CMK)", "3.3"],
      ["`AWSServiceRoleForRDS` (service-linked)", "servizio RDS, gestita da AWS", "`AmazonRDSServiceRolePolicy`", "—", "3.3"],
    ],
    [2900, 1700, 1400, 2700, 900],
  ),
  dopoTabella(),
  p("Per le persone del team: `iam/policies/deploy-pass-role.json` (identità di deploy, `iam:PassRole` sui ruoli `real-estate-prod-*` verso Lambda e RDS, 4.1) e `iam/policies/ops-dlq-redrive.json` (chi gestisce la DLQ, 3.5)."),

  h2("A.2 Le resource policy"),
  tabella(
    ["Risorsa", "Chi ammette", "Condizioni", "File", "Flusso"],
    [
      ["Le 5 Lambda di business", "`apigateway.amazonaws.com`, `lambda:InvokeFunction`", "`AWS:SourceArn` = la nostra API", "`lambda-allow-api-gateway.json` (con `<FUNCTION_NAME>`)", "3.2"],
      ["Files Lambda", "`s3.amazonaws.com`, `lambda:InvokeFunction`", "`AWS:SourceArn` = bucket dei file, `AWS:SourceAccount` = nostro account", "`lambda-files-allow-s3.json`", "3.4"],
      ["Bucket del sito", "`cloudfront.amazonaws.com`, `s3:GetObject`; Deny a tutti senza TLS", "`AWS:SourceArn` = distribuzione del sito; `aws:SecureTransport`", "`s3-website-bucket-policy.json`", "3.1"],
      ["Bucket dei file", "`cloudfront.amazonaws.com`, `s3:GetObject` su `uploads/*`; Deny a tutti senza TLS", "`AWS:SourceArn` = distribuzione dei file; `aws:SecureTransport`", "`s3-files-bucket-policy.json`", "3.4"],
      ["Coda delle notifiche", "`sns.amazonaws.com`, `sqs:SendMessage`", "`aws:SourceArn` = il nostro topic", "`sqs-notifications-queue-policy.json`", "3.5"],
      ["Endpoint SNS (facoltativa)", "`sns:Publish` sul nostro topic", "`aws:PrincipalAccount` = nostro account", "`vpc-endpoint-sns-policy.json`", "3.5"],
    ],
    [1700, 2600, 2500, 2000, 800],
  ),
  dopoTabella(),
  p("Tutti i file sono in `iam/resource-policies/`. Non scriviamo policy per le chiavi gestite `aws/rds` e `aws/secretsmanager`, per la coda e la DLQ (SSE-SQS), per i secret, per i due topic SNS e per gli endpoint Secrets Manager e S3: nello stesso account bastano le identity policy di chi li usa, o vale la policy di default."),

  h2("A.3 Testo integrale dei JSON"),
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
  p("Template da cui derivano gli statement `rds-db:connect` delle cinque Lambda di business:"),
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
