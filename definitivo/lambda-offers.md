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
| `POST /properties/{id}/offers` | JWT | utente attivo; gruppo `buyer`; immobile `active` (altrimenti 409) |
| `GET /offers` | JWT | chi ha fatto l'offerta o il proprietario dell'immobile |
| `PUT /offers/{id}` (accetta o rifiuta) | JWT | utente attivo; chi ha fatto l'offerta o il proprietario dell'immobile; offerta `pending` (altrimenti 409) |
| `DELETE /offers/{id}` (ritiro) | JWT | utente attivo; chi ha fatto l'offerta o il proprietario dell'immobile; offerta `pending` (altrimenti 409) |

"Utente attivo": la riga `users` del `sub` non ha `deleted_at`, altrimenti 403 (`requireActiveUser`,
[api-gateway.md](api-gateway.md#authorizer-jwt)).

### Stato di un'offerta

`offers.status` vale `pending` (in sospeso), `accepted`, `rejected` o `withdrawn` (ritirata). Il ritiro con
`DELETE /offers/{id}` non toglie la riga: la porta a `withdrawn`. Solo un'offerta `pending` cambia stato; le altre sono
chiuse.

Un'offerta in sospeso passa a `withdrawn` anche quando uno dei due utenti cancella l'account: lo fa la Users Lambda,
nella transazione di `DELETE /users/me`, per le offerte fatte da lui e per quelle ricevute sui suoi immobili, e
pubblica un evento `OFFER_WITHDRAWN` verso l'altra parte
([lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)). Le offerte già accettate o rifiutate
restano come sono.

Una nuova offerta pubblica un evento per il proprietario dell'immobile; l'accettazione o il rifiuto un evento per
l'acquirente. L'evento porta il destinatario come `recipientSub` (il `owner_id` dell'immobile o il `sub` di chi ha fatto
l'offerta, letti dal database) e i dati dell'offerta, **non l'email** ([sns.md](sns.md#formato-degli-eventi)). Chi fa
l'offerta è sempre il `sub` dei claim, mai un campo del body.

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
> Access token all'HTTP API, authorizer JWT, invocazione della Offers (resource policy), controllo del gruppo `buyer`,
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
> La Offers legge dal database il `owner_id` dell'immobile, cioè il `sub` del proprietario, e pubblica l'evento "nuova
> offerta" con `recipientSub`. La Mailer chiede a Cognito l'email di quel `sub` con `AdminGetUser` e la invia con SES.
> L'email non passa mai dalla Offers né dal database.
