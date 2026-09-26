# Property Search Flow

## Overview

Il **Property Search Flow** descrive il processo attraverso cui un utente ricerca le properties disponibili nella piattaforma.

La ricerca utilizza **Amazon OpenSearch Service** come search layer ottimizzato per:

* full-text search;
* filtering;
* sorting;
* faceting;
* geo-search;
* paginazione.

Amazon Aurora PostgreSQL rimane la **transactional source of truth**.

Il search index contiene una rappresentazione derivata dei dati presenti in Aurora e viene aggiornato tramite il sistema Event-Driven.

Il flow deve quindi considerare la possibilità che una modifica appena effettuata su Aurora non sia ancora immediatamente disponibile in OpenSearch.

---

# Trigger

Il flow viene avviato da una HTTP request proveniente dal frontend.

Esempio:

```text
GET /properties?city=Milan&propertyType=apartment&minPrice=200000&maxPrice=500000
```

Il contratto API definitivo verrà definito durante la progettazione dell'application layer.

---

# Actors and Components

| Component                 | Responsibility                       |
| ------------------------- | ------------------------------------ |
| User                      | Initiates the search                 |
| Next.js                   | Builds and sends the search request  |
| Amazon CloudFront         | Frontend delivery                    |
| Amazon Cognito            | User authentication when required    |
| Amazon API Gateway        | API entry point                      |
| AWS Lambda                | Search API logic                     |
| Amazon OpenSearch Service | Search and filtering                 |
| Amazon Aurora PostgreSQL  | Transactional source of truth        |
| Amazon CloudWatch         | Logs and metrics                     |
| AWS X-Ray                 | Distributed tracing where applicable |

Il flow principale non richiede necessariamente una query ad Aurora per ogni ricerca.

OpenSearch è progettato per servire il search workload.

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
OpenSearch
 │
 ▼
Search Results
 │
 ▼
API Response
```

Il percorso principale è quindi:

```text
Client
  │
  ▼
API Gateway
  │
  ▼
Lambda
  │
  ▼
OpenSearch
```

Aurora viene utilizzato come source of truth per la gestione del dato e per i processi che aggiornano l'indice.

---

# Phase 1 — Authentication

Se il search endpoint richiede autenticazione, il client deve presentare una sessione valida tramite Amazon Cognito.

Concettualmente:

```text
User
 │
 ▼
Amazon Cognito
 │
 ▼
Authenticated Request
 │
 ▼
API Gateway
```

Non tutte le future search APIs devono necessariamente richiedere lo stesso livello di authentication.

Il requisito dipenderà dal modello di accesso del prodotto.

---

# Phase 2 — Search Request

Il frontend costruisce i parametri di ricerca.

Esempio concettuale:

```text
GET /properties
    ?city=Milan
    &propertyType=apartment
    &minPrice=200000
    &maxPrice=500000
    &rooms=3
```

Possibili parametri:

* free-text query;
* city;
* region;
* property type;
* price range;
* rooms;
* surface;
* availability;
* coordinates;
* radius;
* sorting;
* pagination.

Il set definitivo dei parametri sarà definito nel contratto API.

---

# Phase 3 — API Gateway

La request raggiunge Amazon API Gateway.

```text
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
```

API Gateway gestisce il request entry point e le configurazioni relative all'API.

La validazione applicativa della query viene eseguita dalla Lambda.

---

# Phase 4 — Query Validation

La Lambda deve validare i parametri ricevuti prima di costruire la query OpenSearch.

Devono essere verificati:

* data types;
* allowed values;
* numeric ranges;
* pagination limits;
* sorting fields;
* free-text constraints;
* geo coordinates;
* maximum query complexity.

Esempio:

```text
Search Request
      │
      ▼
Query Validation
      │
      ├── invalid ──► HTTP 400
      │
      └── valid
             │
             ▼
       Build Search Query
```

I parametri controllati dal client non devono essere inseriti direttamente in query non validate.

---

# Phase 5 — Search Query Construction

La Lambda traduce i parametri API in una query compatibile con Amazon OpenSearch Service.

Esempio concettuale:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "title": "apartment"
          }
        }
      ],
      "filter": [
        {
          "term": {
            "city.keyword": "Milan"
          }
        },
        {
          "range": {
            "price": {
              "gte": 200000,
              "lte": 500000
            }
          }
        }
      ]
    }
  }
}
```

Il mapping e la query DSL definitivi saranno definiti durante la progettazione dell'indice.

---

# Phase 6 — OpenSearch Query

La Lambda invia la query ad Amazon OpenSearch Service.

