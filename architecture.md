## Soluzione

Per questa soluzione ho pensato la seguente modalità.
Il riferimento visivo è [`diagrams/updated.drawio`](diagrams/updated.drawio); una versione completa
da confrontare, con tutti i flussi descritti qui, è [`diagrams/real-estate-v2.drawio`](diagrams/real-estate-v2.drawio).
I ruoli e le policy IAM sono in [`am-management/`](am-management/README.md); le configurazioni
non IAM (CORS, coda, notifiche S3) in [`config/`](config/).

Tutto vive nella regione `eu-south-1` (Milano). I servizi gestiti da AWS fuori da una VPC
(CloudFront, S3, API Gateway, Cognito, SNS, SQS, SES, CloudWatch, Secrets Manager) non hanno
security group: si proteggono con **IAM** (identity policy e resource policy). Solo le risorse
dentro la VPC (Lambda con accesso al DB, RDS Proxy, Aurora, endpoint VPC) hanno security group.

### FRONTEND

Il frontend sarà gestito interamente da 2 servizi aws.

- **CloudFront**
Servizio che permette di distribuire un sito web statico e dinamico agli utenti.
*CloudFront* inoltre gestisce la modalità per il trasporto del contenuto, cercando
di mantenere una latenza di rete più bassa possibile.

Se il contenuto è già presente nella località di richiesta, esso verrà spedito
nell'immediato, altrimenti recupera il contenuto dove è stato hostato.

- **S3 (Simple Storage Service)**
Come dice il nome S3 è un servizio per salvare file su cloud.
Nel nostro caso è utilizzato in coppia con CloudFront, per recuperare il sito.

Quindi *CloudFront* si occupa di rendere il sito accessibile dal web;
Invece *S3* ha il compito di mantenere disponibili i file del sito per *CloudFront*.

Il bucket del sito è **privato**: nessun accesso pubblico e nessun "static website hosting".
*CloudFront* lo legge tramite **Origin Access Control (OAC)** e la bucket policy concede
`s3:GetObject` solo alla nostra distribuzione. Per una SPA gli errori 403/404 vengono
reindirizzati a `/index.html`, così il routing resta gestito dal frontend.
Per la presentazione useremo il dominio `*.cloudfront.net`; con un dominio personalizzato
il certificato ACM andrebbe creato in `us-east-1`.

Una **seconda distribuzione** *CloudFront* serve i file caricati dagli utenti (foto, video, documenti
degli annunci), che sono **pubblici**: chiunque abbia il link li può vedere, come le foto di un annuncio.
Il bucket resta comunque privato e viene letto solo tramite OAC. Le due distribuzioni sono separate
perché hanno regole diverse: la regola "403/404 → `/index.html`" vale per tutta una distribuzione e
non deve toccare i file.

### BACKEND

Il backend ho deciso di dividerlo in 2 sezioni principali, visto che in realtà
gestiscono due sezioni ben definite.

#### ROUTING & AUTH

Il routing e l'auth utilizzano 2 servizi:

- **API Gateway**
Il gateway dirige il traffico e spedisce le richieste alle lambda corrette.
Usiamo una **HTTP API**, che ha un authorizer JWT nativo.

- **Cognito**
Cognito (*user pool*) è utilizzato per gestire l'autenticazione degli utenti e
il loro ruolo applicativo (gruppi `buyer`, `agent`, `admin`).

Il flusso è questo: il frontend esegue il login con *Cognito* e riceve i token JWT;
a ogni chiamata API invia l'**ID token** nell'header `Authorization`; l'*API Gateway* lo valida con
le chiavi pubbliche del user pool (issuer, JWKS e audience = ID dell'app client) **senza** chiamare
*Cognito* a ogni richiesta e inoltra alla lambda, insieme ai claim del token (`sub`, `email` e
`cognito:groups`), solo le richieste valide. Usiamo l'ID token perché contiene l'email, che salviamo
nel database per le notifiche. *CloudFront* non partecipa all'autenticazione: serve soltanto i file.

**Gestione dell'account.** Registrazione, login, cambio password o email e **cancellazione
dell'account** il frontend li fa **direttamente con Cognito** (API pubbliche come `SignUp`,
`UpdateUserAttributes`, `DeleteUser`, autorizzate dall'access token dell'utente). Così le lambda,
che stanno in una VPC senza accesso a Internet, non devono mai chiamare *Cognito*.
- Dopo ogni login il frontend chiama `PUT /users/me`: la lambda *Users* crea o aggiorna la riga
  dell'utente nel database con `sub` ed `email` presi dal token.
