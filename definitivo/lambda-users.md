# Users Lambda — `real-estate-prod-users`

Gestisce il profilo applicativo degli utenti nel database: crea o aggiorna la riga dopo ogni login, la restituisce,
la **anonimizza** quando l'utente elimina l'account (ritirando i suoi immobili e le offerte in sospeso), e mostra il
profilo pubblico degli agenti. L'account Cognito
non lo tocca: lo gestisce il frontend. Sta nella VPC perché usa il database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [API Gateway](api-gateway.md) | route `/users`, invocazione sincrona |
| Chiama | [RDS Proxy](rds-proxy.md) → [RDS for PostgreSQL](rds-postgres.md) | PostgreSQL 5432, TLS, token IAM come `users_user` |
| Chiama | [SNS](sns.md) | `sns:Publish` tramite l'[interface endpoint SNS](vpc-endpoints.md) (per esempio il benvenuto) |
| **Non** chiama | [Cognito](cognito.md) | le operazioni sull'account le fa la SPA |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-users` |

Regole comuni: [lambda.md](lambda.md).

## Cosa fa

| Route | Accesso | Cosa fa |
| --- | --- | --- |
| `PUT /users/me` | JWT | Chiamata dalla SPA dopo ogni login: crea o aggiorna la riga con il solo `sub` preso dai claim (più gli eventuali dati di profilo applicativi del body); alla prima creazione pubblica l'evento di benvenuto. Se la riga ha `deleted_at` risponde **410** e non la tocca |
| `GET /users/me` | JWT | Restituisce il profilo dell'utente; 410 se la riga ha `deleted_at` |
| `DELETE /users/me` | JWT | Anonimizza il profilo, ritira immobili e offerte in sospeso, in una transazione ([sotto](#cancellazione-dellaccount-anonimizzazione)); poi la SPA chiama `DeleteUser` su Cognito. Ripetuta su una riga già anonimizzata risponde 204 senza cambiare nulla |
| `GET /users/{id}` | pubblica | Profilo pubblico dell'agente; 404 se l'utente ha cancellato l'account |

Eventi interni del router: per esempio `UpdateUserInformation` e `DeleteUser`, che lavorano solo sui dati del database.

Se la cancellazione su Cognito fallisce dopo `DELETE /users/me`, l'account Cognito esiste ancora ma il profilo è già
anonimizzato: se l'utente rientra, `PUT /users/me` risponde 410 e la SPA riprova direttamente `DeleteUser`
([cognito.md](cognito.md#cancellazione-dellaccount)). Il profilo **non** si ricrea.

**L'email non passa da qui.** L'API riceve l'access token, che non contiene l'email
([cognito.md](cognito.md#decisione-allapi-va-laccess-token)), e la tabella `users` non ha la colonna email
([rds-postgres.md](rds-postgres.md#dati-personali-niente-email-nel-database)). L'evento di benvenuto porta solo `recipientSub`:
l'indirizzo lo legge la Mailer da Cognito al momento dell'invio ([lambda-mailer.md](lambda-mailer.md#da-dove-arriva-lemail)).

## Cancellazione dell'account: anonimizzazione

**Decisione:** alla cancellazione dell'account **anonimizziamo**. Immobili e offerte restano nel database, senza dati
personali; nulla viene cancellato con `DELETE`.

`DELETE /users/me` fa **una sola transazione**:

1. **La riga `users` resta con il solo `sub`.** Tutti i dati di profilo applicativi diventano `NULL` e si imposta
   `deleted_at = now()`. La riga resta perché le chiavi esterne di immobili e offerte (`owner_id`, `buyer_id`)
   continuano a puntare a una riga valida.
2. **Gli immobili dell'utente passano a `status = 'withdrawn'`** (ritirato): non compaiono negli elenchi pubblici, il
   dettaglio non mostra più il profilo dell'agente, non ricevono nuove offerte né upload
   ([lambda-property.md](lambda-property.md#immobili-ritirati)).
3. **Le offerte in sospeso** (`status = 'pending'`) fatte dall'utente, e quelle fatte da altri sui suoi immobili,
   passano a `status = 'withdrawn'`, lo stesso stato del ritiro con `DELETE /offers/{id}`
   ([lambda-offers.md](lambda-offers.md#stato-di-unofferta)). Le offerte già accettate o rifiutate restano come sono:
   sono storia, e senza dati personali.

Esempio della transazione (i nomi delle colonne di profilo sono d'esempio: il modello dati è ancora da fissare):

```sql
BEGIN;

-- 1. Il profilo: resta il solo sub, segnato come cancellato.
UPDATE users
   SET display_name = NULL,
       phone        = NULL,
       bio          = NULL,
       deleted_at   = COALESCE(deleted_at, now())
 WHERE sub = :sub;

-- 2. Gli immobili dell'utente: restano, ma ritirati.
UPDATE properties
   SET status = 'withdrawn'
 WHERE owner_id = :sub
   AND status = 'active';

-- 3. Le offerte in sospeso, fatte da lui o ricevute sui suoi immobili: ritirate.
UPDATE offers o
   SET status = 'withdrawn'
  FROM properties p
 WHERE p.id = o.property_id
   AND o.status = 'pending'
   AND (o.buyer_id = :sub OR p.owner_id = :sub)
RETURNING o.id, o.property_id, o.buyer_id, p.owner_id, p.title, o.amount;

COMMIT;
```

Se un passo fallisce si fa `ROLLBACK` e la Lambda risponde 500: non resta mai un profilo anonimizzato con immobili
ancora pubblici, o il contrario. Ripetere la chiamata è innocuo: `COALESCE` tiene la data della prima cancellazione e
le altre due `UPDATE` non trovano più righe da cambiare.

**Perché il `sub` da solo non è un dato riconducibile a una persona.** Il database non ha mai avuto l'email
([rds-postgres.md](rds-postgres.md#dati-personali-niente-email-nel-database)): l'unico legame tra il `sub` e una persona sta in
Cognito. Dopo `DeleteUser` quel legame sparisce, e il `sub` rimasto è uno pseudonimo che non punta più a nessuno. È
la minimizzazione già scelta per l'email che rende possibile anonimizzare cambiando poche colonne.
Un limite da dire: i backup automatici dell'istanza contengono ancora il profilo com'era fino alla fine della retention
(7 giorni: [rds-postgres.md](rds-postgres.md#configurazione)).

**Notifiche delle offerte ritirate.** Dopo il `COMMIT`, per ogni offerta restituita da `RETURNING` la Lambda pubblica
sul topic un evento `OFFER_WITHDRAWN` verso **l'altra parte**: il proprietario dell'immobile se l'offerta era
dell'utente che si cancella, l'acquirente se l'immobile era suo ([sns.md](sns.md#formato-degli-eventi)). Il
`recipientSub` dell'altra parte è ancora valido e la catena è quella di sempre (SNS → SQS → Mailer → SES), con il
permesso `sns:Publish` che la Users Lambda ha già. Motivo: senza l'evento l'altra parte vedrebbe sparire una trattativa
in corso senza saperlo; l'evento non contiene nulla dell'utente cancellato, solo immobile, offerta e importo. Nessun
evento verso l'utente stesso, che sta cancellando l'account. Se la pubblicazione fallisce dopo il commit la Lambda
scrive un errore nel log e risponde comunque 204: la cancellazione non dipende dalle email.

**I file su S3 restano** con l'immobile ritirato: le foto della casa non sono dati personali dell'utente, e la Users
Lambda non ha permessi su S3. Se si volesse toglierli, la strada è la logica della cancellazione di un immobile della
Property Lambda ([lambda-property.md](lambda-property.md#cancellazione-di-un-immobile)), per esempio lanciata
dall'`admin` sugli immobili ritirati: è tra gli sviluppi possibili.

**Permessi nel database.** La Users Lambda ora aggiorna anche lo stato di `properties` e `offers`: lo permettono i
`GRANT` di `users_user`, solo sulle colonne `status` ([rds-postgres.md](rds-postgres.md#utenti-postgresql)). **Nessun cambio IAM**:
IAM decide chi entra nel proxy e con quale utente, i `GRANT` cosa quell'utente fa sulle tabelle.

**Il token ancora valido dopo la cancellazione.** Un access token emesso prima di `DeleteUser` vale fino a 60 minuti e
l'authorizer non sa che l'utente non c'è più ([cognito.md](cognito.md#cancellazione-dellaccount)). Per questo:

- sulle route autenticate che scrivono, tutte le Lambda controllano con `requireActiveUser`
  ([api-gateway.md](api-gateway.md#authorizer-jwt)) che la riga `users` del `sub` non abbia `deleted_at`; altrimenti
  **403**;
- `PUT /users/me` e `GET /users/me` su una riga con `deleted_at` rispondono **410 Gone** e non ricreano il profilo.

Il rischio residuo si riduce così alle sole letture, che sono pubbliche o dell'utente stesso (e il suo profilo è già
vuoto).

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
- Nel database `users_user` non ha `DELETE` su nessuna tabella: l'anonimizzazione è fatta solo di `UPDATE`.

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
> L'account Cognito resta, il profilo è già anonimizzato. Se l'utente rientra, `PUT /users/me` risponde 410 e la SPA
> riprova direttamente `DeleteUser`; il profilo non si ricrea.
>
> **Cosa resta nel database dopo la cancellazione?**
> La riga `users` con il solo `sub` e `deleted_at`, gli immobili ritirati, le offerte ritirate o già chiuse. Nessun dato
> personale: l'email non c'è mai stata, e dopo `DeleteUser` il `sub` non porta più a nessuno.
>
> **Perché anonimizzare e non cancellare tutto?**
> Le offerte riguardano anche l'altra parte, che deve sapere com'è finita; e una cancellazione a cascata dalla Users
> Lambda lascerebbe i file su S3, che lei non può toccare. Anonimizzare è una transazione sola, senza S3.
