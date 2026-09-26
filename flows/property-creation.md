# Property Creation Flow

## Overview

Il **Property Creation Flow** descrive il processo attraverso cui un utente autenticato crea una nuova property nella piattaforma.

Il flusso è suddiviso in due fasi principali:

1. **Synchronous transaction** — validazione della request e persistenza della property in Amazon Aurora PostgreSQL.
2. **Asynchronous processing** — propagazione dell'evento e aggiornamento dell'indice Amazon OpenSearch Service.

La persistenza transazionale su Aurora rappresenta il punto di completamento della creazione della property.

L'indicizzazione su OpenSearch è invece eventualemente consistente e non deve bloccare la risposta HTTP principale.

---

# Trigger

Il flow viene avviato da una HTTP request proveniente dal frontend.

Esempio concettuale:

```text
POST /properties
```

Il client deve essere autenticato tramite Amazon Cognito.

La request contiene i dati necessari alla creazione della property.

Esempio concettuale:

```json
{
  "title": "Apartment in Milan",
  "description": "Modern apartment near the city center",
  "propertyType": "apartment",
  "price": 350000,
  "city": "Milan",
  "rooms": 4
}
```

Il payload definitivo verrà definito durante la progettazione dell'application layer.

---

# Actors and Components

I principali componenti coinvolti sono:

| Component                 | Responsibility                 |
| ------------------------- | ------------------------------ |
| User                      | Initiates property creation    |
| Next.js                   | Sends API request              |
| Amazon Cognito            | User authentication            |
| Amazon CloudFront         | Frontend delivery              |
| Amazon API Gateway        | API entry point                |
| AWS Lambda                | Property application logic     |
| Amazon RDS Proxy          | Database connection management |
| Amazon Aurora PostgreSQL  | Transactional source of truth  |
| Amazon EventBridge        | Event routing                  |
| Amazon SQS                | Async buffering and retry      |
| AWS Lambda Worker         | Search indexing                |
| Amazon OpenSearch Service | Search index                   |

---

# High-Level Flow

```text
User
 │
 ▼
Next.js
 │
 ▼
CloudFront
 │
 ▼
API Gateway
 │
 ▼
Lambda
 │
 ▼
RDS Proxy
 │
 ▼
Aurora PostgreSQL
 │
 │
 │ PropertyCreated
 ▼
EventBridge
 │
 ▼
SQS
 │
 ▼
Lambda Worker
 │
 ▼
OpenSearch
```

La parte sopra la separazione tra Aurora ed EventBridge rappresenta principalmente il percorso sincrono.

La parte successiva rappresenta il percorso asincrono.

---

# Phase 1 — Authentication

Prima di creare la property, il client deve essere autenticato.

Il frontend utilizza Amazon Cognito per ottenere le credentials necessarie all'accesso alle API.

Concettualmente:

```text
User
 │
 ▼
Amazon Cognito
 │
 ▼
Authenticated Session
 │
 ▼
API Request
```

L'autenticazione identifica l'utente.

L'autorizzazione alla creazione della property viene invece verificata dall'application layer secondo le regole del dominio.

---

# Phase 2 — API Request

Il frontend invia la request verso l'API.

```text
Next.js
   │
   ▼
CloudFront
   │
   ▼
API Gateway
```

API Gateway rappresenta il punto di ingresso dell'API.

La request deve contenere le informazioni necessarie per:

* identificare il chiamante;
* validare il payload;
* creare la property;
* eventualmente associare la property all'utente o all'organizzazione corretta.

---

# Phase 3 — Authorization

Dopo l'autenticazione, il sistema deve determinare se l'utente può creare una property.

L'autorizzazione può dipendere da:

* user identity;
* user role;
* organization;
* ownership;
* application permissions.

Il modello definitivo di authorization sarà definito durante la progettazione dell'application layer.

Concettualmente:

```text
Authenticated User
       │
       ▼
API Gateway
       │
       ▼
Lambda
       │
       ▼
Authorization
       │
       ├── allowed ──► continue
       │
       └── denied  ──► HTTP 403
```

Authentication e authorization rimangono responsabilità distinte.

---

# Phase 4 — Input Validation

La Lambda responsabile della property deve validare il payload prima di eseguire la transazione.

Devono essere verificati almeno:

* required fields;
* data types;
* allowed values;
* numeric constraints;
* string constraints;
* business validation;
* eventuali ownership constraints.

Esempio:

```text
Request
   │
   ▼
Schema Validation
   │
   ├── invalid ──► HTTP 400
   │
   └── valid
         │
         ▼
     Business Validation
```

