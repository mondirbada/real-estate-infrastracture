# Notifiche: SNS → SQS → Mailer Lambda → SES

| Risorsa | Nome |
| --- | --- |
| Topic SNS | `real-estate-prod-notifications` |
| Coda SQS | `real-estate-prod-notifications-queue` |
| Dead-letter queue | `real-estate-prod-notifications-dlq` |
| Funzione | `real-estate-prod-mailer` (fuori VPC) |
| Identità SES | il mittente `<MAIL_FROM>` o il suo dominio, verificati |

## Chi autorizza ogni passaggio

| Passaggio | Meccanismo | File |
| --- | --- | --- |
| Lambda → SNS | Identity policy: `sns:Publish` sul topic, solo per Property, Users e Offers | [`lambda-property.json`](policies/lambda-property.json) e simili |
| Lambda → endpoint SNS | Security group dell'endpoint (443 da `sg-lambda-internal`); facoltativa una endpoint policy | [`vpc-endpoint-sns-policy.json`](resource-policies/vpc-endpoint-sns-policy.json) |
| SNS → SQS | **Queue policy**: principal `sns.amazonaws.com`, `sqs:SendMessage`, condizione `aws:SourceArn` = topic | [`sqs-notifications-queue-policy.json`](resource-policies/sqs-notifications-queue-policy.json) |
| SQS → DLQ | Nessun permesso IAM: lo spostamento lo fa SQS secondo la `RedrivePolicy` | [`config/sqs-notifications-queue-attributes.json`](../config/sqs-notifications-queue-attributes.json) |
| SQS → Mailer | Event source mapping, che usa il **ruolo della Mailer** (`ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`) | [`lambda-mailer.json`](policies/lambda-mailer.json) |
| Mailer → SES | Identity policy: `ses:SendEmail` con condizione `ses:FromAddress` | [`lambda-mailer.json`](policies/lambda-mailer.json) |

Il topic non ha bisogno di una policy aggiuntiva: quella di default permette di pubblicare alle
identità del nostro account, e il filtro vero lo fanno le identity policy delle Lambda.

## Configurazione della coda

- `VisibilityTimeout` 180 secondi: 6 volte il timeout della Mailer (30 s), come consiglia AWS, così un
  messaggio in lavorazione non torna visibile a metà.
- `RedrivePolicy`: dopo 5 ricezioni fallite il messaggio va nella DLQ. La DLQ conserva i messaggi
  14 giorni e accetta solo messaggi da questa coda (`RedriveAllowPolicy`).
- **Cifratura SSE-SQS** (`SqsManagedSseEnabled`). Non usare la chiave KMS gestita `aws/sqs`: la sua key
  policy non ammette SNS e non si può modificare, quindi SNS non riuscirebbe a consegnare. In
  alternativa servirebbe una chiave KMS del cliente con una key policy che ammetta `sns.amazonaws.com`.
- Sottoscrizione SNS con `RawMessageDelivery` attivo: la Mailer riceve il messaggio così come è stato
  pubblicato, senza la busta JSON di SNS.

## SES

- Il mittente (o il dominio, con DKIM) va verificato in `eu-south-1`.
- In **sandbox** si inviano email solo a indirizzi verificati, al massimo 200 al giorno: per la demo basta.
  Per l'uso reale si chiede l'accesso alla produzione.
- A Milano SES funziona via API (quella che usa la Mailer); l'interfaccia SMTP non è disponibile.

## Riferimenti

- [SNS verso SQS](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html)
- [Cifratura con code SQS sottoscritte](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)
- [Dead-letter queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Controllo degli accessi in SES](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html)