```text
Lambda
   │
   ▼
OpenSearch
   │
   ▼
Search Results
```

OpenSearch gestisce:

* text matching;
* filters;
* sorting;
* scoring;
* pagination;
* geo queries;
* aggregations quando necessarie.

La query deve essere progettata in funzione del mapping dell'indice.

---

# Search Index Model

L'indice OpenSearch contiene dati derivati da Aurora.

Esempio concettuale:

```json
{
  "propertyId": "uuid",
  "title": "Apartment in Milan",
  "propertyType": "apartment",
  "city": "Milan",
  "price": 350000,
  "rooms": 4,
  "surface": 120,
  "location": {
    "lat": 45.4642,
    "lon": 9.1900
  }
}
```

Il documento può contenere campi aggiuntivi necessari alla ricerca.

La struttura definitiva dipenderà dai requisiti funzionali.

---

# Source of Truth

La responsabilità dei dati rimane separata:

```text
Aurora PostgreSQL
        │
        │ source of truth
        ▼
Application Data

OpenSearch
        │
        │ derived representation
        ▼
Search Data
```

OpenSearch non deve essere utilizzato come sostituto del database transazionale.

---

# Index Synchronization

L'indice viene aggiornato attraverso gli eventi generati dall'application layer.

Esempio:

```text
Aurora
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
   ▼
OpenSearch
```

Per gli aggiornamenti:

```text
PropertyUpdated
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
      ▼
OpenSearch Update
```

Per la cancellazione:

```text
PropertyDeleted
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
      ▼
OpenSearch Delete
```

---

# Eventual Consistency

La sincronizzazione tra Aurora e OpenSearch è eventualmente consistente.

Esempio:

```text
T0
Aurora
  │
  └── PropertyUpdated

T1
EventBridge
  │
  └── PropertyUpdated

T2
SQS
  │
  └── message available

T3
Search Worker
  │
  └── update OpenSearch

T4
OpenSearch
  │
  └── new document available
```

Durante l'intervallo `T0 → T4`, una search potrebbe restituire dati precedenti.

Questo comportamento deve essere considerato normale per il search layer.

---

# Search Result Response

La Lambda trasforma la risposta OpenSearch nel contratto API previsto.

Esempio concettuale:

```json
{
  "items": [
    {
      "propertyId": "uuid",
      "title": "Apartment in Milan",
      "propertyType": "apartment",
      "price": 350000,
      "city": "Milan",
      "rooms": 4
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 124
  }
}
```

Il formato definitivo verrà definito dall'API contract.

---

# Pagination

La ricerca deve prevedere una strategia di pagination.

Per dataset di dimensioni contenute può essere utilizzata una strategia page/offset.

Per dataset più grandi o per scenari ad alta performance possono essere valutati meccanismi specifici di OpenSearch come cursor-based pagination.

La scelta definitiva rimane un'open decision.

Il client non deve poter richiedere arbitrariamente pagine di dimensioni eccessive.

---

# Sorting

I risultati possono essere ordinati per campi supportati.

Esempi:

```text
price ASC
price DESC
createdAt DESC
surface DESC
relevance
```

I campi utilizzabili per sorting devono essere esplicitamente autorizzati dall'application layer.

Questo evita di esporre indiscriminatamente la struttura interna dell'indice.

---

# Filtering

I filtri possono essere applicati a campi strutturati.

Esempi:

```text
propertyType
city
region
price
rooms
surface
availability
```

I filtri devono essere distinti dal free-text search quando il mapping OpenSearch lo richiede.

Esempio concettuale:

```text
Full Text
    │
    ▼
Relevance

Structured Filters
    │
    ├── price
    ├── city
    ├── rooms
    └── propertyType
```

---

# Geo Search

Il sistema può supportare ricerche geografiche.

Esempio:

```text
Search properties
within 10 km
of coordinates
```

Concettualmente:

```text
User Location
      │
      ▼
Latitude / Longitude
      │
      ▼
OpenSearch Geo Query
      │
      ▼
Matching Properties
```

L'utilizzo di geo-search richiede un mapping appropriato del campo `location`.

---

# Authentication and Authorization

L'autenticazione può essere gestita tramite Amazon Cognito.

L'autorizzazione dipende dal modello applicativo.

Esempi:

* public property search;
* authenticated search;
* organization-specific properties;
* agent-specific properties;
* internal administrative search.

La Lambda deve applicare le authorization rules prima di costruire una query che potrebbe esporre dati non autorizzati.

---

# Data Visibility

La presenza di un documento nell'indice non implica automaticamente che debba essere visibile a qualsiasi utente.

