# Offers Lambda — `real-estate-prod-offers`

Gestisce le offerte degli acquirenti sugli immobili: creazione, elenco, accettazione o rifiuto, ritiro. Pubblica gli
eventi da notificare (nuova offerta al proprietario, esito all'acquirente). Sta nella VPC perché usa il database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [API Gateway](api-gateway.md) | route delle offerte, invocazione sincrona |
| Chiama | [RDS Proxy](rds-proxy.md) → [Aurora](aurora.md) | PostgreSQL 5432, TLS, token IAM come `offers_user` |
| Chiama | [SNS](sns.md) | `sns:Publish` tramite l'[interface endpoint SNS](vpc-endpoints.md) |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-offers` |

Regole comuni: [lambda.md](lambda.md).

## Cosa fa

| Route | Accesso | Controllo |
| --- | --- | --- |
| `POST /properties/{id}/offers` | JWT | gruppo `buyer` |
| `GET /offers` | JWT | chi ha fatto l'offerta o il proprietario dell'immobile |
| `PUT /offers/{id}` (accetta o rifiuta) | JWT | chi ha fatto l'offerta o il proprietario dell'immobile |
| `DELETE /offers/{id}` | JWT | chi ha fatto l'offerta o il proprietario dell'immobile |

Una nuova offerta pubblica un evento per il proprietario dell'immobile; l'accettazione o il rifiuto un evento per
l'acquirente. L'evento contiene destinatario e dati dell'email ([sns.md](sns.md)).

## Configurazione

- Nella VPC, subnet A e B, security group `sg-lambda-internal` ([vpc.md](vpc.md)).
- Utente PostgreSQL `offers_user`.

## IAM

Ruolo `real-estate-prod-lambda-offers-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json), policy gestite
`AWSLambdaBasicExecutionRole` e `AWSLambdaVPCAccessExecutionRole`, più:

File: [`iam/policies/lambda-offers.json`](iam/policies/lambda-offers.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsOffersUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/offers_user"
    },
    {
      "Sid": "PublishNotificationEvents",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications"
    }
  ]
}
```

- `ConnectToProxyAsOffersUser`: entrare nel proxy solo come `offers_user`.
- `PublishNotificationEvents`: pubblicare solo sul topic `real-estate-prod-notifications`.
- Non ha permessi su S3 né sulla coda: se venisse compromessa non potrebbe cancellare file né leggere le email.

Chi la può invocare: API Gateway ([`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json),
`<FUNCTION_NAME>` = `real-estate-prod-offers`).

## Sicurezza e rete

- In uscita: 5432 verso `sg-rds-proxy`, 443 verso `sg-endpoint-sns`.
- La pubblicazione è asincrona rispetto all'email: la richiesta dell'utente non aspetta SES.

## All'orale

> **Seguimi "crea un'offerta" dal clic al database.**
> ID token all'HTTP API, authorizer JWT, invocazione della Offers (resource policy), controllo del gruppo `buyer`,
> token IAM e connessione TLS al proxy come `offers_user`, proxy → Aurora con la password del secret, poi `sns:Publish`
> sul topic attraverso l'endpoint SNS.
>
> **Cosa cambierebbe se la Offers fosse fuori dalla VPC?**
> Non raggiungerebbe l'RDS Proxy, che esiste solo nella VPC.
>
> **Perché l'email non la manda direttamente la Offers?**
> Per disaccoppiare: la risposta all'utente non aspetta SES, la coda trattiene i messaggi se SES è lento e ritenta. È
> come pubblicare un evento invece di chiamare il servizio email dentro la transazione.
>
> **Il proprietario come viene avvisato?**
> L'evento "nuova offerta" contiene la sua email (presa dal database, dove `PUT /users/me` l'ha salvata dall'ID token);
> la Mailer la invia con SES.
