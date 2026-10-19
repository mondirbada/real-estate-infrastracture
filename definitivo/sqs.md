# SQS — coda delle notifiche e dead-letter queue

SQS è una coda di messaggi gestita. La coda `real-estate-prod-notifications-queue` riceve dal topic SNS gli eventi da
notificare e li tiene finché la Mailer Lambda non li ha elaborati; i messaggi che falliscono troppe volte finiscono nella
**dead-letter queue** `real-estate-prod-notifications-dlq`.

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Riceve da | [SNS](sns.md), topic `real-estate-prod-notifications` | sottoscrizione | queue policy (sotto) |
| Letta da | [Mailer Lambda](lambda-mailer.md) | event source mapping, a batch | ruolo della Mailer |
| Sposta in | DLQ `real-estate-prod-notifications-dlq` | dopo 5 ricezioni fallite | `RedrivePolicy`, nessun permesso IAM |
| Metriche verso | [CloudWatch](cloudwatch.md) | messaggi nella DLQ | allarme |

## Concetti

- **Coda standard** (la nostra): consegna *at-least-once*, ordine non garantito, scala quasi senza limiti. La **FIFO**
  garantisce ordine e deduplicazione con throughput minore; non serve per le email.
- **Visibility timeout**: quando un consumer prende un messaggio, questo diventa invisibile per N secondi; se non viene
  cancellato torna visibile e viene ritentato. Deve essere almeno pari al timeout della Lambda; AWS consiglia 6 volte.
- **Retention**: per quanto la coda tiene un messaggio (fino a 14 giorni). **Long polling**: la lettura aspetta che
  arrivino messaggi invece di rispondere vuota.
- **DLQ**: dopo `maxReceiveCount` tentativi falliti il messaggio va da parte per l'analisi, invece di tornare in coda
  all'infinito.
- Essendo *at-least-once*, il consumer deve essere **idempotente**.

## Configurazione

### Coda principale

| Attributo | Valore | Perché |
| --- | --- | --- |
| `VisibilityTimeout` | 180 s | 6 volte il timeout della Mailer (30 s), così un messaggio in lavorazione non torna visibile a metà |
| `MessageRetentionPeriod` | 345600 s (4 giorni) | — |
| `SqsManagedSseEnabled` | true | cifratura SSE-SQS (vedi sotto) |
| `RedrivePolicy` | DLQ dopo 5 ricezioni fallite (`maxReceiveCount`) | — |

File: [`config/sqs-notifications-queue-attributes.json`](config/sqs-notifications-queue-attributes.json)

```json
{
  "VisibilityTimeout": "180",
  "MessageRetentionPeriod": "345600",
  "SqsManagedSseEnabled": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\": \"arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-dlq\", \"maxReceiveCount\": \"5\"}"
}
```

### Dead-letter queue

| Attributo | Valore | Perché |
| --- | --- | --- |
| `MessageRetentionPeriod` | 1209600 s (14 giorni, il massimo) | tempo per analizzare i messaggi falliti |
| `SqsManagedSseEnabled` | true | SSE-SQS |
| `RedriveAllowPolicy` | `byQueue`, solo dalla coda principale | la DLQ accetta messaggi solo da questa coda |

File: [`config/sqs-notifications-dlq-attributes.json`](config/sqs-notifications-dlq-attributes.json)

```json
{
  "MessageRetentionPeriod": "1209600",
  "SqsManagedSseEnabled": "true",
  "RedriveAllowPolicy": "{\"redrivePermission\": \"byQueue\", \"sourceQueueArns\": [\"arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue\"]}"
}
```

`RedrivePolicy` e `RedriveAllowPolicy` sono **stringhe che contengono a loro volta un JSON**: è il formato che si
aspetta l'API di SQS.

### Cifratura: SSE-SQS e non `aws/sqs`

La coda è cifrata con **SSE-SQS**. Con la chiave KMS gestita da AWS `aws/sqs` SNS non potrebbe consegnarle i messaggi,
perché la key policy di quella chiave non ammette SNS e non si può modificare. In alternativa servirebbe una chiave KMS
del cliente con una key policy che ammetta `sns.amazonaws.com` ([kms.md](kms.md)).

## IAM

### Queue policy: solo il nostro topic può scrivere

File: [`iam/resource-policies/sqs-notifications-queue-policy.json`](iam/resource-policies/sqs-notifications-queue-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowNotificationsTopicOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications"
        }
      }
    }
  ]
}
```

- Principal `sns.amazonaws.com`, azione `sqs:SendMessage` sulla sola coda.
- Condizione `ArnEquals aws:SourceArn` = ARN del topic `real-estate-prod-notifications`: nessun altro topic, nemmeno di
  un altro account, può scrivere nella coda (*confused deputy*).

### Chi legge

La Mailer, tramite l'event source mapping, con il **proprio ruolo**: `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
`sqs:GetQueueAttributes` sulla coda ([lambda-mailer.md](lambda-mailer.md#iam)). Sulla coda non serve altro.

### Cosa non serve

Lo spostamento nella DLQ lo fa SQS secondo la `RedrivePolicy` (`deadLetterTargetArn`, `maxReceiveCount`): nessun
permesso IAM.

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group, nessun endpoint (la Mailer è fuori dalla VPC).
- Cifratura a riposo SSE-SQS su coda e DLQ.

## Costi

Per richiesta, con un livello gratuito che basta al progetto.

## Riferimenti

- [Dead-letter queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Cifratura con code SQS sottoscritte](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)

## All'orale

> **Cos'è il visibility timeout e perché 180 secondi?**
> Il tempo in cui un messaggio preso da un consumer resta invisibile agli altri. 180 s sono 6 volte il timeout della
> Mailer, come consiglia AWS: un messaggio non torna in coda mentre è ancora in lavorazione.
>
> **A cosa serve la DLQ?**
> Dopo 5 tentativi falliti il messaggio va da parte invece di ripetersi all'infinito; un allarme su "DLQ non vuota" ci
> avvisa. È come una coda di errori in RabbitMQ.
>
> **Chi sposta il messaggio nella DLQ?**
> SQS stesso, con la `RedrivePolicy`: nessun ruolo o permesso.
>
> **Perché la queue policy ha `aws:SourceArn`?**
> Senza, qualunque topic SNS, anche di un altro account, potrebbe scrivere nella nostra coda.
>
> **Perché SSE-SQS e non la chiave `aws/sqs`?**
> La key policy di `aws/sqs` non ammette SNS e non si può modificare: SNS non consegnerebbe.
>
> **Perché il consumer deve essere idempotente?**
> La coda standard consegna almeno una volta: lo stesso messaggio può arrivare due volte.