Il search layer deve rispettare le regole di visibility definite dal dominio.

Esempio:

```text
Property
   │
   ├── status = published
   │        │
   │        └── public search
   │
   └── status = draft
            │
            └── restricted access
```

Le regole definitive saranno definite nell'application layer.

---

# Security

Il search endpoint deve essere protetto secondo il modello di sicurezza generale della piattaforma.

Controlli principali:

* Amazon Cognito;
* API authorization;
* IAM;
* OpenSearch access policies;
* encryption in transit;
* encryption at rest;
* VPC networking quando previsto;
* CloudWatch logging.

OpenSearch non deve essere esposto direttamente al browser.

Il client deve passare attraverso l'API layer.

```text
Browser
   │
   ▼
API Gateway
   │
   ▼
Lambda
   │
   ▼
OpenSearch
```

---

# OpenSearch Access

La Lambda deve utilizzare un'identità AWS autorizzata ad accedere al relativo OpenSearch domain o collection.

Il client non deve possedere direttamente credentials OpenSearch.

Concettualmente:

```text
User
 │
 ▼
API
 │
 ▼
Lambda IAM Role
 │
 ▼
OpenSearch
```

Questo mantiene il controllo dell'accesso all'interno del backend.

---

# Error Handling

## Invalid Query

```text
Request
  │
  ▼
Validation
  │
  X
Invalid Parameters
  │
  ▼
HTTP 400
```

---

## OpenSearch Error

Se OpenSearch non è disponibile:

```text
Lambda
  │
  ▼
OpenSearch
  │
  X
Error
```

La Lambda deve restituire un errore appropriato senza esporre dettagli infrastrutturali al client.

L'errore deve essere registrato tramite observability tools.

---

## Timeout

Se la query supera il timeout previsto:

```text
Lambda
  │
  ▼
OpenSearch
  │
  X
Timeout
```

La query deve essere progettata per evitare richieste eccessivamente costose.

Possono essere utilizzati:

* pagination limits;
* query validation;
* field restrictions;
* timeout configuration;
* controlled aggregations.

---

## Empty Results

Una ricerca senza risultati non rappresenta un errore.

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

La response HTTP rimane normalmente una risposta di successo.

---

# Search Index Failure

Se un evento di sincronizzazione fallisce:

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
Search Worker
  │
  X
OpenSearch
```

la message può essere ritentata tramite SQS.

Dopo i retry previsti può essere spostata nella Dead-Letter Queue.

Questo failure non modifica il dato presente in Aurora.

---

# Reconciliation

Poiché OpenSearch è un sistema derivato, deve essere possibile verificare la coerenza tra:

```text
Aurora
   │
   │ source of truth
   ▼
Expected State

OpenSearch
   │
   │ derived state
   ▼
Actual Search Index
```

In futuro potrà essere introdotto un reconciliation process per individuare:

* documenti mancanti;
* documenti obsoleti;
* documenti duplicati;
* documenti non più presenti in Aurora.

La strategia di reconciliation rimane un'open decision.

---

# Idempotency

I search workers devono essere idempotenti.

Un `PropertyUpdated` event può essere consegnato più volte.

L'aggiornamento deve produrre lo stesso stato finale.

Esempio:

```text
PropertyUpdated
      │
      ▼
Search Worker
      │
      ▼
OpenSearch document
      │
      ▼
propertyId = stable identifier
```

Per delete:

```text
PropertyDeleted
      │
      ▼
Search Worker
      │
      ▼
Delete by propertyId
```

L'operazione deve essere sicura anche se l'evento viene elaborato nuovamente.

---

# Performance

Le performance del search layer dipendono da:

* index mapping;
* query complexity;
* shard configuration;
* document size;
* filters;
* sorting;
* aggregations;
* result size;
* concurrency.

La Lambda deve evitare di trasformare una semplice search request in una serie di query inutilmente costose.

Il search endpoint deve inoltre avere limiti espliciti su:

* page size;
* query complexity;
* aggregation size;
* eventuali free-text parameters.

---

# Caching

Il caching può essere valutato in una fase successiva.

Possibili livelli:

```text
Client
  │
  ▼
CloudFront / API caching
  │
  ▼
Lambda
  │
  ▼
