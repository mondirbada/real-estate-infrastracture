# Mailer Lambda — `real-estate-prod-mailer`

Consuma la coda delle notifiche e invia le email con SES. L'evento contiene già destinatario e dati dell'email, quindi
non le serve il database: per questo sta **fuori dalla VPC**.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [SQS](sqs.md), coda `real-estate-prod-notifications-queue` | event source mapping: il servizio Lambda legge la coda a batch e invoca la funzione |
| Chiama | [SES](ses.md) | `ses:SendEmail` via API, dal mittente `<MAIL_FROM>` |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-mailer` |

A monte: le Lambda Property, Users, Offers → [SNS](sns.md) → SQS. Regole comuni: [lambda.md](lambda.md).

## Cosa fa

1. L'event source mapping fa *polling* della coda e invoca la Mailer con un **batch** di messaggi.
2. Per ogni messaggio la Mailer compone l'email e chiama SES.
3. Se l'invocazione riesce, l'event source mapping cancella i messaggi dalla coda; se fallisce, tornano visibili dopo il
   visibility timeout e vengono ritentati; dopo 5 ricezioni fallite finiscono nella DLQ ([sqs.md](sqs.md)).
   Con le *partial batch responses* si può evitare di ripetere l'intero batch.

La consegna è *at-least-once*: lo stesso messaggio può arrivare due volte, quindi la Mailer deve essere **idempotente**
(gestire un duplicato senza danni).

## Configurazione

- **Fuori dalla VPC**: nessuna subnet né security group; raggiunge SES sulla rete di AWS senza endpoint.
- **Timeout 30 secondi**: la coda ha visibility timeout 180 s, cioè 6 volte, come consiglia AWS.
- Riceve il messaggio così come è stato pubblicato, senza la busta JSON di SNS (`RawMessageDelivery`, [sns.md](sns.md)).

## IAM

Ruolo `real-estate-prod-lambda-mailer-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json), policy gestita
`AWSLambdaBasicExecutionRole` (solo log: niente policy VPC perché è fuori dalla VPC), più:

File: [`iam/policies/lambda-mailer.json`](iam/policies/lambda-mailer.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeNotificationQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue"
    },
    {
      "Sid": "SendEmailFromProjectAddressOnly",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:eu-south-1:<ACCOUNT_ID>:identity/*",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "<MAIL_FROM>"
        }
      }
    }
  ]
}
```

- `ConsumeNotificationQueue`: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` solo sulla coda del
  progetto. Sono le azioni che servono all'event source mapping, che legge la coda **con il ruolo della Mailer**.
- `SendEmailFromProjectAddressOnly`: `ses:SendEmail` ha come risorse tutte le identità SES dell'account
  (`identity/*`), perché in sandbox anche i destinatari sono identità verificate; la condizione `ses:FromAddress`
  permette di inviare solo da `<MAIL_FROM>`.

Chi la può invocare: **nessuna resource policy**. Non la invoca un servizio esterno: l'event source mapping è una
risorsa del servizio Lambda che usa il ruolo della funzione stessa.

## Sicurezza e rete

- Non ha accesso al database né permessi di pubblicazione: se compromessa, può solo leggere quella coda e inviare email
  da quel mittente.
- Fuori dalla VPC: meno cold start, nessun endpoint per SQS e SES, meno costi.

## All'orale

> **Perché la Mailer è fuori dalla VPC?**
> Non usa il database. In VPC servirebbero endpoint per SES (e SQS) e avrebbe più cold start, senza alcun vantaggio.
>
> **Chi legge la coda: la Lambda o SQS?**
> Il servizio Lambda, con l'event source mapping, usando il ruolo della Mailer. Per questo il ruolo ha
> `ReceiveMessage`, `DeleteMessage` e `GetQueueAttributes`, e non serve una resource policy sulla funzione. È simile a
> un `@KafkaListener` o `@RabbitListener` gestito dal framework.
>
> **Perché deve essere idempotente?**
> Perché SQS standard consegna almeno una volta: lo stesso messaggio può arrivare due volte.
>
> **Cosa succede se va in timeout?**
> I messaggi non vengono cancellati, tornano visibili dopo 180 secondi e vengono ritentati; dopo 5 tentativi vanno nella
> DLQ e scatta l'allarme.
>
> **Come limitate da chi parte l'email?**
> Con la condizione `ses:FromAddress = <MAIL_FROM>` su `ses:SendEmail`.
