# Media Upload Flow

## Overview

Il **Media Upload Flow** descrive il processo utilizzato per caricare immagini, documenti e altri file associati alle proprietà o agli utenti.

L'obiettivo è evitare di utilizzare le funzioni Lambda come proxy per il trasferimento dei file, delegando il trasferimento del contenuto direttamente ad Amazon S3.

Il flow separa quindi:

* autorizzazione dell'upload;
* generazione della presigned URL;
* trasferimento del file;
* persistenza dei metadata;
* eventuale elaborazione asincrona;
* propagazione degli eventi;
* gestione degli errori e degli oggetti non correttamente associati.

Il contenuto binario viene mantenuto in Amazon S3, mentre Amazon Aurora PostgreSQL conserva i metadata necessari per identificare e gestire il file.

---

## Goals

Il flow deve garantire:

* accesso autenticato all'operazione di upload;
* autorizzazione sull'entità a cui il file appartiene;
* upload diretto verso Amazon S3;
* nessun passaggio del contenuto binario attraverso API Gateway o Lambda;
* controllo temporale dell'accesso tramite presigned URL;
* separazione tra file e metadata applicativi;
* possibilità di elaborazione asincrona;
* gestione degli errori;
* idempotenza dove necessaria;
* osservabilità;
* sicurezza dei contenuti.

---

## Trigger

Il flow viene avviato quando un utente vuole caricare un file associato a un'entità applicativa.

Esempi:

* immagine di una proprietà;
* documento di una proprietà;
* allegato CRM;
* documento associato a un utente;
* file generato da un processo applicativo.

Un esempio di endpoint può essere:

```text
POST /properties/{propertyId}/media/upload-url
```

La richiesta non contiene necessariamente il file.

Contiene invece le informazioni necessarie per autorizzare e preparare l'upload.

Esempio concettuale:

```json
{
  "fileName": "living-room.jpg",
  "contentType": "image/jpeg",
  "size": 5242880
}
```

---

## Components

I principali componenti coinvolti sono:

* User
* Next.js
* CloudFront
* Amazon Cognito
* API Gateway
* Lambda
* Amazon S3
* Amazon Aurora PostgreSQL
* Amazon EventBridge
* Amazon SQS
* Lambda Worker
* CloudWatch
* X-Ray

Eventuali servizi di image processing o document processing possono essere introdotti successivamente senza modificare il modello principale.

---

## High-Level Flow

Il flusso principale è:

```text
User
  │
  ▼
Next.js
  │
  ▼
API Gateway
  │
  ▼
Lambda
  │
  ├──► Authorization
  │
  ├──► Generate S3 Presigned URL
  │
  └──► Return upload information
          │
          ▼
       Next.js
          │
          ▼
     Amazon S3
          │
          ▼
     EventBridge
          │
          ▼
        SQS
          │
          ▼
    Lambda Worker
          │
          ├──► Processing
          └──► Metadata / Status update
```

La fase di upload del file avviene direttamente tra client e Amazon S3.

---

## Authentication

L'utente viene autenticato tramite Amazon Cognito.

Il token di autenticazione viene utilizzato nella richiesta verso API Gateway.

Il flow concettuale è:

```text
User
  │
  ▼
Amazon Cognito
  │
  ▼
Access Token
  │
  ▼
API Gateway
  │
  ▼
Lambda
```

Lambda riceve quindi il contesto dell'utente autenticato e può determinare:

* user ID;
* ruoli;
* eventuali claims;
* entità a cui l'utente può accedere;
* permessi relativi all'upload.

---

## Authorization

L'autenticazione dell'utente non è sufficiente per autorizzare l'upload.

L'application layer deve verificare che l'utente possa modificare l'entità a cui il file verrà associato.

Esempio:

```text
Authenticated User
        │
        ▼
   Authorization
        │
        ▼
Can user modify Property X?
        │
   ┌────┴────┐
   │         │
  YES        NO
   │         │
   ▼         ▼
Generate    403
URL
```