OpenSearch
```

La cache deve essere introdotta solo quando:

* il workload lo giustifica;
* la freshness requirement è compatibile;
* la cache invalidation è gestibile.

Non è parte obbligatoria della prima implementazione.

---

# Observability

Il flow deve essere osservabile end-to-end.

Metriche principali:

### API

* request count;
* latency;
* 4xx;
* 5xx.

### Lambda

* invocation count;
* duration;
* errors;
* throttles;
* concurrency.

### OpenSearch

* search latency;
* errors;
* rejected requests;
* cluster health;
* capacity metrics.

### Synchronization

* SQS queue depth;
* oldest message age;
* DLQ message count;
* indexing failures;
* indexing latency.

---

# Correlation and Tracing

Una search request deve poter essere correlata con i relativi log.

Concettualmente:

```text
Request ID
    │
    ▼
API Gateway
    │
    ▼
Lambda
    │
    ▼
OpenSearch
```

Per le operazioni asincrone di indexing:

```text
Event ID
    │
    ▼
EventBridge
    │
    ▼
SQS
    │
    ▼
Search Worker
```

Questo permette di distinguere:

* user request;
* search operation;
* indexing operation.

---

# Availability

La disponibilità della search API dipende dalla disponibilità di:

* API Gateway;
* Lambda;
* OpenSearch.

Aurora non è necessariamente presente nel critical path della singola search request.

Questo contribuisce a separare il search workload dal transactional workload.

---

# Consistency Model

Il modello complessivo è:

```text
Aurora PostgreSQL
       │
       │ source of truth
       ▼
Domain Events
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
       ▼
OpenSearch
       │
       │ eventual consistency
       ▼
Search API
```

La search API deve quindi essere considerata una rappresentazione derivata dello stato transactional.

---

# Complete Sequence

```text
User
 │
 │ Search Request
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
 ├── authenticate / authorize
 ├── validate query
 └── build OpenSearch query
          │
          ▼
      OpenSearch
          │
          ▼
      Search Results
          │
          ▼
       Lambda
          │
          ▼
      HTTP Response
          │
          ▼
        User
```

La sincronizzazione dell'indice avviene separatamente:

```text
Aurora
  │
  ▼
Domain Event
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
  ▼
OpenSearch
```

---

# Failure Isolation

La search API e il transactional system devono essere il più possibile disaccoppiati.

```text
              ┌──────────────► OpenSearch
              │
Aurora ───────┤
              │
              └──────────────► Event Processing
```

Un problema nel search indexing non deve modificare o rollbackare i dati transactional.

Allo stesso modo, una search request non dovrebbe richiedere una query ad Aurora se il dato necessario è già correttamente rappresentato nell'indice.

---

# Future Enhancements

Possibili evoluzioni:

* advanced geo-search;
* faceted search;
* relevance tuning;
* autocomplete;
* synonyms;
* ranking customization;
* search suggestions;
* caching;
* index aliases;
* blue/green index migration;
* index versioning;
* reconciliation jobs;
* bulk reindexing;
* search analytics.

Queste funzionalità dovranno essere valutate in base ai requisiti applicativi.

---

# Open Decisions

Le seguenti decisioni rimangono da definire:

* [ ] API search contract;
* [ ] authentication requirements;
* [ ] authorization model;
* [ ] public vs private properties;
* [ ] OpenSearch index mapping;
* [ ] text analysis;
* [ ] searchable fields;
* [ ] sortable fields;
* [ ] filterable fields;
* [ ] geo-search requirements;
* [ ] pagination strategy;
* [ ] maximum page size;
* [ ] relevance strategy;
* [ ] aggregation requirements;
* [ ] search timeout;
* [ ] index versioning;
* [ ] reindex strategy;
* [ ] reconciliation strategy;
* [ ] caching strategy;
* [ ] search analytics;
* [ ] performance targets.

---

# Related Documentation

* [Application Flows](README.md)
* [Property Creation](property-creation.md)
* [High-Level Architecture](../architecture/high-level.md)
* [Data Architecture](../architecture/data.md)
* [Events Architecture](../architecture/events.md)
* [Security Architecture](../architecture/security.md)
* [Compute Infrastructure](../infrastructure/compute.md)
* [Database Infrastructure](../infrastructure/database.md)
* [Messaging Infrastructure](../infrastructure/messaging.md)
* [Observability Infrastructure](../infrastructure/observability.md)
* [Environment Strategy](../environments/README.md)
* [ADR 001 — Serverless Architecture](../decisions/001-serverless-architecture.md)

---

# Implementation Status

Il flow è documentato a livello architetturale.

Non sono ancora presenti:

* search API implementation;
* OpenSearch index;
* OpenSearch mapping;
* search query implementation;
* Lambda search function;
* indexing worker;
* EventBridge rules;
* SQS queues;
* reconciliation process;
* Terraform resources.

Questi componenti saranno implementati nelle fasi successive del progetto.