La validazione applicativa deve essere distinta dalla validazione strutturale della request.

---

# Phase 5 — Property Creation

Dopo authentication, authorization e validation, la Lambda esegue la creazione della property.

Il flusso verso il database è:

```text
Lambda
   │
   ▼
RDS Proxy
   │
   ▼
Aurora PostgreSQL
```

Amazon Aurora PostgreSQL rappresenta la source of truth per la property.

La property deve ricevere un identificativo univoco.

Esempio:

```text
propertyId = UUID
```

Il modello dati definitivo verrà definito nella progettazione dello schema database.

---

# Transaction Boundary

La creazione della property deve essere completata all'interno di una transazione database quando l'operazione coinvolge più modifiche che devono essere atomiche.

Esempio concettuale:

```text
BEGIN
   │
   ├── Insert Property
   │
   ├── Insert Property Metadata
   │
   └── Commit
```

Se la transazione fallisce:

```text
BEGIN
   │
   ├── Insert Property
   │
   X
 Error
   │
   ▼
ROLLBACK
```

L'esatto transaction boundary dipenderà dal modello dati definitivo.

---

# Phase 6 — Successful Response

Dopo il commit della transazione, la Lambda può restituire una risposta HTTP positiva.

Esempio concettuale:

```json
{
  "propertyId": "uuid",
  "status": "created"
}
```

Il client non deve attendere l'indicizzazione OpenSearch per ricevere la conferma della creazione della property.

Concettualmente:

```text
Aurora Commit
     │
     ▼
HTTP 201 Created
```

Questo definisce il completamento della fase sincrona.

---

# Phase 7 — Domain Event

Dopo la persistenza della property viene generato un domain event.

Esempio:

```json
{
  "eventType": "PropertyCreated",
  "eventId": "uuid",
  "occurredAt": "timestamp",
  "source": "property-service",
  "version": 1,
  "data": {
    "propertyId": "uuid"
  }
}
```

L'evento contiene principalmente l'identificativo della property.

Il consumer può successivamente recuperare i dati necessari dalla source of truth.

Questa scelta evita di rendere il payload dell'evento eccessivamente accoppiato al modello completo della property.

---

# Event Publication

L'evento viene pubblicato su Amazon EventBridge.

```text
Aurora
   │
   │
   ▼
Application / Lambda
   │
   ▼
EventBridge
```

È importante distinguere la transazione database dalla pubblicazione dell'evento.

Amazon Aurora PostgreSQL non viene considerato un producer diretto di EventBridge events in questo flow.

L'evento viene generato dal livello applicativo.

---

# Event Reliability

La pubblicazione dell'evento introduce una potenziale differenza tra:

```text
Database Transaction
        │
        ▼
Property persisted
        │
        X
Event publication failure
```

Questa situazione deve essere gestita esplicitamente.

Una possibile evoluzione futura è l'utilizzo di un **Transactional Outbox Pattern**:

```text
BEGIN
   │
   ├── Insert Property
   │
   ├── Insert Outbox Event
   │
   └── Commit
          │
          ▼
      Outbox Processor
          │
          ▼
      EventBridge
```

Il Transactional Outbox non viene considerato parte obbligatoria della prima implementazione finché i requisiti di event delivery non lo rendono necessario.

Rimane una decisione tecnica da validare durante l'implementazione.

---

# Phase 8 — EventBridge Routing

Amazon EventBridge riceve `PropertyCreated` e applica le event rules configurate.

Esempio:

```text
PropertyCreated
      │
      ▼
EventBridge Event Bus
      │
      ├──────────► Search Queue
      │
      └──────────► Other Consumers
```

Le rules devono essere basate su event attributes sufficientemente stabili.

Esempio concettuale:

```text
source = property-service
eventType = PropertyCreated
```

---

# Phase 9 — SQS Buffering

L'evento destinato all'indicizzazione viene inviato a una Amazon SQS queue.

```text
EventBridge
    │
    ▼
SQS
    │
    ▼
Lambda Worker
```

Amazon SQS fornisce:

* buffering;
* decoupling;
* retry;
* failure isolation;
* eventuale Dead-Letter Queue.

Il worker non deve dipendere dalla velocità con cui l'API riceve le request.

---

# Phase 10 — Search Indexing

Una Lambda Worker riceve il messaggio dalla SQS queue.

Il worker:

1. legge l'event;
2. estrae `propertyId`;
3. recupera i dati necessari;
4. costruisce il search document;
5. aggiorna Amazon OpenSearch Service.

Concettualmente:

```text
SQS
 │
 ▼
Lambda Worker
 │
 ├── propertyId
 │
 ▼
Aurora
 │
 ▼
Property Data
 │
 ▼
OpenSearch
```

