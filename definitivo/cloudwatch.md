# CloudWatch — log, metriche, allarmi

CloudWatch raccoglie i log di tutte le Lambda e dell'HTTP API e le metriche dei servizi, e fa scattare gli allarmi
minimi del progetto.

## Collegamenti

| Da | Cosa arriva | Come |
| --- | --- | --- |
| Tutte le [Lambda](lambda.md) | log (log group `/aws/lambda/<nome>`), metriche (invocazioni, errori, durata, throttles) | permessi `logs:*` di `AWSLambdaBasicExecutionRole` |
| [API Gateway](api-gateway.md) | access log dello stage | log group indicato nello stage |
| [Aurora](aurora.md) | metriche CPU e connessioni | automatiche |
| [SQS](sqs.md) | metriche della coda e della DLQ (`ApproximateNumberOfMessagesVisible`) | automatiche |

## Cos'è

- **Logs**: log group per servizio; **Logs Insights** per fare query sui log.
- **Metrics**: serie numeriche dei servizi.
- **Alarms**: una soglia su una metrica che fa scattare un'azione (per esempio una notifica).
- **Dashboards**: viste con più metriche.

## Configurazione

Allarmi minimi:

| Allarme | Metrica |
| --- | --- |
| Errori delle Lambda | `Errors` di ciascuna funzione |
| Messaggi nella DLQ | `ApproximateNumberOfMessagesVisible` di `real-estate-prod-notifications-dlq` > 0 |
| CPU di Aurora | `CPUUtilization` |
| Connessioni di Aurora | connessioni al database |

## IAM

- **Lambda → Logs**: la policy gestita `AWSLambdaBasicExecutionRole` di ogni execution role crea il log group e ci
  scrive (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`) ([lambda.md](lambda.md#policy-gestite-da-aws)).
- **HTTP API → Logs**: basta indicare il log group nelle impostazioni di accesso dello stage. Il ruolo CloudWatch a
  livello account (`AmazonAPIGatewayPushToCloudWatchLogs`) serve solo alle REST API ([api-gateway.md](api-gateway.md#cosa-non-serve)).

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group.
- Le Lambda nella VPC senza Internet scrivono i log lo stesso: li invia il servizio Lambda, non la rete della funzione.
  Non serve un endpoint per CloudWatch Logs.

## Costi

Ingestione e conservazione dei log e allarmi: pochi centesimi con i volumi del progetto.

## Riferimenti

- [Log delle HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)

## All'orale

> **Come monitorate che il sistema funziona?**
> Log di tutte le Lambda e dell'API, allarmi su errori delle Lambda, DLQ non vuota, CPU e connessioni di Aurora. È
> l'equivalente di Actuator più un sistema di log centralizzato.
>
> **Le Lambda nella VPC come scrivono i log senza Internet?**
> Li invia il servizio Lambda; la funzione ha solo bisogno dei permessi `logs:*` nel ruolo.
>
> **Serve un ruolo per i log di API Gateway?**
> Per le HTTP API no, basta il log group nello stage; il ruolo a livello account è delle REST API.
>
> **Perché un allarme sulla DLQ?**
> Un messaggio nella DLQ è un'email non inviata dopo 5 tentativi: qualcuno deve guardarla.
