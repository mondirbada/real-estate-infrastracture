# CloudWatch — log, metriche, allarmi

CloudWatch raccoglie i log di tutte le Lambda e dell'HTTP API e le metriche dei servizi, e fa scattare gli allarmi
minimi del progetto. Gli allarmi avvisano il team con un'email, tramite il topic SNS `real-estate-prod-ops-alerts`.

## Collegamenti

| Da / verso | Cosa | Come |
| --- | --- | --- |
| Tutte le [Lambda](lambda.md) → CloudWatch | log (log group `/aws/lambda/<nome>`), metriche (invocazioni, errori, durata, throttles) | permessi `logs:*` di `AWSLambdaBasicExecutionRole` |
| [API Gateway](api-gateway.md) → CloudWatch | access log dello stage | log group indicato nello stage |
| [Aurora](aurora.md) → CloudWatch | metriche CPU e connessioni | automatiche |
| [SQS](sqs.md) → CloudWatch | metriche della coda e della DLQ (`ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage`) | automatiche |
| CloudWatch → SNS | allarmi verso il topic `real-estate-prod-ops-alerts` | azione dell'allarme |
| SNS → team | email | sottoscrizione email del topic, confermata da chi la riceve |

## Cos'è

- **Logs**: log group per servizio; **Logs Insights** per fare query sui log.
- **Metrics**: serie numeriche dei servizi.
- **Metric filter**: trasforma le righe di log che corrispondono a un filtro in una metrica, su cui si può mettere un
  allarme. È il modo di contare eventi che esistono solo nei log, come un errore permanente della Mailer.
- **Alarms**: una soglia su una metrica che fa scattare un'azione (per esempio una notifica).
- **Dashboards**: viste con più metriche.

## Configurazione

### Allarmi

