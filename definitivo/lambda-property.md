# Property Lambda — `real-estate-prod-property`

Gestisce gli annunci immobiliari: elenco e dettaglio (pubblici), creazione, modifica e cancellazione. Quando opportuno
pubblica un evento di notifica sul topic SNS. Sta nella VPC perché legge e scrive nel database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [API Gateway](api-gateway.md) | route `/properties`, invocazione sincrona |
| Chiama | [RDS Proxy](rds-proxy.md) → [Aurora](aurora.md) | PostgreSQL 5432, TLS, token IAM come `property_user` |
| Chiama | [SNS](sns.md) | `sns:Publish` tramite l'[interface endpoint SNS](vpc-endpoints.md) |
| Chiama | [S3](s3.md), bucket dei file | `ListObjectsV2` e `DeleteObjects` sul prefisso `uploads/<propertyId>/`, tramite il [gateway endpoint S3](vpc-endpoints.md), solo quando cancella un immobile |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-property` |

Regole comuni (VPC, connessione al DB, policy gestite): [lambda.md](lambda.md).

## Cosa fa

| Route | Accesso | Cosa controlla la Lambda |
| --- | --- | --- |
| `GET /properties`, `GET /properties/{id}` | pubblica | l'elenco mostra solo gli immobili `active`; il dettaglio di uno ritirato non riporta l'agente ([sotto](#immobili-ritirati)) |
| `POST /properties` | JWT | utente attivo; gruppo `agent` in `cognito:groups`; il proprietario è il `sub` del token |
| `PUT /properties/{id}`, `DELETE /properties/{id}` | JWT | utente attivo; ownership (`WHERE id = :id AND owner_id = :sub`) oppure gruppo `admin`. Un immobile ritirato non si modifica (409); l'`admin` lo può cancellare |

"Utente attivo" vuol dire che la riga `users` del `sub` non ha `deleted_at`, altrimenti 403: è il controllo
`requireActiveUser` comune alle Lambda ([api-gateway.md](api-gateway.md#authorizer-jwt)).

L'handler fa da router interno dello scope. Gli eventi pubblicati portano il destinatario come `recipientSub` (il `sub`
del proprietario o dell'utente interessato) e i dati che servono all'email (per esempio titolo e ID dell'immobile), così
la Mailer non deve leggere il database. L'email del destinatario non c'è: la Mailer la chiede a Cognito
([sns.md](sns.md#formato-degli-eventi)).

### Cancellazione di un immobile

Cancellare un immobile vuol dire togliere la riga dal database **e** i suoi file da S3. Tutti i file di un immobile
stanno sotto lo stesso prefisso, perché la chiave la decide la Presigned Lambda: `uploads/<propertyId>/<uuid>.<ext>`.
`DELETE /properties/{id}` fa, in ordine:

1. Controlla l'ownership (o il gruppo `admin`); se non va, risponde 403 e non tocca niente.
2. Cancella l'immobile nel database. Le righe dei file dipendono dall'immobile con una chiave esterna
   `ON DELETE CASCADE`, quindi spariscono nella stessa transazione. In PostgreSQL il cascade gira con i permessi del
   proprietario della tabella: `property_user` non ha bisogno di `GRANT` sulle tabelle dei file.
3. Elenca gli oggetti sotto `uploads/<propertyId>/` (`ListObjectsV2`) e li cancella con `DeleteObjects` (fino a 1000
   chiavi per chiamata; si ripete finché il prefisso è vuoto). La chiamata passa dal gateway endpoint S3.
4. Risponde 204.

Perché si elenca il prefisso invece di leggere le chiavi dal database: così si cancellano anche i file caricati ma non
ancora registrati dalla Files Lambda.

Perché prima il database e poi S3: appena la riga sparisce l'immobile non è più visibile e la Presigned Lambda rifiuta
nuovi upload (il controllo di ownership non trova l'immobile). Al contrario, cancellando prima i file si potrebbe
ritrovarsi con un annuncio ancora pubblicato e senza foto.

Casi limite:

- **S3 non risponde dopo il commit nel database.** L'SDK ritenta da solo; se fallisce ancora la Lambda scrive nel log un
  errore con il `propertyId` (`FILES_CLEANUP_FAILED`), su cui c'è un allarme ([cloudwatch.md](cloudwatch.md)), e
  risponde comunque 204: l'immobile è cancellato. I file rimasti sono tutti sotto un prefisso noto e si tolgono
  rilanciando la pulizia per quel `propertyId`.
- **Un upload finisce mentre si cancella l'immobile** (presigned POST firmato poco prima, vale 5 minuti). Il file
  arriva su S3 dopo la pulizia; la Files Lambda prova a registrarlo, l'immobile non esiste più, e cancella l'oggetto
  ([lambda-files.md](lambda-files.md#cosa-fa)).
- **Cache di CloudFront.** Un file già in cache sugli edge può essere servito fino alla scadenza del TTL. Non si invalida
  dalla Lambda: l'API di CloudFront non è raggiungibile dalla VPC senza Internet, e il link non è più elencato da nessuna
  parte.

### Immobili ritirati

Un immobile ha `status` = `active` oppure `withdrawn` ([aurora.md](aurora.md#dati-personali-niente-email-nel-database)).
Oggi diventa `withdrawn` in un solo caso: quando il proprietario cancella l'account, e a cambiarlo è la Users Lambda
nella transazione di `DELETE /users/me` ([lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)).
Un immobile ritirato:

- **non compare** in `GET /properties` (`WHERE status = 'active'`);
- in `GET /properties/{id}` risponde con lo stato ritirato e **senza `owner_id`**: la SPA non mostra né collega il
  profilo dell'agente, che del resto `GET /users/{id}` non restituisce più (404);
- **non riceve nuove offerte** (la Offers risponde 409) **né upload** (la Presigned risponde 409);
- non si modifica con `PUT` (409). L'`admin` può cancellarlo con `DELETE`, che toglie anche i file da S3.

I suoi file restano su S3 e nel database: sono le foto della casa, non dati personali dell'utente.

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
    },
    {
      "Sid": "ListFilesOfDeletedProperty",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>",
      "Condition": {
        "StringLike": {
          "s3:prefix": "uploads/*"
        }
      }
    },
    {
      "Sid": "DeleteFilesOfDeletedProperty",
      "Effect": "Allow",
      "Action": "s3:DeleteObject",
      "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>/uploads/*"
    }
  ]
}
```

