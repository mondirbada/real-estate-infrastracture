# Property Lambda — `real-estate-prod-property`

Gestisce gli annunci immobiliari: elenco e dettaglio (pubblici), creazione, modifica e cancellazione. Quando opportuno
pubblica un evento di notifica sul topic SNS. Sta nella VPC perché legge e scrive nel database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [API Gateway](api-gateway.md) | route `/properties`, invocazione sincrona |
| Chiama | [RDS Proxy](rds-proxy.md) → [Aurora](aurora.md) | PostgreSQL 5432, TLS, token IAM come `property_user` |
| Chiama | [SNS](sns.md) | `sns:Publish` tramite l'[interface endpoint SNS](vpc-endpoints.md) |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-property` |

Regole comuni (VPC, connessione al DB, policy gestite): [lambda.md](lambda.md).

## Cosa fa

| Route | Accesso | Cosa controlla la Lambda |
| --- | --- | --- |
| `GET /properties`, `GET /properties/{id}` | pubblica | — |
| `POST /properties` | JWT | gruppo `agent` in `cognito:groups`; il proprietario è il `sub` del token |
| `PUT /properties/{id}`, `DELETE /properties/{id}` | JWT | ownership (`WHERE id = :id AND owner_id = :sub`) oppure gruppo `admin` |

L'handler fa da router interno dello scope. Gli eventi pubblicati contengono già destinatario e dati dell'email, così la
Mailer non deve leggere il database.

## Configurazione

- Runtime nella VPC: subnet `private_subnet_A` e `private_subnet_B`, security group `sg-lambda-internal` ([vpc.md](vpc.md)).
- Connessione al proxy aperta fuori dall'handler, con token IAM e TLS.
- Utente PostgreSQL `property_user`, con i `GRANT` sulle tabelle degli annunci ([aurora.md](aurora.md#utenti-postgresql)).

## IAM

Ruolo `real-estate-prod-lambda-property-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json)
([lambda.md](lambda.md#execution-role)), policy gestite `AWSLambdaBasicExecutionRole` e
`AWSLambdaVPCAccessExecutionRole`, più:

File: [`iam/policies/lambda-property.json`](iam/policies/lambda-property.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsPropertyUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/property_user"
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

- `ConnectToProxyAsPropertyUser`: entrare nel proxy solo come `property_user`. La risorsa usa l'ID risorsa del proxy
  (`prx-...`), non il nome.
- `PublishNotificationEvents`: pubblicare solo sul topic `real-estate-prod-notifications`.

Chi la può invocare: API Gateway, con [`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json)
e `<FUNCTION_NAME>` = `real-estate-prod-property` ([api-gateway.md](api-gateway.md#iam)).

## Sicurezza e rete

- In uscita: 5432 verso `sg-rds-proxy`, 443 verso `sg-endpoint-sns`. Nessun accesso diretto ad Aurora.
- Non ha permessi su S3: i file degli annunci li gestiscono Presigned e Files.

## Punti aperti

- Cancellando un immobile, i suoi file restano su S3: accettato per il progetto
  ([decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#punti-aperti)).

## All'orale

> **Come evitate che un agente modifichi l'immobile di un altro?**
> La Lambda confronta il `sub` del token con il proprietario nel database (`WHERE id = :id AND owner_id = :sub`); se
> non coincide e l'utente non è `admin`, risponde 403. È il controllo che in Spring metteresti nel service.
>
> **Perché gli annunci si leggono senza login?**
> Un visitatore deve poter guardare gli immobili: le route `GET` sono pubbliche, tutte le altre chiedono il JWT.
>
> **Come pubblica una notifica se è in una VPC senza Internet?**
> Con `sns:Publish` attraverso l'interface endpoint SNS, con Private DNS: il codice usa il nome standard del servizio.
>
> **Cosa può fare questa Lambda nel database?**
> Entra nel proxy solo come `property_user`; cosa può fare sulle tabelle lo decidono i `GRANT` di quell'utente.
