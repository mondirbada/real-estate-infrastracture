# Users Lambda — `real-estate-prod-users`

Gestisce il profilo applicativo degli utenti nel database: crea o aggiorna la riga dopo ogni login, la restituisce, la
cancella o anonimizza quando l'utente elimina l'account, e mostra il profilo pubblico degli agenti. L'account Cognito
non lo tocca: lo gestisce il frontend. Sta nella VPC perché usa il database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [API Gateway](api-gateway.md) | route `/users`, invocazione sincrona |
| Chiama | [RDS Proxy](rds-proxy.md) → [Aurora](aurora.md) | PostgreSQL 5432, TLS, token IAM come `users_user` |
| Chiama | [SNS](sns.md) | `sns:Publish` tramite l'[interface endpoint SNS](vpc-endpoints.md) (per esempio il benvenuto) |
| **Non** chiama | [Cognito](cognito.md) | le operazioni sull'account le fa la SPA |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-users` |

Regole comuni: [lambda.md](lambda.md).

## Cosa fa

| Route | Accesso | Cosa fa |
| --- | --- | --- |
| `PUT /users/me` | JWT | Chiamata dalla SPA dopo ogni login: crea o aggiorna la riga con il solo `sub` preso dai claim (più gli eventuali dati di profilo applicativi del body); alla prima creazione pubblica l'evento di benvenuto |
| `GET /users/me` | JWT | Restituisce il profilo dell'utente |
| `DELETE /users/me` | JWT | Cancella o anonimizza i dati applicativi; poi la SPA chiama `DeleteUser` su Cognito |
| `GET /users/{id}` | pubblica | Profilo pubblico dell'agente |

Eventi interni del router: per esempio `UpdateUserInformation` e `DeleteUser`, che lavorano solo sui dati del database.

Se la cancellazione su Cognito fallisce dopo `DELETE /users/me`, l'account esiste ancora e l'utente può ripeterla; se
intanto rientra, `PUT /users/me` gli ricrea un profilo vuoto.

**L'email non passa da qui.** L'API riceve l'access token, che non contiene l'email
([cognito.md](cognito.md#decisione-allapi-va-laccess-token)), e la tabella `users` non ha la colonna email
([aurora.md](aurora.md#dati-personali-niente-email-nel-database)). L'evento di benvenuto porta solo `recipientSub`:
l'indirizzo lo legge la Mailer da Cognito al momento dell'invio ([lambda-mailer.md](lambda-mailer.md#da-dove-arriva-lemail)).

## Configurazione

- Nella VPC, subnet A e B, security group `sg-lambda-internal` ([vpc.md](vpc.md)).
- Utente PostgreSQL `users_user`.
- Nessun trigger Cognito: la riga nasce alla prima chiamata `PUT /users/me`.

## IAM

Ruolo `real-estate-prod-lambda-users-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json), policy gestite
`AWSLambdaBasicExecutionRole` e `AWSLambdaVPCAccessExecutionRole`, più:

File: [`iam/policies/lambda-users.json`](iam/policies/lambda-users.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsUsersUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/users_user"
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

- `ConnectToProxyAsUsersUser`: entrare nel proxy solo come `users_user`.
- `PublishNotificationEvents`: pubblicare sul topic delle notifiche.
- **Nessun permesso su Cognito**: le operazioni sull'account le fa il frontend, e dalla VPC Cognito non sarebbe
  comunque raggiungibile.

Chi la può invocare: API Gateway ([`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json),
`<FUNCTION_NAME>` = `real-estate-prod-users`).

## Sicurezza e rete

- In uscita: 5432 verso `sg-rds-proxy`, 443 verso `sg-endpoint-sns`.
- Il `sub` si prende dai claim validati dall'authorizer, mai dal body della richiesta; un `sub` o un'email nel body
  vengono ignorati.

## All'orale

> **Come nasce la riga dell'utente nel database senza un trigger Cognito?**
> Dopo ogni login la SPA chiama `PUT /users/me`: la Lambda crea o aggiorna la riga con il `sub` dei claim. È un upsert
> idempotente, come un `save()` di Spring Data su una chiave che arriva dal `SecurityContext`.
>
> **Perché la Lambda non cancella l'utente da Cognito?**
> Sta in una VPC senza Internet e senza endpoint per Cognito. La SPA cancella prima i dati con `DELETE /users/me` e poi
> l'account con `DeleteUser`.
>
> **Dove salvate l'email dell'utente?**
> Da nessuna parte nel database: sta solo in Cognito. La riga in `users` ha il `sub`; quando serve un'email la Mailer la
> chiede a Cognito con `AdminGetUser`. Meno dati personali da proteggere e nessuna copia da riallineare quando cambia.
>
> **Il benvenuto come sa a chi scrivere?**
> L'evento contiene `recipientSub`, cioè il `sub` del nuovo utente; l'indirizzo lo trova la Mailer.
>
> **Cosa succede se `DeleteUser` fallisce dopo `DELETE /users/me`?**
> L'account resta e l'utente può riprovare; se rientra, `PUT /users/me` gli ricrea un profilo vuoto.
