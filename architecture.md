## Soluzione

Per questa soluzione ho pensato la seguente modalità.
Il riferimento visivo è [`diagrams/updated.drawio`](diagrams/updated.drawio); i ruoli IAM
sono descritti in [`am-management/`](am-management/README.md).

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

Se il contenuto è già presente nela località di richiesta, esso verrà spedito
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
a ogni chiamata API li invia nell'header `Authorization`; l'*API Gateway* li valida con
le chiavi pubbliche del user pool (issuer e JWKS) **senza** chiamare *Cognito* a ogni richiesta
e inoltra alla lambda, insieme alle informazioni del token (`sub` e gruppi), solo le
richieste valide. *CloudFront* non partecipa all'autenticazione: serve soltanto i file del sito.

L'autorizzazione è su due livelli:

- **Ruolo** (cosa può fare quel tipo di utente): letto dai gruppi del token, controllato
  nella lambda dello *scope*.
- **Ownership** (se quella proprietà o offerta è sua): la lambda confronta il `sub` del token con
  il proprietario letto dal database (es. `WHERE id = :id AND owner_id = :sub`).

Non usiamo una *Lambda Authorizer* separata: l'authorizer di *API Gateway* mette in cache la risposta
(per default per tutte le route che lo usano) e una decisione per singola risorsa non è affidabile
lì dentro; inoltre servirebbe una lettura del database a ogni richiesta.

#### BUSINESS LOGIC

All'interno del **BACKEND** utilizziamo al momento 5 lambde di business, una per ogni *scope*
dell'applicativo: *Proprietà*, *Utenti*, *Offerte* e, per *Media e File*, due lambde,
*Files* (metadati e gestione dei file) e *Presigned* (generazione degli URL di upload).
Sono tutte nella VPC perché parlano con il database (la *Presigned* controlla nel database che
l'utente possa caricare file su quella proprietà).

All'interno di ogni lambda ci sarà un handler che farà da routing interno dello *scope*.
Per esempio, parlando della lambda degli utenti, all'interno ci sarà l'handler che
processerà l'evento arrivato, successivamente farà del routing interno e processerà
le informazioni nella maniera corretta, come eventi `UpdateUserInformation` o `DeleteUser`.

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

### RETE

Esiste un'unica VPC con due subnet **private**, una per AZ (`private_subnet_A` e `private_subnet_B`).
Dentro ci sono: *Aurora*, *RDS Proxy* e le 5 lambda di business.

- Non servono subnet pubbliche, *Internet Gateway* e *NAT Gateway*: tutto il traffico utente entra da
  *CloudFront* e *API Gateway*, che stanno fuori dalla VPC, e non chiamiamo API esterne.
- Una lambda nella VPC non ha accesso a Internet. Per raggiungere i servizi AWS usiamo
  gli **endpoint VPC**:
  - *interface endpoint* per **SNS** (le lambda pubblicano gli eventi) e per **Secrets Manager**;
  - *gateway endpoint* per **S3** (gratuito), se la lambda *Files* deve operare sugli oggetti.
- La lambda *Mailer* (notifiche) non accede al database, quindi sta **fuori** dalla VPC.
- Security group: `sg-lambda-internal` → `sg-rds-proxy` sulla porta 5432 e `sg-rds-proxy` → `sg-rds`
  sulla 5432; `sg-lambda-internal` → `sg-endpoint-sns` (e `sg-endpoint-secrets-manager`) sulla 443.
  Le lambda non raggiungono Aurora direttamente.

L'endpoint di Secrets Manager serve in caso il proxy ne abbia bisogno per leggere i secret dalle subnet
private: la documentazione AWS non lo richiede esplicitamente, quindi in fase di creazione va verificato
e, se il proxy legge i secret senza, può essere tolto (risparmiando i costi di un endpoint).

### NOTIFICATION SYSTEM

Il sistema di notifiche è gestito in maniera molto semplice e diretta.
Ogni lambda, quando opportuno, pubblica un evento su un topic *SNS (Simple Notification Service)*,
che lo consegna ad una coda *SQS (Simple Queue Service)*. Il topic permette in futuro di aggiungere
altri consumer (altri canali di notifica) senza modificare le lambda.

Ad ascoltare quella coda ci sarà una *Mailer Lambda* che si affianca al servizio
*Amazon SES (Simple Email Service)*, che penserà ad inviare email quando necessario.

- L'evento contiene già destinatario e dati dell'email, così la *Mailer Lambda* non ha bisogno del database.
- La coda ha una **dead-letter queue (DLQ)**: dopo alcuni tentativi falliti il messaggio vi
  viene spostato per l'analisi. Il *visibility timeout* è maggiore del timeout della lambda.
- Essendo la consegna *at-least-once*, la *Mailer Lambda* deve poter gestire lo stesso messaggio due volte.
- SES parte in *sandbox*: per la demo si inviano email a indirizzi verificati; per un uso reale va
  richiesto l'accesso alla produzione e verificato il mittente.

### MONITORAGGIO

*CloudWatch* raccoglie i log di tutte le lambda e di *API Gateway* e le metriche dei servizi.
Allarmi minimi: errori delle lambda, messaggi presenti nella DLQ, CPU e connessioni di Aurora.