La verifica può coinvolgere:

* ownership;
* ruolo dell'utente;
* permessi applicativi;
* stato della proprietà;
* eventuali policy specifiche del dominio.

L'autorizzazione applicativa deve essere distinta dai permessi IAM utilizzati dalle risorse AWS.

---

## Upload URL Generation

Dopo aver verificato l'autorizzazione, Lambda genera una presigned URL per Amazon S3.

La presigned URL rappresenta un accesso temporaneo a una specifica operazione su uno specifico object key.

L'URL deve avere una durata limitata e deve essere generato esclusivamente dopo le verifiche applicative necessarie.

Concettualmente:

```text
User
  │
  ▼
API Gateway
  │
  ▼
Lambda
  │
  ├── Authenticate
  ├── Authorize
  ├── Validate metadata
  │
  ▼
Generate Presigned URL
  │
  ▼
Return URL
```

La presigned URL non costituisce un bypass delle policy di Amazon S3.

L'operazione rimane vincolata ai permessi e alle condizioni con cui è stata generata e deve essere trattata come una credenziale temporanea.

---

## Object Key Strategy

Gli object key devono essere deterministici o comunque strutturati in modo da evitare collisioni e facilitare la gestione degli oggetti.

Esempio:

```text
properties/{propertyId}/images/{objectId}
```

Per i documenti:

```text
properties/{propertyId}/documents/{objectId}
```

Per allegati CRM:

```text
crm/{entityType}/{entityId}/attachments/{objectId}
```

È preferibile utilizzare un identificatore applicativo o UUID per il file invece di affidarsi esclusivamente al nome originale.

Il nome originale può essere conservato nei metadata applicativi.

Esempio concettuale:

```text
objectId: UUID
originalFileName: living-room.jpg
contentType: image/jpeg
objectKey: properties/123/images/550e8400-e29b-41d4-a716-446655440000
```

---

## Presigned URL Response

Lambda restituisce al client le informazioni necessarie per effettuare l'upload.

Esempio concettuale:

```json
{
  "mediaId": "uuid",
  "objectKey": "properties/123/images/uuid",
  "uploadUrl": "presigned-url",
  "expiresIn": 900
}
```

La risposta può includere anche:

* content type atteso;
* dimensione massima;
* eventuali headers richiesti;
* expiration;
* media ID.

La struttura definitiva della response API rimane una decisione applicativa.

---

## Direct Upload to Amazon S3

Il client utilizza la presigned URL per caricare direttamente il file.

```text
Next.js
   │
   │ PUT / POST
   ▼
Amazon S3
```

Il contenuto binario non deve passare attraverso:

```text
Next.js → API Gateway → Lambda → S3
```

quando non necessario.

Il modello preferito è:

```text
Next.js ───────────────► Amazon S3
          Direct Upload
```

Questo riduce:

* durata delle invocazioni Lambda;
* traffico attraverso API Gateway;
* utilizzo di risorse applicative;
* latenza per file di grandi dimensioni;
* costi associati al proxying del contenuto.

---

## S3 Object Security

Il bucket Amazon S3 deve essere configurato con:

* Block Public Access;
* Bucket owner enforced;
* encryption;
* bucket policy restrittiva;
* accesso tramite IAM;
* eventuali condizioni specifiche per gli upload;
* logging e monitoring dove richiesto.

Gli oggetti non devono essere pubblicamente accessibili.

L'accesso applicativo ai file può essere realizzato tramite:

* presigned URLs;
* accesso autorizzato da backend;
* eventuali meccanismi applicativi successivi.

---

## Content Validation

Prima di generare la presigned URL, Lambda deve validare i metadata dichiarati dal client.

Esempi:

* content type;
* file size;
* estensione;
* tipo di media;
* proprietà associata;
* eventuali limiti applicativi.

Esempio:

```text
image/jpeg
image/png
application/pdf
```

La validazione dei metadata dichiarati dal client non deve essere considerata una garanzia assoluta sul contenuto reale del file.

Per requisiti di sicurezza più elevati può essere introdotta una fase asincrona di verifica del contenuto dopo l'upload.

---

## Browser Upload and CORS

Se il browser effettua direttamente l'upload verso Amazon S3, il bucket deve prevedere una configurazione CORS coerente con gli origin autorizzati.

La configurazione deve essere limitata agli origin effettivamente necessari.

Esempio concettuale:

```text
Allowed Origins
Allowed Methods
Allowed Headers
Expose Headers
```

La configurazione definitiva dipenderà dagli ambienti:

```text
dev
staging
prod
```

e dai relativi domini applicativi.

---

## Metadata Persistence

Esistono due informazioni distinte:

1. il file fisico in Amazon S3;
2. i metadata applicativi in Amazon Aurora PostgreSQL.

Esempio di metadata:

```text
mediaId
propertyId
objectKey
originalFileName
contentType
size
status
createdBy
createdAt
```

Aurora PostgreSQL rimane la source of truth per i metadata applicativi.

Amazon S3 rimane la source of truth per il contenuto binario.

---

## Metadata Creation Strategy

Il momento in cui viene creato il record metadata deve essere definito attentamente.

Un possibile modello è:

```text
1. Authorize upload
2. Create media record with status = PENDING
3. Generate presigned URL
4. Upload file to S3
5. S3 event
6. Process media
7. Update media status = READY
```

Questo modello permette di rappresentare esplicitamente lo stato dell'upload.

Esempio:

```text
PENDING
   │
   ▼
UPLOADING
   │
   ▼
UPLOADED
   │
   ▼
PROCESSING
   │
   ▼
READY
```

In caso di errore:

```text
PROCESSING
   │
   ▼
FAILED
```

Gli stati effettivi devono essere definiti a livello applicativo.

---

## S3 Event Processing

Dopo il completamento dell'upload, Amazon S3 può generare un evento verso Amazon EventBridge.

Il modello è:

```text
Amazon S3
    │
    ▼
EventBridge
    │
    ▼
SQS
    │
    ▼
Lambda Worker
```

Il Worker può occuparsi di:

* aggiornamento dello stato del media;
* validazione del contenuto;
* estrazione di metadata;
* generazione di thumbnail;
* processing documentale;
* aggiornamento di indici;
* propagazione di ulteriori eventi.

Le attività specifiche dipendono dal tipo di file.

---

## Media Processing

L'elaborazione dei file deve essere asincrona quando non è necessaria per completare immediatamente la richiesta HTTP.

Esempio:

```text
S3 Upload
   │
   ▼
EventBridge
   │
   ▼
SQS
   │
   ▼
Lambda Worker
   │
   ├── Validate
   ├── Process
   ├── Generate metadata
   └── Update status
```

Eventuali attività costose o con più passaggi possono successivamente essere orchestrate tramite AWS Step Functions.

---

## Event Reliability

La presenza del file in Amazon S3 e la presenza del relativo record in Aurora PostgreSQL rappresentano due sistemi distinti.

È quindi necessario considerare scenari in cui:

```text
S3 object exists
+
Database record missing
```

oppure:

```text
Database record exists
+
S3 object missing
```

Il sistema deve prevedere meccanismi di riconciliazione e cleanup.

Eventuali workflow più avanzati possono utilizzare un modello di **Transactional Outbox** o altri meccanismi di affidabilità degli eventi.

---

## Idempotency

I consumer degli eventi devono essere progettati per gestire eventuali duplicazioni.

Un Worker non dovrebbe produrre effetti applicativi duplicati se riceve più volte lo stesso evento.

Esempio:

```text
Event ID
   │
   ▼
Idempotency Check
   │
   ├── Already processed → Ignore
   │
   └── New event → Process
```

