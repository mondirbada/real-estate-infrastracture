# Architettura — visione d'insieme

Piattaforma immobiliare serverless in `eu-south-1` (Milano). Il frontend è una SPA React servita da CloudFront; il
backend è un'HTTP API di API Gateway che invoca sei Lambda; i dati stanno in Aurora PostgreSQL dietro un RDS Proxy e i
file degli annunci in S3; le notifiche email passano da SNS, SQS e SES. Diagramma: [README](README.md#diagramma).

## Componenti

| Area | Servizio | Nome della risorsa | File |
| --- | --- | --- | --- |
| Frontend | CloudFront, distribuzione del sito | `<DIST_SITE_ID>` | [cloudfront.md](cloudfront.md) |
| Frontend | S3, bucket del sito | `real-estate-prod-website-<SUFFIX>` | [s3.md](s3.md) |
| Storage | CloudFront, distribuzione dei file | `<DIST_FILES_ID>` | [cloudfront.md](cloudfront.md) |
| Storage | S3, bucket dei file | `real-estate-prod-files-<SUFFIX>` | [s3.md](s3.md) |
| Routing & auth | Cognito user pool (gruppi `buyer`, `agent`, `admin`) | `<USER_POOL_ID>` | [cognito.md](cognito.md) |
| Routing & auth | API Gateway, HTTP API con authorizer JWT | `<API_ID>` | [api-gateway.md](api-gateway.md) |
| Business logic | Property Lambda | `real-estate-prod-property` | [lambda-property.md](lambda-property.md) |
| Business logic | Users Lambda | `real-estate-prod-users` | [lambda-users.md](lambda-users.md) |
| Business logic | Offers Lambda | `real-estate-prod-offers` | [lambda-offers.md](lambda-offers.md) |
| Business logic | Presigned Lambda | `real-estate-prod-presigned` | [lambda-presigned.md](lambda-presigned.md) |
| Business logic | Files Lambda | `real-estate-prod-files` | [lambda-files.md](lambda-files.md) |
| Notifiche | Mailer Lambda (fuori dalla VPC) | `real-estate-prod-mailer` | [lambda-mailer.md](lambda-mailer.md) |
| Rete | VPC con due subnet private | `real-estate-prod-vpc` | [vpc.md](vpc.md) |
| Rete | Endpoint VPC (SNS, Secrets Manager, S3) | — | [vpc-endpoints.md](vpc-endpoints.md) |
| Database | RDS Proxy | `real-estate-prod-db-proxy` | [rds-proxy.md](rds-proxy.md) |
| Database | Aurora PostgreSQL, writer + reader | `real-estate-prod-aurora` | [aurora.md](aurora.md) |
| Database | Secrets Manager, un secret per utente PostgreSQL | `real-estate/prod/database/<DB_USER>` | [secrets-manager.md](secrets-manager.md) |
| Sicurezza | KMS (chiavi di cifratura) | `aws/rds`, `aws/secretsmanager` | [kms.md](kms.md) |
| Notifiche | SNS, topic | `real-estate-prod-notifications` | [sns.md](sns.md) |
| Notifiche | SQS, coda e DLQ | `real-estate-prod-notifications-queue`, `real-estate-prod-notifications-dlq` | [sqs.md](sqs.md) |
| Notifiche | SES | mittente `<MAIL_FROM>` | [ses.md](ses.md) |
| Supporto | SNS, topic degli allarmi verso il team | `real-estate-prod-ops-alerts` | [cloudwatch.md](cloudwatch.md) |
| Supporto | CloudWatch | log group di Lambda e API | [cloudwatch.md](cloudwatch.md) |
| Supporto | IAM | ruoli `real-estate-prod-*` | [iam.md](iam.md) |

Tre idee tengono insieme il progetto:

1. **Frontend statico** (CloudFront + S3): nessun server, la logica di presentazione gira nel browser.
2. **Backend serverless** (API Gateway + Lambda): si paga per richiesta e AWS gestisce i server.
3. **Lo stato sta nei servizi di dati** (Aurora, S3), non nelle Lambda, che sono effimere.

## Dove vive ogni servizio

| Dove | Servizi | Conseguenza |
| --- | --- | --- |
| Globale | CloudFront, IAM | Nessuna regione da scegliere; il certificato ACM per CloudFront, se servisse, va in `us-east-1` |
| Regionale, **fuori** dalla VPC | S3, API Gateway, Cognito, SNS, SQS, SES, CloudWatch, Secrets Manager, la Mailer Lambda | Niente security group: si proteggono con **IAM** (identity policy e resource policy) |
| **Dentro** la VPC | Aurora, RDS Proxy, le ENI delle 5 Lambda di business, gli interface endpoint | Hanno security group; per raggiungere i servizi AWS servono gli endpoint VPC |

## Flussi end-to-end

### 1. Navigazione del sito

1. Il browser chiede il sito in HTTPS alla distribuzione CloudFront del sito ([cloudfront.md](cloudfront.md)).
2. Se l'edge ha il file in cache risponde subito; altrimenti lo legge dal bucket privato del sito con OAC
   ([s3.md](s3.md)), autorizzato dalla bucket policy.
3. I percorsi della SPA che non sono file (403/404 da S3) vengono serviti con `/index.html`: il routing lo fa React.

### 2. Registrazione e login

1. La SPA registra e autentica l'utente con Cognito ([cognito.md](cognito.md)): login gestito con authorization code e
   PKCE, email come attributo di accesso. Cognito restituisce ID token, access token e refresh token; la SPA li tiene
   in memoria. L'ID token le serve solo per sapere chi è loggato.
2. Subito dopo ogni login la SPA chiama `PUT /users/me` con l'**access token** ([api-gateway.md](api-gateway.md)): la
   Users Lambda ([lambda-users.md](lambda-users.md)) crea o aggiorna la riga dell'utente in Aurora con il solo `sub`
   preso dai claim. L'email resta solo in Cognito.
3. Al nuovo utente può arrivare l'email di benvenuto (flusso 8).

### 3. Una chiamata API autenticata (schema comune a tutte le route)

1. La SPA chiama l'HTTP API con `Authorization: Bearer <access token>` ([api-gateway.md](api-gateway.md)). Il browser
   prima fa il preflight CORS `OPTIONS`, a cui l'API risponde da sola.
2. L'authorizer JWT verifica firma (JWKS), issuer, audience (il claim `client_id`, perché l'access token non ha `aud`)
   e scadenza senza chiamare Cognito; se il token non è valido la richiesta si ferma lì con 401.
