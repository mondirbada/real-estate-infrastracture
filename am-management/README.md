# IAM, policy e trust relationship

Ruoli, trust relationship, identity policy e resource policy di tutti i componenti, coerenti con
[`architecture.md`](../architecture.md) e con il diagramma [`real-estate-v2.drawio`](../diagrams/real-estate-v2.drawio).
La parte su Aurora, RDS Proxy e Secrets Manager è descritta per prima; gli altri componenti nei file
elencati sotto.

## Architettura adottata

- Un cluster Aurora PostgreSQL: writer in una AZ e replica in un'altra AZ.
- RDS Proxy davanti al cluster, su subnet private in almeno due AZ.
- Le Lambda applicative si autenticano al proxy tramite IAM e TLS (token di autenticazione valido 15 minuti, richiesto con TLS).
- Il proxy si autentica ad Aurora con username e password letti da Secrets Manager.
- Un utente PostgreSQL e un secret per ogni ambito che richiede permessi distinti.
- L'utente master è riservato all'amministrazione, escluso dalle connessioni applicative.

```text
Lambda -- IAM + TLS --> RDS Proxy -- password + TLS --> Aurora PostgreSQL
                           |
                           +-- GetSecretValue --> Secrets Manager
```

Questo documento descrive la configurazione prevista; non attesta risorse già
create nell'account AWS. Il quadro generale è in [`architecture.md`](../architecture.md).
## Ruoli (identità che un servizio assume)

Convenzione dei nomi: `real-estate-<ambiente>-<componente>-<scopo>`.

| Componente | Ruolo | Trust | Permessi |
| --- | --- | --- | --- |
| Aurora | `AWSServiceRoleForRDS` (service-linked, gestito da AWS) | Gestita da AWS, servizio RDS | `AmazonRDSServiceRolePolicy` |
| RDS Proxy | `real-estate-prod-rds-proxy-secrets-role` | `rds.amazonaws.com` | [`rds-proxy-read-secrets.json`](policies/rds-proxy-read-secrets.json) (+ [`rds-proxy-decrypt-secrets.json`](policies/rds-proxy-decrypt-secrets.json) con una CMK) |
| Property Lambda | `real-estate-prod-lambda-property-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-property.json`](policies/lambda-property.json) |
| Users Lambda | `real-estate-prod-lambda-users-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-users.json`](policies/lambda-users.json) |
| Offers Lambda | `real-estate-prod-lambda-offers-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-offers.json`](policies/lambda-offers.json) |
| Files Lambda | `real-estate-prod-lambda-files-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-files.json`](policies/lambda-files.json) |
| Presigned Lambda | `real-estate-prod-lambda-presigned-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-presigned.json`](policies/lambda-presigned.json) |
| Mailer Lambda | `real-estate-prod-lambda-mailer-role` | `lambda.amazonaws.com` | log, [`lambda-mailer.json`](policies/lambda-mailer.json) |

"log" = `AWSLambdaBasicExecutionRole`, "VPC" = `AWSLambdaVPCAccessExecutionRole` (policy gestite AWS).
Dettagli in [`lambda.md`](lambda.md).

## Resource policy (chi può usare una risorsa)

| Risorsa | Chi ammette | File |
| --- | --- | --- |
| Le 5 Lambda di business | `apigateway.amazonaws.com`, solo la nostra API | [`lambda-allow-api-gateway.json`](resource-policies/lambda-allow-api-gateway.json) |
| Files Lambda | `s3.amazonaws.com`, solo il bucket dei file | [`lambda-files-allow-s3.json`](resource-policies/lambda-files-allow-s3.json) |
| Bucket del sito | `cloudfront.amazonaws.com`, solo la distribuzione del sito; nega le richieste senza TLS | [`s3-website-bucket-policy.json`](resource-policies/s3-website-bucket-policy.json) |
| Bucket dei file | `cloudfront.amazonaws.com`, solo la distribuzione dei file; nega le richieste senza TLS | [`s3-files-bucket-policy.json`](resource-policies/s3-files-bucket-policy.json) |
| Coda delle notifiche | `sns.amazonaws.com`, solo il nostro topic | [`sqs-notifications-queue-policy.json`](resource-policies/sqs-notifications-queue-policy.json) |
| Endpoint SNS (facoltativa) | solo `sns:Publish` sul nostro topic | [`vpc-endpoint-sns-policy.json`](resource-policies/vpc-endpoint-sns-policy.json) |

## Cosa non ha bisogno di ruoli