Questo è particolarmente importante per:

* aggiornamento dei metadata;
* processing;
* generazione di thumbnail;
* aggiornamento dello stato;
* indexing;
* notifiche.

---

## Error Handling

Gli errori possono verificarsi in differenti fasi.

### Presigned URL generation

Possibili errori:

* utente non autenticato;
* utente non autorizzato;
* proprietà inesistente;
* metadata non validi;
* limite dimensionale superato.

Risposte tipiche:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
```

---

### S3 Upload

Possibili errori:

* URL scaduta;
* content type non compatibile;
* errore di rete;
* upload interrotto;
* policy S3 non soddisfatta.

Il client deve poter ripetere l'operazione utilizzando una nuova presigned URL quando appropriato.

---

### Async Processing

Possibili errori:

* Worker failure;
* invalid file;
* processing failure;
* database error;
* downstream service unavailable.

Il messaggio deve essere gestito tramite:

```text
SQS
  │
  ├── Retry
  │
  └── DLQ
```

La Dead Letter Queue permette di isolare i messaggi che non possono essere processati correttamente.

---

## Orphan Objects

Un caso particolare è rappresentato dagli **orphan objects**.

Esempio:

```text
Presigned URL generated
        │
        ▼
S3 upload succeeds
        │
        X
Database metadata creation fails
```

Il file esiste in S3 ma non è correttamente associato a un'entità applicativa.

La strategia di gestione può includere:

* stato `PENDING`;
* TTL applicativo;
* periodic reconciliation;
* cleanup job;
* lifecycle policy S3;
* verifica periodica della corrispondenza S3/Aurora.

La strategia definitiva deve essere definita prima dell'implementazione.

---

## Security

Il flow deve rispettare i principi di **Least Privilege** e **Defense in Depth**.

### Application Security

* autenticazione tramite Amazon Cognito;
* authorization applicativa;
* validazione degli input;
* limiti sulle dimensioni dei file;
* validazione dei content type;
* expiration delle presigned URL.

### Amazon S3 Security

* Block Public Access;
* Bucket owner enforced;
* bucket policy restrittiva;
* encryption;
* accesso IAM controllato.

### IAM

Lambda deve disporre esclusivamente dei permessi necessari.

Ad esempio, un ruolo dedicato alla generazione degli upload URL non dovrebbe ottenere automaticamente accesso generalizzato a tutti i bucket o a tutte le operazioni S3.

---

## Encryption

I file devono essere cifrati at rest in Amazon S3.

Le opzioni possono includere:

* SSE-S3;
* SSE-KMS.

La scelta definitiva deve essere coerente con i requisiti di sicurezza, auditing e gestione delle chiavi.

Anche le comunicazioni client → Amazon S3 devono utilizzare HTTPS.

---

## Observability

Il flow deve essere osservabile end-to-end.

Gli elementi principali sono:

### CloudWatch

Monitoraggio di:

* Lambda invocations;
* Lambda errors;
* API Gateway errors;
* SQS messages;
* DLQ messages;
* processing failures.

### X-Ray

Tracing delle componenti applicative quando supportato dal flow.

### Correlation ID

La richiesta dovrebbe mantenere un correlation ID attraverso le principali fasi:

```text
API Request
   │
   ▼
Lambda
   │
   ▼
S3 Upload
   │
   ▼
Event
   │
   ▼
SQS
   │
   ▼
Worker
```

L'event ID deve essere utilizzato per identificare e tracciare l'elaborazione asincrona.

I log non devono contenere contenuti sensibili o credenziali.

---

## Performance

Il direct upload verso Amazon S3 permette di separare il trasferimento del file dal processing applicativo.

Questo consente di:

* ridurre il carico su Lambda;
* supportare file di dimensioni maggiori;
* gestire upload concorrenti;
* scalare separatamente API e storage;
* elaborare i file in modo asincrono.

Il processing successivo deve essere indipendente dalla durata della richiesta HTTP iniziale quando non necessario.

---

## Consistency Model

Il flow utilizza una combinazione di consistenza immediata ed eventuale.

### Immediate

L'autorizzazione e la creazione dei metadata applicativi possono essere gestite tramite Aurora PostgreSQL.

### Eventual

Il processing successivo all'upload può essere asincrono:

```text
S3
 │
 ▼