- Per cancellare l'account il frontend chiama prima `DELETE /users/me` (la lambda cancella o
  anonimizza i dati applicativi) e poi `DeleteUser` di *Cognito*. Se il secondo passo fallisce,
  l'account esiste ancora e l'utente può ripetere la cancellazione; se intanto rientra, `PUT /users/me`
  gli ricrea un profilo vuoto.

L'autorizzazione è su due livelli:

- **Ruolo** (cosa può fare quel tipo di utente): letto dai gruppi del token, controllato
  nella lambda dello *scope*.
- **Ownership** (se quella proprietà o offerta è sua): la lambda confronta il `sub` del token con
  il proprietario letto dal database (es. `WHERE id = :id AND owner_id = :sub`).

Non usiamo una *Lambda Authorizer* separata: se se ne attiva la cache, per default la risposta vale per
tutte le route che usano l'authorizer, quindi una decisione per singola risorsa non è affidabile
lì dentro; senza cache, invece, servirebbe una lettura del database a ogni richiesta.

**Route dell'HTTP API.** Ogni route punta alla lambda del suo *scope*. Le route di sola lettura degli
annunci sono pubbliche (un visitatore può guardare gli immobili senza account); tutte le altre
richiedono il JWT.

| Route | Lambda | Accesso |
| --- | --- | --- |
| `GET /properties`, `GET /properties/{id}` | *Property* | pubblica |
| `POST /properties` | *Property* | JWT, gruppo `agent` |
| `PUT /properties/{id}`, `DELETE /properties/{id}` | *Property* | JWT, proprietario o `admin` |
| `GET /users/me`, `PUT /users/me`, `DELETE /users/me` | *Users* | JWT |
| `GET /users/{id}` (profilo pubblico dell'agente) | *Users* | pubblica |
| `POST /properties/{id}/offers` | *Offers* | JWT, gruppo `buyer` |
| `GET /offers`, `PUT /offers/{id}` (accetta o rifiuta), `DELETE /offers/{id}` | *Offers* | JWT, chi ha fatto l'offerta o il proprietario dell'immobile |
| `POST /properties/{id}/uploads` | *Presigned* | JWT, proprietario |
| `GET /properties/{id}/files` | *Files* | pubblica |
| `DELETE /files/{id}` | *Files* | JWT, proprietario |

Le route sono esplicite (niente `$default` né `ANY /{proxy+}`): con il CORS configurato l'API risponde
da sola alle richieste preflight `OPTIONS`, senza farle passare dall'authorizer.

#### BUSINESS LOGIC

All'interno del **BACKEND** utilizziamo al momento 5 lambde di business, una per ogni *scope*
dell'applicativo: *Proprietà*, *Utenti*, *Offerte* e, per *Media e File*, due lambde,
*Files* (metadati e gestione dei file) e *Presigned* (generazione degli URL di upload).
Sono tutte nella VPC perché parlano con il database (la *Presigned* controlla nel database che
l'utente possa caricare file su quella proprietà).

All'interno di ogni lambda ci sarà un handler che farà da routing interno dello *scope*.
Per esempio, parlando della lambda degli utenti, all'interno ci sarà l'handler che
processerà l'evento arrivato, successivamente farà del routing interno e processerà
le informazioni nella maniera corretta, come eventi `UpdateUserInformation` o `DeleteUser`
(che lavorano sui dati del database; l'account *Cognito* lo gestisce il frontend).
La lambda *Files* riceve due tipi di evento: le richieste HTTP dall'*API Gateway* e le notifiche di *S3*
quando un upload è completato.

Ogni lambda ha il proprio *execution role* (vedi `am-management/`).
La connessione al database si apre fuori dall'handler, per essere riutilizzata tra le invocazioni.

### DATABASE & STORAGE

Per il lato del database utilizziamo due servizi: *RDS Proxy* e *Aurora PostgreSQL*.
L'*RDS Proxy* serve per gestire le numerose connessioni che le lambda possono creare.

**NOTE**
Questo servizio non è strettamente necessario, visto che il traffico non sarà così
elevato da dover gestire una moltitudine di connessioni, ma per sicurezza abbiamo
deciso di implementarlo nella soluzione.

Il database scelto è *Aurora PostgreSQL*, visto che nell'applicazione ci sono relazioni
tra diverse entità e un quantitativo di dati possibilmente elevato.
Il cluster ha un'istanza *writer* in una AZ e una *reader* nell'altra; il proxy punta al cluster.

Le lambda si autenticano al proxy con **IAM** (token temporaneo) e TLS; il proxy si autentica
ad Aurora con le credenziali dell'utente PostgreSQL salvate in **Secrets Manager**, che legge con
un proprio ruolo. Le lambda non leggono mai i secret e nel codice non ci sono password.

Per lo storage di immagini, video o qualsiasi altro file direttamente caricato da un utente
è disponibile un ulteriore *S3* (privato). Il caricamento avviene direttamente dal browser tramite
un **presigned POST** generato dalla lambda *Presigned*, con scadenza breve e condizioni su
dimensione (`content-length-range`) e tipo del file; la lambda non fa da tramite per i dati.
La lettura dei file passa da *CloudFront* con OAC, come per il sito.

Il flusso di un upload:
1. Il frontend chiama `POST /properties/{id}/uploads` con tipo e dimensione del file.
2. La lambda *Presigned* controlla nel database che l'utente sia il proprietario dell'immobile e
   firma un presigned POST: la chiave dell'oggetto la decide lei (`uploads/<propertyId>/<uuid>.<ext>`),
   scade in 5 minuti, ammette solo `image/*` o `video/*` e una dimensione massima. La firma si
   calcola in locale: la lambda non chiama *S3*.
3. Il browser invia il file direttamente al bucket (per questo il bucket ha una regola CORS).
4. *S3* emette una **notifica `ObjectCreated`** sul prefisso `uploads/` che invoca la lambda *Files*:
   la lambda registra il file nel database (chiave, immobile, dimensione). In questo modo il database
   viene aggiornato solo dagli upload riusciti, senza fidarsi di una conferma del client.
5. Il file è visibile a tutti tramite la distribuzione *CloudFront* dei file.

Per cancellare un file (`DELETE /files/{id}`) la lambda *Files* controlla l'ownership, toglie la riga
dal database e cancella l'oggetto su *S3* passando dal *gateway endpoint* S3.

### RETE

Esiste un'unica VPC (`10.0.0.0/16`) con due subnet **private**, una per AZ: `private_subnet_A`
(`10.0.1.0/24`, `eu-south-1a`) e `private_subnet_B` (`10.0.2.0/24`, `eu-south-1b`). Le `/24` lasciano
spazio alle ENI di lambda, proxy (almeno 10 IP liberi per subnet) ed endpoint.
Dentro ci sono: *Aurora*, *RDS Proxy* e le 5 lambda di business.

- Non servono subnet pubbliche, *Internet Gateway* e *NAT Gateway*: tutto il traffico utente entra da
  *CloudFront* e *API Gateway*, che stanno fuori dalla VPC, e non chiamiamo API esterne.
- Una lambda nella VPC non ha accesso a Internet. Per raggiungere i servizi AWS usiamo
  gli **endpoint VPC**:
  - *interface endpoint* per **SNS** (le lambda pubblicano gli eventi) e per **Secrets Manager**;
  - *gateway endpoint* per **S3** (gratuito), usato dalla lambda *Files* per cancellare gli oggetti.
    Non ha security group: funziona con una rotta nelle route table delle due subnet.
  - Gli *interface endpoint* hanno il **Private DNS** attivo (la VPC ha `enableDnsSupport` ed
    `enableDnsHostnames`), così l'SDK usa i nomi standard dei servizi senza modifiche al codice.
- La lambda *Mailer* (notifiche) non accede al database, quindi sta **fuori** dalla VPC.
- Security group: `sg-lambda-internal` → `sg-rds-proxy` sulla porta 5432 e `sg-rds-proxy` → `sg-rds`
  sulla 5432; `sg-lambda-internal` → `sg-endpoint-sns` sulla 443; se l'endpoint di Secrets Manager
  serve, `sg-rds-proxy` → `sg-endpoint-secrets-manager` sulla 443 (lo usa il proxy, non le lambda).
  Le lambda non raggiungono Aurora direttamente.

| Security group | In entrata | In uscita |
| --- | --- | --- |
| `sg-lambda-internal` | nessuna regola | 5432 → `sg-rds-proxy`; 443 → `sg-endpoint-sns`; 443 → prefix list di S3 (gateway endpoint) |
| `sg-rds-proxy` | 5432 da `sg-lambda-internal` | 5432 → `sg-rds`; 443 → `sg-endpoint-secrets-manager` |
| `sg-rds` | 5432 da `sg-rds-proxy` | nessuna regola |
| `sg-endpoint-sns` | 443 da `sg-lambda-internal` | nessuna regola |
| `sg-endpoint-secrets-manager` | 443 da `sg-rds-proxy` | nessuna regola |

I security group sono *stateful*: la risposta di una connessione permessa torna indietro da sola.

L'endpoint di Secrets Manager serve in caso il proxy ne abbia bisogno per leggere i secret dalle subnet
private: la documentazione AWS non lo richiede esplicitamente, quindi in fase di creazione va verificato
e, se il proxy legge i secret senza, può essere tolto (risparmiando i costi di un endpoint).

### NOTIFICATION SYSTEM

Il sistema di notifiche è gestito in maniera molto semplice e diretta.
Le lambda *Property*, *Users* e *Offers*, quando opportuno (per esempio una nuova offerta su un immobile,
un'offerta accettata, il benvenuto a un nuovo utente), pubblicano un evento su un topic *SNS (Simple Notification Service)*,
che lo consegna ad una coda *SQS (Simple Queue Service)*. Il topic permette in futuro di aggiungere
altri consumer (altri canali di notifica) senza modificare le lambda.

Ad ascoltare quella coda ci sarà una *Mailer Lambda* che si affianca al servizio
*Amazon SES (Simple Email Service)*, che penserà ad inviare email quando necessario.

- L'evento contiene già destinatario e dati dell'email, così la *Mailer Lambda* non ha bisogno del database.
- La coda ha una **dead-letter queue (DLQ)**: dopo 5 tentativi falliti (`maxReceiveCount`) il messaggio
  vi viene spostato per l'analisi. Il *visibility timeout* è 6 volte il timeout della lambda, come
  consiglia AWS.
- La coda è cifrata con **SSE-SQS**: con la chiave KMS gestita da AWS (`aws/sqs`) *SNS* non potrebbe
  consegnarle i messaggi, perché la key policy di quella chiave non ammette *SNS* e non si può modificare.
- Essendo la consegna *at-least-once*, la *Mailer Lambda* deve poter gestire lo stesso messaggio due volte.
- SES parte in *sandbox*: per la demo si inviano email a indirizzi verificati; per un uso reale va
  richiesto l'accesso alla produzione e verificato il mittente.

### SICUREZZA

- **CORS.** Il sito (dominio *CloudFront*) chiama due origini diverse: l'*HTTP API*, che ammette solo
  l'origine del sito con gli header `Authorization` e `Content-Type`, e il bucket dei file, che ha
  una regola CORS per il `POST` degli upload dalla stessa origine. Configurazioni in [`config/`](config/).
- **Accesso pubblico a S3 bloccato.** Entrambi i bucket hanno *Block Public Access* attivo e le ACL
  disattivate (*bucket owner enforced*). I file "pubblici" lo sono solo tramite *CloudFront*; il
  presigned POST funziona lo stesso perché è firmato da un ruolo IAM.
- **Cifratura in transito.** HTTPS ovunque: *CloudFront* reindirizza HTTP su HTTPS, le bucket policy
  negano le richieste senza TLS, l'*RDS Proxy* ha "Require TLS" e usa TLS anche verso *Aurora*.
- **Cifratura a riposo.** *Aurora* cifrato con KMS (`aws/rds`, va scelto alla creazione del cluster),
  *S3* con SSE-S3, *SQS* con SSE-SQS, secret con la chiave `aws/secretsmanager`.
- **Limiti di traffico.** Throttling sullo stage dell'*HTTP API* (rate e burst). WAF non si può
  associare direttamente a una *HTTP API*: è uno sviluppo futuro (con *CloudFront* davanti all'API).

### MONITORAGGIO

*CloudWatch* raccoglie i log di tutte le lambda e di *API Gateway* e le metriche dei servizi.
Allarmi minimi: errori delle lambda, messaggi presenti nella DLQ, CPU e connessioni di Aurora.