| Allarme | Metrica | Condizione | Perché |
| --- | --- | --- | --- |
| Messaggi nella DLQ | `ApproximateNumberOfMessagesVisible` di `real-estate-prod-notifications-dlq` | massimo > 0, periodo 5 min, 1 datapoint | un'email non è partita dopo 5 ricezioni: va seguita la [procedura](sqs.md#procedura-operativa-quando-scatta-lallarme) |
| Messaggi vecchi in coda | `ApproximateAgeOfOldestMessage` di `real-estate-prod-notifications-queue` | > 900 s, periodo 5 min | i messaggi si accumulano: la Mailer è ferma o in throttling |
| Errori permanenti della Mailer | metric filter `MailerPermanentFailures` sui log della Mailer | somma > 0, periodo 5 min | email scartate senza ritentare (messaggio malformato, email non verificata, `MessageRejected`): non arrivano nella DLQ |
| Errori delle Lambda | `Errors` di ciascuna funzione | > 0 | |
| CPU di Aurora | `CPUUtilization` | soglia da fissare | |
| Connessioni di Aurora | connessioni al database | soglia da fissare | |
| Pulizia dei file non riuscita | metric filter sul log group della Property Lambda per `FILES_CLEANUP_FAILED` > 0 | | [lambda-property.md](lambda-property.md#cancellazione-di-un-immobile) |

Tutti gli allarmi hanno come azione il topic `real-estate-prod-ops-alerts`. Quello della DLQ manda anche il ritorno a
`OK`, così il team sa quando la DLQ è stata svuotata.

Allarme sulla DLQ:

File: [`config/cloudwatch-alarm-notifications-dlq.json`](config/cloudwatch-alarm-notifications-dlq.json) (parametri di `PutMetricAlarm`)

```json
{
  "AlarmName": "real-estate-prod-notifications-dlq-not-empty",
  "AlarmDescription": "Almeno un messaggio nella DLQ delle notifiche: un'email non inviata dopo 5 ricezioni. Procedura in sqs.md, sezione Procedura operativa.",
  "Namespace": "AWS/SQS",
  "MetricName": "ApproximateNumberOfMessagesVisible",
  "Dimensions": [
    {
      "Name": "QueueName",
      "Value": "real-estate-prod-notifications-dlq"
    }
  ],
  "Statistic": "Maximum",
  "Period": 300,
  "EvaluationPeriods": 1,
  "DatapointsToAlarm": 1,
  "Threshold": 0,
  "ComparisonOperator": "GreaterThanThreshold",
  "TreatMissingData": "notBreaching",
  "AlarmActions": [
    "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-ops-alerts"
  ],
  "OKActions": [
    "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-ops-alerts"
  ]
}
```

- `Maximum` > 0 su 5 minuti con un solo datapoint: basta un messaggio per far scattare l'allarme.
- `TreatMissingData: notBreaching`: se la metrica non ha dati (coda vuota e inattiva), l'allarme resta `OK`.

### Metric filter degli errori permanenti

La Mailer scrive log in JSON; per gli errori permanenti scrive `level = "ERROR"` e `code = "MAIL_PERMANENT_FAILURE"`
([lambda-mailer.md](lambda-mailer.md#classificazione-degli-errori)). Il metric filter conta quelle righe. Le notifiche
a un utente che ha cancellato l'account sono un caso previsto, loggate a livello `INFO` con un altro codice, e non
contano.

File: [`config/cloudwatch-metric-filter-mailer-permanent-failures.json`](config/cloudwatch-metric-filter-mailer-permanent-failures.json) (parametri di `PutMetricFilter`)

```json
{
  "logGroupName": "/aws/lambda/real-estate-prod-mailer",
  "filterName": "real-estate-prod-mailer-permanent-failures",
  "filterPattern": "{ $.level = \"ERROR\" && $.code = \"MAIL_PERMANENT_FAILURE\" }",
  "metricTransformations": [
    {
      "metricNamespace": "RealEstate/Notifications",
      "metricName": "MailerPermanentFailures",
      "metricValue": "1",
      "defaultValue": 0
    }
  ]
}
```

### Topic `real-estate-prod-ops-alerts`

| Voce | Valore |
| --- | --- |
| Topic | `real-estate-prod-ops-alerts` (standard), separato dal topic delle notifiche agli utenti |
| Sottoscrizione | protocollo email, l'indirizzo del team; va confermata dal link che SNS invia |
| Cifratura | nessuna chiave KMS del cliente |

È un topic diverso da `real-estate-prod-notifications` perché ha un altro pubblico (il team, non gli utenti) e un altro
pubblicatore (CloudWatch, non le Lambda).

## IAM

- **Lambda → Logs**: la policy gestita `AWSLambdaBasicExecutionRole` di ogni execution role crea il log group e ci
  scrive (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`) ([lambda.md](lambda.md#policy-gestite-da-aws)).
- **HTTP API → Logs**: basta indicare il log group nelle impostazioni di accesso dello stage. Il ruolo CloudWatch a
  livello account (`AmazonAPIGatewayPushToCloudWatchLogs`) serve solo alle REST API ([api-gateway.md](api-gateway.md#cosa-non-serve)).
- **Allarme → topic SNS**: nessun ruolo. Con un topic nello **stesso account** e senza chiave KMS del cliente, la
  procedura di AWS (creare il topic, sottoscriverlo, sceglierlo nell'allarme) non richiede una topic policy. Se la si
  scrive, per esempio per un topic in un altro account, AWS raccomanda di ammettere `cloudwatch.amazonaws.com` con
  `aws:SourceArn` (gli allarmi del nostro account) e `aws:SourceAccount`, contro il *confused deputy*. Con un topic
  cifrato da una chiave del cliente servirebbe anche la key policy che ammetta CloudWatch.
- **Operatore → log della Mailer**: `logs:FilterLogEvents` nella policy [`ops-dlq-redrive.json`](iam/policies/ops-dlq-redrive.json),
  per la procedura sulla DLQ ([sqs.md](sqs.md#chi-fa-il-redrive-loperatore)).

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group.
- Le Lambda nella VPC senza Internet scrivono i log lo stesso: li invia il servizio Lambda, non la rete della funzione.
  Non serve un endpoint per CloudWatch Logs.
- Nei log della Mailer non si scrivono indirizzi email: bastano `messageId` ed `eventId`.

## Costi

Ingestione e conservazione dei log, metric filter e allarmi: pochi centesimi con i volumi del progetto. Le email di SNS
verso il team rientrano nel livello gratuito.

## Riferimenti

- [Log delle HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)
- [Notifiche SNS degli allarmi e confused deputy](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)
- [Allarmi per le DLQ di SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html)

## All'orale

> **Come monitorate che il sistema funziona?**
> Log di tutte le Lambda e dell'API, allarmi su errori delle Lambda, DLQ non vuota, messaggi vecchi in coda, errori
> permanenti della Mailer, CPU e connessioni di Aurora. È l'equivalente di Actuator più un sistema di log centralizzato.
>
> **Chi riceve gli allarmi?**
> Il team, per email: gli allarmi pubblicano sul topic SNS `real-estate-prod-ops-alerts`, che ha una sottoscrizione
> email. È un topic separato da quello delle notifiche agli utenti.
>
> **Serve una topic policy perché CloudWatch pubblichi sul topic?**
> Non con un topic dello stesso account senza chiave KMS del cliente. Se la scrivessimo, ammetteremmo
> `cloudwatch.amazonaws.com` con `aws:SourceArn` e `aws:SourceAccount`, come per le altre resource policy.
>
> **Un'email scartata perché l'indirizzo non è verificato come la vedete, se non va nella DLQ?**
> Con un metric filter sui log della Mailer, che conta le righe `MAIL_PERMANENT_FAILURE`, e un allarme sulla metrica.
>
> **Le Lambda nella VPC come scrivono i log senza Internet?**
> Li invia il servizio Lambda; la funzione ha solo bisogno dei permessi `logs:*` nel ruolo.
>
> **Serve un ruolo per i log di API Gateway?**
> Per le HTTP API no, basta il log group nello stage; il ruolo a livello account è delle REST API.
>
> **Perché un allarme sulla DLQ?**
> Un messaggio nella DLQ è un'email non inviata dopo 5 ricezioni: qualcuno deve guardarla, correggere la causa e
> rimandarla con il redrive.