- `ConnectToProxyAsPropertyUser`: entrare nel proxy solo come `property_user`. La risorsa usa l'ID risorsa del proxy
  (`prx-...`), non il nome.
- `PublishNotificationEvents`: pubblicare solo sul topic `real-estate-prod-notifications`.
- `ListFilesOfDeletedProperty`: `s3:ListBucket` sul bucket dei file, solo per elencare chiavi sotto `uploads/`
  (condizione `s3:prefix`). `ListBucket` si concede sul **bucket**, non sugli oggetti: per questo ha un suo statement.
- `DeleteFilesOfDeletedProperty`: `s3:DeleteObject` solo su `uploads/*`. Serve anche per `DeleteObjects`, la
  cancellazione a blocchi: S3 controlla `s3:DeleteObject` per ogni chiave.
- Niente `s3:GetObject` né `s3:PutObject`: non legge né scrive file. Il limite al singolo immobile (`<propertyId>`) non
  si può scrivere in IAM, perché l'ID cambia a ogni richiesta: lo garantisce il controllo di ownership nel codice, come
  per la Files Lambda.

Chi la può invocare: API Gateway, con [`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json)
e `<FUNCTION_NAME>` = `real-estate-prod-property` ([api-gateway.md](api-gateway.md#iam)).

## Sicurezza e rete

- In uscita: 5432 verso `sg-rds-proxy`, 443 verso `sg-endpoint-sns`, 443 verso la prefix list di S3 (gateway
  endpoint). Nessun accesso diretto ad Aurora.
- Su S3 può solo elencare e cancellare sotto `uploads/`, e lo fa solo nella cancellazione di un immobile. Caricare
  file resta compito di Presigned, registrarli e cancellarli uno per uno di Files.

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
> **Cosa succede ai file quando si cancella un immobile?**
> La Lambda cancella la riga (le righe dei file spariscono in cascata) e poi tutti gli oggetti sotto
> `uploads/<propertyId>/` su S3, passando dal gateway endpoint. Prima il database, così l'annuncio sparisce subito e non
> si possono firmare nuovi upload; se S3 fallisce resta un errore nel log con l'allarme e un prefisso noto da ripulire.
>
> **Perché la Property ha `s3:ListBucket` sul bucket e `s3:DeleteObject` sugli oggetti?**
> Sono due livelli di risorsa diversi: elencare è un'azione sul bucket (`arn:aws:s3:::bucket`, limitata con
> `s3:prefix`), cancellare è un'azione sull'oggetto (`arn:aws:s3:::bucket/uploads/*`).
>
> **Cosa succede agli annunci di un agente che cancella l'account?**
> Restano nel database ritirati (`status = 'withdrawn'`): spariscono dagli elenchi, il dettaglio non mostra l'agente,
> non ricevono offerte né upload. Li ritira la Users Lambda nella stessa transazione che anonimizza il profilo.
>
> **Cosa può fare questa Lambda nel database?**
> Entra nel proxy solo come `property_user`; cosa può fare sulle tabelle lo decidono i `GRANT` di quell'utente.
