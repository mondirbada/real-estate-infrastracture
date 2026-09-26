# Application Flows

## Overview

La directory `flows/` documenta i principali flussi applicativi della piattaforma.

Mentre `architecture/` descrive **come è composta l'architettura**, e `infrastructure/` descrive **come devono essere organizzate le risorse AWS**, questa directory descrive **cosa succede quando un utente o un sistema esegue una specifica operazione**.

I flussi descritti devono essere sufficientemente concreti da permettere di comprendere:

* quali componenti partecipano;
* quale componente avvia il flusso;
* quali chiamate vengono eseguite;
* quali dati vengono letti o modificati;
* quali eventi vengono generati;
* quali operazioni sono sincrone;
* quali operazioni sono asincrone;
* come vengono gestiti errori e retry;
* quali sistemi rappresentano la source of truth.

---

# Flow Documentation Principles

I flow devono rispettare alcuni principi.

## Separation of Concerns

La documentazione del flow non deve duplicare completamente la documentazione architetturale.

Deve invece concentrarsi sulla sequenza delle operazioni.

Esempio:

```text
User
  │
  ▼
API Gateway
  │
  ▼
Lambda
  │
  ▼
Aurora PostgreSQL
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

Il significato e la responsabilità dei singoli servizi sono descritti nei documenti di `architecture/` e `infrastructure/`.

---

# Flow Categories

I flussi iniziali previsti sono:

```text
flows/
├── README.md
├── property-creation.md
├── property-search.md
├── media-upload.md
└── notifications.md
```

## Property Creation

Descrive il processo di creazione di una nuova proprietà.

Comprende:

* API request;
* authentication;
* validation;
* persistence;
* domain event;
* asynchronous processing;
* search indexing.

---

## Property Search

Descrive il processo di ricerca delle proprietà.

Comprende:

* client request;
* API layer;
* search query;
* OpenSearch;
* eventuali dati provenienti da Aurora;
* response composition.

Il flow deve distinguere tra search data e transactional data.

---

## Media Upload

Descrive il processo di caricamento di immagini e documenti.

Comprende:

* authorization;
* presigned URL;
* upload verso Amazon S3;
* metadata;
* S3 events;
* asynchronous processing.

---

## Notifications

Descrive il processo di invio delle notifiche.

Comprende:

* business event;
* EventBridge;
* workflow orchestration;
* eventuale queue;
* Lambda;
* Amazon SES;
* retry e failure handling.

---

# Flow Structure

Ogni flow deve seguire una struttura comune.

Template:

```markdown
# Flow Name

## Overview

Short description of the flow.

## Trigger

What starts the flow.

## Actors and Components

List of users and technical components involved.

## Flow

Step-by-step description.

## Sequence

Visual representation of the flow.

## Data

Data involved in the operation.

## Synchronous Operations

Operations executed as part of the request.

## Asynchronous Operations

Operations executed asynchronously.

## Events

Events generated or consumed.

## Error Handling

Errors, retries, DLQs and failure scenarios.

## Security

Authentication, authorization and access controls.

## Observability

Logs, metrics, traces and correlation identifiers.

## Idempotency

How duplicate requests or events are handled.

## Consistency

Transactional and eventual consistency considerations.

## Performance

Relevant latency, throughput and scaling considerations.

## Related Documentation

Links to architecture and infrastructure documents.
```

Non tutte le sezioni devono essere valorizzate nello stesso livello di dettaglio.

---

# Trigger

Ogni flow deve indicare chiaramente il proprio trigger.

I trigger possono essere:

* user action;
* HTTP request;
* scheduled execution;
* S3 event;
* EventBridge event;
* SQS message;
* Step Functions execution;
* system event.

Esempio:

```text
Trigger
    │
    ▼
POST /properties
```

oppure:

```text
S3 Object Created
    │
    ▼
EventBridge
```

---

# Actors and Components

Ogni flow deve distinguere tra:

### User

L'utente o client che avvia l'operazione.

### Application Components

Componenti applicativi come:

* API Gateway;
* Lambda;
* frontend;
* workers.

### Data Components

Componenti che persistono o indicizzano dati:

* Aurora PostgreSQL;
* S3;
* OpenSearch.

### Infrastructure Services

Servizi AWS utilizzati per orchestrazione o integrazione:

* EventBridge;
* SQS;
* Step Functions;
* SES.

---

# Synchronous vs Asynchronous

Ogni flow deve distinguere chiaramente le operazioni sincrone da quelle asincrone.

Esempio:

```text
Synchronous
──────────────────────────────

Client
  │
  ▼
API Gateway
  │
  ▼
Lambda
  │
  ▼
Aurora
  │
  ▼
HTTP Response


Asynchronous
──────────────────────────────

Lambda
  │
  ▼
EventBridge
  │
  ▼
SQS
  │
  ▼
Worker
  │
  ▼
OpenSearch
```

Questa distinzione è particolarmente importante per i flussi Event-Driven.

Il client non deve essere costretto ad attendere operazioni che non sono necessarie per completare la propria request.

---

# Events

Quando un flow genera un evento, deve essere documentato:

* event type;
* producer;
* consumer;
* event version;
* payload rilevante;
* delivery mechanism;
* retry behavior;
* idempotency requirements.

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

Gli event contracts devono rimanere compatibili con i consumer oppure prevedere una strategia esplicita di versioning.

---

# Error Handling

Ogni flow deve descrivere i principali failure scenarios.

Esempi:

```text
Validation Error
       │
       ▼