Il recupero dei dati da Aurora permette di mantenere il search document derivato dalla source of truth.

---

# Search Document

Il documento indicizzato in OpenSearch può contenere una rappresentazione ottimizzata per la ricerca.

Esempio concettuale:

```json
{
  "propertyId": "uuid",
  "title": "Apartment in Milan",
  "propertyType": "apartment",
  "price": 350000,
  "city": "Milan",
  "rooms": 4
}
```

Il mapping definitivo verrà definito durante la progettazione di OpenSearch.

OpenSearch non deve diventare la source of truth della property.

---

# Eventual Consistency

Dopo il commit su Aurora può esistere un breve intervallo durante il quale:

```text
Aurora
   │
   ├── Property exists
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
   ▼
OpenSearch
```

la property esiste già in Aurora ma non è ancora presente nell'indice OpenSearch.

Questo comportamento è previsto.

La consistenza tra Aurora e OpenSearch è quindi **eventual consistency**.

---

# Error Handling

## Validation Error

Se il payload non è valido:

```text
API Gateway
   │
   ▼
Lambda
   │
   X
Validation Error
   │
   ▼
HTTP 400
```

Nessuna modifica database deve essere effettuata.

---

## Authorization Error

Se l'utente non è autorizzato:

```text
Authorization
     │
     X
   denied
     │
     ▼
HTTP 403
```

La property non viene creata.

---

## Database Error

Se la transazione database fallisce:

```text
Lambda
   │
   ▼
RDS Proxy
   │
   ▼
Aurora
   │
   X
Database Error
```

La request deve restituire un errore appropriato e non deve pubblicare un `PropertyCreated` event per una property non persistita.

---

## Event Publication Error

Se la property è stata persistita ma la pubblicazione dell'evento fallisce, esiste il rischio di una property correttamente salvata ma non indicizzata.

Questa situazione deve essere monitorata e gestita tramite:

* retry;
* monitoring;
* eventuale outbox;
* reconciliation process, se necessario.

---

## Search Indexing Error

Se il worker non riesce ad aggiornare OpenSearch:

```text
SQS
 │
 ▼
Lambda Worker
 │
 X
OpenSearch Error
```

il messaggio deve poter essere ritentato secondo la configurazione della queue.

Dopo il numero massimo di tentativi previsto:

```text
SQS
 │
 ▼
Dead-Letter Queue
```

L'errore di indicizzazione non deve rollbackare la transazione originale su Aurora.

---

# Idempotency

Il flow deve essere idempotente per quanto riguarda l'elaborazione degli eventi.

Un `PropertyCreated` event potrebbe essere consegnato più di una volta.

Il worker deve quindi poter gestire duplicate processing senza creare uno stato inconsistente in OpenSearch.

Esempio:

```text
PropertyCreated
      │
      ▼
Lambda Worker
      │
      ├── index document by propertyId
      │
      └── repeated event
               │
               ▼
        same propertyId
               │
               ▼
       deterministic update
```

Il `propertyId` può fungere da identificativo stabile del search document.

Il meccanismo definitivo di deduplication e idempotency verrà definito durante l'implementazione.

---

# Security

Il flow deve applicare Least Privilege.

### User

L'utente deve essere autenticato tramite Amazon Cognito.

### API Gateway

API Gateway deve verificare l'autenticazione secondo la configurazione prevista.

### Lambda

La Property Lambda deve avere permissions limitate alle risorse necessarie.

Esempio concettuale:

```text
Property Lambda
   │
   ├── RDS Proxy
   ├── EventBridge
   └── CloudWatch Logs
```

### Search Worker

Il worker deve avere permissions limitate a:

```text
Search Worker
   │
   ├── SQS
   ├── Aurora / RDS Proxy
   ├── OpenSearch
   └── CloudWatch Logs
```

Le permissions IAM definitive verranno definite nell'implementazione Terraform.

---

# Data Access

Il database contiene la source of truth.

Il worker che costruisce l'indice deve utilizzare un access pattern controllato verso Aurora.

Le credenziali database non devono essere hardcoded.

Devono essere gestite tramite il meccanismo di authentication e secret management definito per il database layer.

Riferimenti:

* [Database Infrastructure](../infrastructure/database.md)
* [Security Infrastructure](../infrastructure/security.md)

---

# Observability

Il flow deve essere tracciabile end-to-end.

Gli elementi principali sono:

```text
HTTP Request
    │
    ├── requestId
    │
    ▼
Property Lambda
    │
    ├── correlationId
    │
    ▼
PropertyCreated
    │
    ├── eventId
    │
    ▼
SQS
    │
    ▼
Search Worker
    │
    ▼
OpenSearch
```