- **Secrets Manager**: il secret non assume ruoli; lo legge il ruolo del proxy.
- **Cognito** (solo user pool) e l'**authorizer JWT**: validano i token con le chiavi pubbliche.
- **CloudFront**: firma le richieste con OAC; il permesso sta nella bucket policy.
- **SQS → Mailer**: l'event source mapping usa il ruolo della Mailer.
- **SQS → DLQ**: lo spostamento lo fa SQS con la `RedrivePolicy`.
- **HTTP API → CloudWatch Logs**: basta indicare il log group dello stage.

La trust policy stabilisce **chi può assumere il ruolo**. La permissions policy
stabilisce **cosa può fare chi lo assume**. Sono documenti distinti.

## File

- [Aurora PostgreSQL](aurora.md)
- [RDS Proxy](rds-proxy.md)
- [Secrets Manager](secrets-manager.md)
- [Lambda: execution role](lambda.md)
- [API Gateway e Cognito](api-gateway.md)
- [S3 e CloudFront](s3-cloudfront.md)
- [Notifiche: SNS, SQS, SES](notifications.md)
- [Endpoint VPC e security group](vpc-endpoints.md)
- `trust-relationships/`: trust dei ruoli personalizzati.
- `policies/`: identity policy (permessi dei ruoli), più [`deploy-pass-role.json`](policies/deploy-pass-role.json)
  per l'identità di deploy.
- `resource-policies/`: policy attaccate alle risorse (Lambda, bucket, coda, endpoint).
- [`../config/`](../config/): configurazioni non IAM collegate (CORS, coda, notifiche S3, presigned POST).

I JSON sono template: sostituire tutti i segnaposto `<...>` prima dell'uso.
La regione dello schema è `eu-south-1`; confermarla prima del provisioning.
Account ID, ARN dei secret e della chiave KMS, ID del proxy e utenti PostgreSQL
devono provenire dalle risorse effettive. Non inserire password nei file Git.

## Ordine di configurazione

1. Creare il cluster, writer e replica nelle due AZ e verificare il ruolo di servizio RDS.
2. Creare gli utenti PostgreSQL applicativi e assegnare i relativi `GRANT`.
3. Creare un secret per ciascun utente, con credenziali corrispondenti a quelle del DB.
4. Creare il ruolo del proxy con trust RDS e policy di lettura dei secret.
5. Creare il proxy, associare ruolo e secret, registrare il cluster come target;
   richiedere IAM per le connessioni client e TLS.
6. Inserire l'ID del proxy nelle policy degli execution role delle Lambda autorizzate.
7. Configurare il client PostgreSQL nelle Lambda per token IAM e TLS verso il proxy.
8. Creare topic, coda e DLQ con le configurazioni di `config/`, la queue policy e la sottoscrizione.
9. Creare i bucket con Block Public Access, le distribuzioni CloudFront con OAC e le bucket policy;
   poi CORS e notifica S3 sul bucket dei file.
10. Creare l'HTTP API con l'authorizer JWT, le route, il CORS e i permessi di invocazione delle Lambda.

Per questo modello scegliere autenticazione del proxy basata su secret, con IAM
richiesto ai client; non scegliere `DefaultAuthScheme=IAM_AUTH`, che identifica
la diversa modalità IAM end-to-end.

I permessi di provisioning (`iam:PassRole`, creazione di ruoli, proxy, cluster e
secret) appartengono all'identità di deploy e non sono inclusi nei ruoli applicativi.
[`deploy-pass-role.json`](policies/deploy-pass-role.json) mostra la parte delicata: l'identità di deploy
può consegnare i ruoli del progetto solo a Lambda e RDS (`iam:PassedToService`), così non può
"prestare" un ruolo a un altro servizio.

## Verifica prima dell'utilizzo

- Nessun segnaposto residuo nei JSON da applicare.
- Ogni Lambda può collegarsi solo con il proprio utente autorizzato.
- Il proxy può leggere solo i secret associati; le Lambda non possono leggerli.
- I `GRANT` PostgreSQL consentono solo le operazioni previste per ciascun ambito.
- Security group: Lambda verso proxy e proxy verso Aurora su TCP 5432;
  il percorso applicativo non prevede accesso diretto Lambda verso Aurora.
- Verificare una connessione e il comportamento durante il failover del writer.

Subnet, security group ed endpoint sono descritti in [`vpc-endpoints.md`](vpc-endpoints.md);
permessi VPC e logging delle Lambda in [`lambda.md`](lambda.md).