HTTP 4xx


Database Error
       │
       ▼
Application Error
       │
       ▼
HTTP 5xx / retry


Async Processing Error
       │
       ▼
SQS Retry
       │
       ▼
Dead-Letter Queue
```

Per ogni errore rilevante deve essere chiaro:

* dove viene rilevato;
* se viene effettuato un retry;
* se il retry è automatico;
* se il messaggio viene inviato a una DLQ;
* se è necessario un intervento manuale.

---

# Idempotency

I flow asincroni devono considerare la possibilità di ricevere lo stesso evento o messaggio più di una volta.

L'implementazione dovrà quindi prevedere meccanismi di idempotency quando necessari.

Esempio:

```text
Event
  │
  ▼
Consumer
  │
  ├── event already processed?
  │        │
  │       yes
  │        │
  │        ▼
  │      Ignore
  │
  └── no
       │
       ▼
   Process Event
```

L'esatto meccanismo di idempotency verrà definito in base al singolo use case.

---

# Consistency

Ogni flow deve identificare il tipo di consistency richiesto.

### Strong / Transactional Consistency

Utilizzata quando l'operazione richiede una modifica consistente del transactional data store.

Esempio:

```text
Create Property
      │
      ▼
Aurora PostgreSQL
```

### Eventual Consistency

Utilizzata per sistemi derivati.

Esempio:

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

Una proprietà può quindi essere presente in Aurora prima di essere disponibile nell'indice OpenSearch.

Questo comportamento deve essere esplicito e accettato dal relativo use case.

---

# Security

Ogni flow deve documentare i principali controlli di sicurezza.

Devono essere considerati:

* authentication;
* authorization;
* IAM permissions;
* resource policies;
* network boundaries;
* encryption;
* secret management;
* input validation;
* access to sensitive data.

Esempio:

```text
User
 │
 ▼
Cognito
 │
 ▼
API Gateway
 │
 ▼
Lambda
 │
 ├── IAM
 └── Application Authorization
```

Authentication e authorization devono essere trattate come responsabilità distinte.

---

# Observability

Ogni flow deve essere osservabile end-to-end quando tecnicamente possibile.

Devono essere considerati:

* structured logs;
* correlation ID;
* request ID;
* event ID;
* CloudWatch Metrics;
* CloudWatch Alarms;
* AWS X-Ray;
* CloudTrail quando applicabile.

Esempio:

```text
HTTP Request
    │
    ├── requestId
    │
    ▼
Lambda
    │
    ├── correlationId
    │
    ▼
EventBridge
    │
    ├── eventId
    │
    ▼
SQS
    │
    ▼
Worker
```

Questo permette di ricostruire il percorso di una singola operazione attraverso più componenti.

---

# Performance

I flow devono evidenziare i punti che possono influenzare performance e scalability.

Esempi:

* API latency;
* database query latency;
* Lambda duration;
* SQS queue depth;
* OpenSearch query latency;
* event processing delay;
* downstream service capacity.

Non è necessario definire valori numerici prima che siano disponibili requisiti reali.

I target di performance possono essere aggiunti successivamente.

---

# Failure Isolation

I flow asincroni devono essere progettati in modo da limitare il propagarsi degli errori.

Esempio:

```text
Property API
     │
     ▼
Aurora
     │
     ▼
EventBridge
     │
     ▼
SQS
     │
     ▼
Search Worker
     │
     X
   failure
     │
     ▼
DLQ
```

Un errore del search worker non dovrebbe impedire necessariamente il completamento della transazione principale in Aurora.

Questo permette di separare:

* transactional availability;
* asynchronous processing;
* search availability.

---

# Flow Diagrams

I diagrammi dei flow devono utilizzare labels in English e rappresentare principalmente:

* direction of communication;
* synchronous operations;
* asynchronous operations;
* data stores;
* event boundaries;
* retry/DLQ paths quando rilevanti.

I diagrammi devono rimanere leggibili e non devono cercare di rappresentare tutta l'infrastruttura contemporaneamente.

L'architettura completa rimane documentata nei diagrammi di `architecture/diagrams/`.

---

# Relationship with Architecture

I flow devono referenziare l'architettura invece di duplicarla.

```text
Architecture
     │
     ├── Components
     ├── Network
     ├── Security
     └── Data
           │
           ▼
        Flows
           │
           ├── Property Creation
           ├── Property Search
           ├── Media Upload
           └── Notifications
```

Questo mantiene separati:

* static architecture;
* dynamic behavior.

---

# Implementation Status

La struttura dei flow è attualmente documentata.

I singoli flow verranno implementati progressivamente:

1. `property-creation.md`
2. `property-search.md`
3. `media-upload.md`
4. `notifications.md`

La documentazione dei flow rappresenta il comportamento architetturale previsto e non costituisce ancora implementazione applicativa.

---

# Related Documentation

* [Architecture](../architecture/README.md)
* [High-Level Architecture](../architecture/high-level.md)
* [Data Architecture](../architecture/data.md)
* [Events Architecture](../architecture/events.md)
* [Security Architecture](../architecture/security.md)
* [Compute Infrastructure](../infrastructure/compute.md)
* [Database Infrastructure](../infrastructure/database.md)
* [Storage Infrastructure](../infrastructure/storage.md)
* [Messaging Infrastructure](../infrastructure/messaging.md)
* [Observability Infrastructure](../infrastructure/observability.md)
* [Environment Strategy](../environments/README.md)
* [Architecture Decisions](../decisions/README.md)