Devono essere monitorati almeno:

* API errors;
* Lambda errors;
* Lambda duration;
* database errors;
* EventBridge failures;
* SQS queue depth;
* SQS message age;
* DLQ messages;
* search worker errors;
* OpenSearch errors.

AWS X-Ray può essere utilizzato per la distributed tracing dove supportato e appropriato.

---

# Performance

La fase sincrona deve rimanere limitata alle operazioni necessarie per confermare la creazione della property.

Il client non deve attendere:

* indexing;
* search document creation;
* eventuali notifiche;
* ulteriori asynchronous processing.

Questo permette di separare la latency della API dalla latency dei sistemi downstream.

---

# Consistency Model

Il flow utilizza due livelli di consistency.

### Transactional

```text
Lambda
  │
  ▼
Aurora
```

La property viene creata in modo transazionale.

### Eventual

```text
Aurora
  │
  ▼
EventBridge
  │
  ▼
SQS
  │
  ▼
OpenSearch
```

L'indice search viene aggiornato successivamente.

Aurora rimane la source of truth.

---

# Complete Sequence

```text
User
 │
 │ POST /properties
 ▼
Next.js
 │
 ▼
CloudFront
 │
 ▼
API Gateway
 │
 │ authenticate
 ▼
Lambda
 │
 │ validate + authorize
 │
 ▼
RDS Proxy
 │
 ▼
Aurora PostgreSQL
 │
 │ commit
 │
 ├──────────────────────────────► HTTP 201
 │
 ▼
PropertyCreated
 │
 ▼
EventBridge
 │
 ▼
SQS
 │
 ▼
Lambda Search Worker
 │
 │ read property
 ▼
Aurora PostgreSQL
 │
 │ property data
 ▼
Lambda Search Worker
 │
 ▼
OpenSearch
```

La risposta HTTP viene restituita dopo il completamento della transazione principale e non dopo l'indicizzazione OpenSearch.

---

# Failure Isolation

Il flow separa il transactional path dal search path.

```text
                 ┌──► EventBridge ──► SQS ──► Search Worker ──► OpenSearch
                 │
Aurora ◄── Lambda
                 │
                 └──► HTTP Response
```

Un failure di OpenSearch o del search worker non deve invalidare una property già correttamente persistita in Aurora.

Questo permette di mantenere separati:

* transactional availability;
* search availability;
* asynchronous processing.

---

# Future Enhancements

Possibili evoluzioni:

* Transactional Outbox;
* automatic reconciliation tra Aurora e OpenSearch;
* bulk indexing;
* advanced retry policies;
* search document versioning;
* dead-letter processing workflow;
* event replay;
* audit trail;
* property creation notifications;
* media processing integration.

Queste evoluzioni dovranno essere introdotte senza modificare la responsabilità di Aurora come source of truth.

---

# Open Decisions

Le seguenti decisioni rimangono da definire:

* [ ] API contract definitivo;
* [ ] property schema;
* [ ] authorization model;
* [ ] transaction boundary;
* [ ] event publication strategy;
* [ ] Transactional Outbox;
* [ ] EventBridge event schema definitivo;
* [ ] SQS queue configuration;
* [ ] DLQ configuration;
* [ ] idempotency strategy;
* [ ] OpenSearch index mapping;
* [ ] search document structure;
* [ ] reconciliation strategy;
* [ ] retry policies;
* [ ] API error contract;
* [ ] observability metrics;
* [ ] performance targets.

---

# Related Documentation

* [Application Flows](README.md)
* [High-Level Architecture](../architecture/high-level.md)
* [Data Architecture](../architecture/data.md)
* [Events Architecture](../architecture/events.md)
* [Security Architecture](../architecture/security.md)
* [Compute Infrastructure](../infrastructure/compute.md)
* [Database Infrastructure](../infrastructure/database.md)
* [Messaging Infrastructure](../infrastructure/messaging.md)
* [Storage Infrastructure](../infrastructure/storage.md)
* [Observability Infrastructure](../infrastructure/observability.md)
* [Environment Strategy](../environments/README.md)
* [ADR 001 — Serverless Architecture](../decisions/001-serverless-architecture.md)

---

# Implementation Status

Il flow è documentato a livello architetturale.

Non sono ancora presenti:

* application code;
* API implementation;
* database schema;
* Terraform resources;
* EventBridge rules;
* SQS queues;
* Lambda workers;
* OpenSearch indexes.

Questi componenti saranno implementati nelle fasi successive del progetto.
