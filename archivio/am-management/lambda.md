# Lambda: execution role

Ogni funzione ha il proprio execution role: è l'identità con cui il codice chiama gli altri
servizi AWS. Ruoli separati significano permessi minimi e log di audit chiari: se la Lambda
delle offerte venisse compromessa, non potrebbe cancellare file né leggere la coda delle email.

## Trust

Uguale per tutti i ruoli: [`lambda.json`](trust-relationships/lambda.json). Il servizio
`lambda.amazonaws.com` assume il ruolo a ogni avvio dell'ambiente di esecuzione e passa alla
funzione credenziali temporanee; nel codice non ci sono chiavi.

## Ruoli

| Funzione | Ruolo | In VPC | Policy gestite AWS | Policy del progetto |
| --- | --- | --- | --- | --- |
| `real-estate-prod-property` | `real-estate-prod-lambda-property-role` | sì | `AWSLambdaBasicExecutionRole`, `AWSLambdaVPCAccessExecutionRole` | [`lambda-property.json`](policies/lambda-property.json) |
| `real-estate-prod-users` | `real-estate-prod-lambda-users-role` | sì | come sopra | [`lambda-users.json`](policies/lambda-users.json) |
| `real-estate-prod-offers` | `real-estate-prod-lambda-offers-role` | sì | come sopra | [`lambda-offers.json`](policies/lambda-offers.json) |
| `real-estate-prod-files` | `real-estate-prod-lambda-files-role` | sì | come sopra | [`lambda-files.json`](policies/lambda-files.json) |
| `real-estate-prod-presigned` | `real-estate-prod-lambda-presigned-role` | sì | come sopra | [`lambda-presigned.json`](policies/lambda-presigned.json) |
| `real-estate-prod-mailer` | `real-estate-prod-lambda-mailer-role` | no | `AWSLambdaBasicExecutionRole` | [`lambda-mailer.json`](policies/lambda-mailer.json) |

Cosa concedono le policy del progetto:

| Ruolo | Azioni | Risorsa | Perché |
| --- | --- | --- | --- |
| property, users, offers | `rds-db:connect` | `dbuser:<prx-ID>/<utente>` del proprio utente PostgreSQL | Collegarsi al proxy con un token IAM |
| property, users, offers | `sns:Publish` | topic `real-estate-prod-notifications` | Pubblicare gli eventi da notificare via email |
| files | `rds-db:connect` | `dbuser:<prx-ID>/files_user` | Registrare e cancellare i metadati dei file |
| files | `s3:DeleteObject` | `real-estate-prod-files-<SUFFIX>/uploads/*` | Cancellare un file (passa dal gateway endpoint S3) |
| presigned | `rds-db:connect` | `dbuser:<prx-ID>/presigned_user` | Controllare che l'utente sia il proprietario dell'immobile |
| presigned | `s3:PutObject` | `real-estate-prod-files-<SUFFIX>/uploads/*` | Firmare il presigned POST |
| mailer | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` | coda `real-estate-prod-notifications-queue` | Le azioni che servono all'event source mapping per leggere la coda |
| mailer | `ses:SendEmail` con condizione `ses:FromAddress` | `identity/*` della regione | Inviare email solo dal mittente del progetto |

Le policy gestite:
- `AWSLambdaBasicExecutionRole`: crea il log group della funzione e ci scrive (`logs:CreateLogGroup`,
  `logs:CreateLogStream`, `logs:PutLogEvents`).
- `AWSLambdaVPCAccessExecutionRole`: crea e rimuove le interfacce di rete (ENI) nelle subnet
  private. Le azioni `ec2:*NetworkInterface*` non si possono limitare a una risorsa, quindi
  hanno `Resource: "*"`: è il motivo per cui usiamo la policy gestita invece di riscriverla.

## Note sui permessi

- **Presigned POST.** Un presigned POST ha al massimo i permessi di chi lo firma: con `s3:PutObject`
  solo su `uploads/*`, nessun URL generato può scrivere altrove. Dimensione e tipo del file
  non si limitano con IAM ma con le *conditions* del POST (vedi
  [`config/presigned-post-conditions.json`](../config/presigned-post-conditions.json)).
- **Files.** Non ha `s3:GetObject`: i dati che le servono (chiave e dimensione) arrivano
  nell'evento della notifica S3.
- **Users.** Non ha permessi su Cognito: le operazioni sull'account le fa il frontend
  direttamente con Cognito.
- **Mailer.** `ses:SendEmail` ha come risorse tutte le identità SES dell'account (in sandbox anche
  i destinatari sono identità verificate), ma la condizione `ses:FromAddress` permette di inviare
  solo da `<MAIL_FROM>`.
- **Utenti PostgreSQL.** Uno per funzione con accesso al DB (`property_user`, `users_user`,
  `offers_user`, `files_user`, `presigned_user`), ciascuno con il suo secret letto dal proxy
  e i suoi `GRANT`. IAM decide chi entra nel proxy e con quale utente; i `GRANT` decidono cosa
  quell'utente può fare sulle tabelle.

## Chi può invocare le funzioni

Non è un permesso del ruolo ma una **resource-based policy sulla funzione**: vedi
[`api-gateway.md`](api-gateway.md) (le 5 Lambda di business) e [`s3-cloudfront.md`](s3-cloudfront.md)
(la notifica S3 verso la Files). La Mailer non ne ha bisogno: la coda la legge l'event source
mapping con il ruolo della Mailer stessa.

## Riferimenti

- [Execution role di Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
- [Lambda in VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Lambda con SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