EventBridge
 │
 ▼
SQS
 │
 ▼
Worker
```

Di conseguenza, tra il completamento dell'upload e lo stato finale del media può esistere un intervallo temporale.

Il frontend deve poter rappresentare correttamente stati come:

```text
PENDING
PROCESSING
READY
FAILED
```

---

## Complete Sequence

```text
User
 │
 ▼
Next.js
 │
 ▼
API Gateway
 │
 ▼
Lambda
 │
 ├── Authenticate
 ├── Authorize
 ├── Validate request
 ├── Create media metadata
 └── Generate presigned URL
 │
 ▼
Next.js
 │
 │ Direct Upload
 ▼
Amazon S3
 │
 ▼
EventBridge
 │
 ▼
SQS
 │
 ▼
Lambda Worker
 │
 ├── Validate
 ├── Process
 ├── Update metadata
 └── Emit optional domain event
 │
 ▼
Aurora PostgreSQL
```

---

## Failure Isolation

Il fallimento del processing asincrono non deve necessariamente impedire il completamento dell'upload del file.

Esempio:

```text
S3 Upload
   │
   ▼
SUCCESS
   │
   ▼
Async Processing
   │
   ▼
FAILURE
```

Il file può rimanere disponibile mentre il sistema registra lo stato:

```text
FAILED
```

e permette successivamente:

* retry;
* manual reprocessing;
* automatic reconciliation.

Questo separa il successo del trasferimento dal successo dell'elaborazione.

---

## Future Enhancements

Possibili evoluzioni:

* multipart upload;
* resumable uploads;
* image resizing;
* thumbnail generation;
* virus/malware scanning;
* metadata extraction;
* document preview;
* media versioning;
* automatic cleanup;
* reconciliation jobs;
* S3 lifecycle policies;
* Transactional Outbox;
* AWS Step Functions per workflow complessi.

Queste funzionalità non fanno parte dell'implementazione iniziale e devono essere introdotte in funzione dei requisiti.

---

## Open Decisions

Restano da definire:

* durata delle presigned URL;
* dimensione massima dei file;
* content type supportati;
* struttura definitiva degli object key;
* strategia di creazione dei metadata;
* stati del media;
* SSE-S3 vs SSE-KMS;
* configurazione CORS;
* gestione degli orphan objects;
* strategia di reconciliation;
* retry policy;
* DLQ;
* idempotency strategy;
* eventuale malware scanning;
* image processing;
* thumbnail generation;
* multipart upload;
* lifecycle policies;
* retention dei file;
* eventuale versioning;
* audit requirements.

---

## Related Documentation

* [Architecture Overview](../architecture/high-level.md)
* [AWS Services](../architecture/aws-services.md)
* [Data Architecture](../architecture/data.md)
* [Event-Driven Architecture](../architecture/events.md)
* [Security Architecture](../architecture/security.md)
* [Storage Infrastructure](../infrastructure/storage.md)
* [Messaging Infrastructure](../infrastructure/messaging.md)
* [Security Infrastructure](../infrastructure/security.md)
* [Observability Infrastructure](../infrastructure/observability.md)
* [Property Creation Flow](./property-creation.md)
* [Property Search Flow](./property-search.md)

---

## Implementation Status

**Status:** Documentation only.

Questo documento descrive il comportamento architetturale previsto.

L'implementazione effettiva tramite Terraform, Lambda, API Gateway, Amazon S3, Amazon EventBridge e Amazon SQS verrà definita in una fase successiva.

---