3. API Gateway invoca la Lambda dello *scope*, che lo ammette con una resource-based policy, passando i claim. La Lambda
   usa `sub` e `cognito:groups` (e rifiuta i token con `token_use` diverso da `access`).
4. La Lambda controlla il **ruolo** (gruppo) e, dove serve, l'**ownership** con una query.
5. Per il database la Lambda calcola in locale un token IAM e si collega al proxy su 5432 con TLS
   ([rds-proxy.md](rds-proxy.md)); il proxy, con il suo ruolo, usa la password letta da Secrets Manager
   ([secrets-manager.md](secrets-manager.md)) per parlare con Aurora ([aurora.md](aurora.md)).

### 4. Annunci: consultazione e gestione

- `GET /properties` e `GET /properties/{id}` sono pubbliche: un visitatore senza account vede gli annunci
  ([lambda-property.md](lambda-property.md)).
- `POST /properties` richiede il gruppo `agent`; `PUT` e `DELETE /properties/{id}` richiedono di essere il
  proprietario dell'immobile o `admin` (ownership con `WHERE id = :id AND owner_id = :sub`).
- `DELETE /properties/{id}` cancella l'immobile nel database (le righe dei file in cascata) e poi tutti i suoi file su S3
  sotto `uploads/<propertyId>/`, passando dal gateway endpoint S3
  ([lambda-property.md](lambda-property.md#cancellazione-di-un-immobile)).
- Le modifiche rilevanti pubblicano un evento di notifica (flusso 8).

### 5. Offerte

1. Un acquirente (gruppo `buyer`) chiama `POST /properties/{id}/offers` ([lambda-offers.md](lambda-offers.md)).
2. La Offers Lambda salva l'offerta e pubblica un evento "nuova offerta" per il proprietario dell'immobile.
3. Il proprietario la accetta o la rifiuta con `PUT /offers/{id}`; l'esito genera un'altra notifica.
   `GET /offers` e `DELETE /offers/{id}` sono permessi a chi ha fatto l'offerta o al proprietario dell'immobile.

### 6. Upload di una foto o di un video

1. La SPA chiama `POST /properties/{id}/uploads` con tipo e dimensione del file ([api-gateway.md](api-gateway.md)).
2. La Presigned Lambda ([lambda-presigned.md](lambda-presigned.md)) controlla nel database che l'utente sia il
   proprietario e firma in locale un **presigned POST**: chiave `uploads/<propertyId>/<uuid>.<ext>`, scadenza 5 minuti,
   tipo `image/` o `video/`, dimensione massima.
3. Il browser invia il file direttamente al bucket dei file ([s3.md](s3.md)), permesso dalla regola CORS del bucket.
4. S3 emette una notifica `ObjectCreated` sul prefisso `uploads/` che invoca la Files Lambda
   ([lambda-files.md](lambda-files.md)), la quale registra il file nel database (chiave, immobile, dimensione).

### 7. Lettura e cancellazione dei file

- Lettura: `GET /properties/{id}/files` (pubblica) restituisce l'elenco; il browser scarica i file dalla distribuzione
  CloudFront dei file ([cloudfront.md](cloudfront.md)), che legge il bucket con OAC. I file sono pubblici per chi ha il link.
- Cancellazione: `DELETE /files/{id}` (proprietario). La Files Lambda controlla l'ownership, toglie la riga dal database
  e cancella l'oggetto su S3 passando dal gateway endpoint S3 ([vpc-endpoints.md](vpc-endpoints.md)).

### 8. Notifiche email

1. Property, Users o Offers pubblicano un evento sul topic SNS ([sns.md](sns.md)) attraverso l'interface endpoint SNS
   ([vpc-endpoints.md](vpc-endpoints.md)). L'evento porta il destinatario come **`recipientSub`** e i dati dell'email,
   non l'indirizzo ([sns.md](sns.md#formato-degli-eventi)).
2. SNS lo consegna alla coda SQS ([sqs.md](sqs.md)), che lo ammette con la sua queue policy.
3. L'event source mapping della Mailer Lambda ([lambda-mailer.md](lambda-mailer.md)) legge la coda a batch di 10, con
   al massimo 2 invocazioni insieme, e la invoca.
4. Per ogni messaggio la Mailer chiede l'email a **Cognito** con `AdminGetUser` (`Username` = `recipientSub`) e la
   invia con SES ([ses.md](ses.md)). Risponde con i soli messaggi falliti per un errore temporaneo
   (`batchItemFailures`); gli altri vengono cancellati dalla coda. Gli errori permanenti si loggano e non si ritentano.
5. Un messaggio fallito torna visibile dopo il visibility timeout (180 s) e viene ritentato; dopo **5 ricezioni**
   (`maxReceiveCount`, circa 15 minuti) SQS lo sposta nella DLQ.
6. L'allarme CloudWatch sulla DLQ ([cloudwatch.md](cloudwatch.md)) pubblica sul topic SNS `real-estate-prod-ops-alerts`,
   che manda un'email al team.
7. Il team trova la causa nei log, la corregge e rimanda i messaggi nella coda con il **redrive manuale**
   (`StartMessageMoveTask`) ([sqs.md](sqs.md#procedura-operativa-quando-scatta-lallarme)).

### 9. Modifica e cancellazione dell'account

- Cambio password o email: la SPA chiama Cognito direttamente (`ChangePassword` o `UpdateUserAttributes`, con
  l'access token dell'utente) ([cognito.md](cognito.md)). Nel database non c'è nulla da riallineare: l'email sta solo in Cognito e la
  Mailer legge sempre quella attuale.
- Cancellazione: la SPA chiama prima `DELETE /users/me` (la Users Lambda cancella o anonimizza i dati applicativi) e poi
  `DeleteUser` di Cognito. Se il secondo passo fallisce l'account esiste ancora e l'utente può ripetere la cancellazione;
  se intanto rientra, `PUT /users/me` gli ricrea un profilo vuoto.

### 10. Log e monitoraggio

Tutte le Lambda e lo stage dell'HTTP API scrivono i log in CloudWatch; le metriche dei servizi alimentano gli allarmi
(errori delle Lambda, messaggi nella DLQ, messaggi vecchi in coda, errori permanenti della Mailer, CPU e connessioni di
Aurora), che avvisano il team via email tramite il topic `real-estate-prod-ops-alerts` ([cloudwatch.md](cloudwatch.md)).

## Scelte di fondo

| Scelta | Motivo |
| --- | --- |
| Serverless (Lambda, HTTP API, servizi gestiti) | Traffico basso e variabile: si paga per richiesta, scala da zero, nessun server da gestire |
| Regione `eu-south-1` (Milano) | Dati in Italia e latenza bassa per utenti italiani. È una regione *opt-in*: va abilitata nell'account, e alcune funzioni ci arrivano più tardi. Tutti i servizi usati ci sono (vedi [decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#disponibilità-dei-servizi-a-milano)) |
| Niente subnet pubbliche, Internet Gateway e NAT | Il traffico utente entra da CloudFront e API Gateway, che stanno fuori dalla VPC, e non chiamiamo API esterne: il NAT sarebbe un costo fisso inutile. I servizi AWS si raggiungono con gli endpoint VPC ([vpc.md](vpc.md)) |
| In VPC solo le Lambda che usano il database | Il proxy è raggiungibile solo dalla VPC; la Mailer fuori evita endpoint, cold start e costi ([lambda.md](lambda.md)) |
| Autorizzazione su due livelli | Ruolo dai gruppi Cognito, ownership nella Lambda con il database ([api-gateway.md](api-gateway.md)) |
| Access token verso l'API, email solo in Cognito | Buona pratica OIDC; nessuna email nei token, nelle richieste, negli eventi o nel database: la legge la Mailer con `AdminGetUser` ([cognito.md](cognito.md#decisione-allapi-va-laccess-token)) |
| Nessuna password nel codice | Lambda → proxy con IAM; la password del DB la legge solo il proxy ([rds-proxy.md](rds-proxy.md)) |
| Least privilege | Un execution role per Lambda, un utente PostgreSQL per Lambda, resource policy con `aws:SourceArn` ([iam.md](iam.md)) |
| Cifratura ovunque | In transito: HTTPS (CloudFront reindirizza HTTP su HTTPS, le bucket policy negano le richieste senza TLS), "Require TLS" sull'RDS Proxy e TLS tra proxy e Aurora. A riposo: Aurora con KMS `aws/rds`, S3 con SSE-S3, SQS con SSE-SQS, secret con `aws/secretsmanager` ([kms.md](kms.md)) |
| CORS in due punti | Il sito (dominio CloudFront) chiama due origini: l'HTTP API ammette solo l'origine del sito con gli header `Authorization` e `Content-Type` ([api-gateway.md](api-gateway.md#cors)); il bucket dei file permette il `POST` degli upload dalla stessa origine ([s3.md](s3.md#cors-del-bucket-dei-file)) |
| Nomi espliciti | Convenzione `real-estate-<ambiente>-<componente>-<scopo>`, con ambiente `prod` |

## Ordine di creazione

1. Cluster Aurora, writer e reader nelle due AZ; verificare il service-linked role di RDS ([aurora.md](aurora.md)).
2. Utenti PostgreSQL applicativi e relativi `GRANT`.
3. Un secret per ciascun utente, con le credenziali corrispondenti a quelle del DB ([secrets-manager.md](secrets-manager.md)).
4. Ruolo del proxy con trust RDS e policy di lettura dei secret ([rds-proxy.md](rds-proxy.md)).
5. Proxy: associare ruolo e secret, registrare il cluster come target, richiedere IAM per i client e TLS.
6. Inserire l'ID del proxy (`prx-...`) nelle policy degli execution role delle Lambda ([lambda.md](lambda.md)).
7. Configurare il client PostgreSQL delle Lambda per token IAM e TLS verso il proxy.
8. Topic, coda e DLQ con le configurazioni di `config/`, la queue policy e la sottoscrizione ([sqs.md](sqs.md), [sns.md](sns.md));
   event source mapping della Mailer ([lambda-mailer.md](lambda-mailer.md#event-source-mapping)); topic
   `real-estate-prod-ops-alerts` con la sottoscrizione email del team, metric filter e allarmi ([cloudwatch.md](cloudwatch.md)).
9. Bucket con Block Public Access, distribuzioni CloudFront con OAC e bucket policy; poi CORS e notifica S3 sul bucket
   dei file ([s3.md](s3.md), [cloudfront.md](cloudfront.md)).
10. HTTP API con authorizer JWT, route, CORS e permessi di invocazione delle Lambda ([api-gateway.md](api-gateway.md)).

La rete (VPC, subnet, security group, endpoint) è il prerequisito di tutti i passi che creano risorse nella VPC
([vpc.md](vpc.md)). I permessi per creare tutto questo appartengono all'identità di deploy ([iam.md](iam.md#identità-di-deploy-e-iampassrole)).

## All'orale

> **Seguimi una richiesta "crea un'offerta" dal clic al database.**
> SPA → HTTP API con l'access token → authorizer JWT (firma, issuer, `client_id`) → Offers Lambda (permesso di invocazione
> sulla funzione) → controllo del gruppo `buyer` → token IAM e connessione TLS al proxy (`rds-db:connect` come
> `offers_user`) → il proxy usa la password dal secret → Aurora. Poi `sns:Publish` sul topic tramite l'endpoint SNS,
> con il `recipientSub` del proprietario; la Mailer chiede la sua email a Cognito e la invia con SES.
>
> **E se l'email della notifica non parte?**
> Il messaggio resta nella coda e viene ritentato; dopo 5 ricezioni, circa un quarto d'ora, va nella DLQ, l'allarme
> manda un'email al team, che corregge la causa e lo rimanda in coda con il redrive.
>
> **Perché serverless e non un'applicazione sempre accesa?**
> Il traffico è basso e variabile: con Lambda si paga per richiesta e non c'è un server da gestire. È come avere i
> controller di un'applicazione Spring Boot senza dover tenere acceso il container che li ospita; l'alternativa più
> vicina a Docker sarebbe ECS Fargate, sempre acceso.
>
> **Perché non c'è un NAT Gateway?**
> Non chiamiamo API esterne e i servizi AWS li raggiungiamo con gli endpoint VPC. Il NAT sarebbe un costo fisso orario
> per niente; se un giorno servisse un'API esterna aggiungeremmo una subnet pubblica per AZ con un NAT.
>
> **Cosa succede se cade AZ-1? E se cade solo il writer?**
> Aurora promuove la reader dell'altra AZ in genere in decine di secondi; il proxy, che punta al cluster, mantiene le
> connessioni dei client e si ricollega al nuovo writer. Proxy, Lambda ed endpoint hanno già ENI in entrambe le subnet.
>
> **Dove sta la password del database e chi la legge?**
> In Secrets Manager, cifrata con KMS. La legge solo il ruolo del proxy; le Lambda entrano nel proxy con un token IAM
> e non vedono mai la password.
