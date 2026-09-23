# Data Architecture

## Overview

La piattaforma utilizza diversi servizi AWS per gestire dati transazionali, file, documenti e funzionalità di ricerca.

L'architettura separa le responsabilità tra:

* database relazionale;
* object storage;
* search engine;
* metadata e riferimenti;
* processi di sincronizzazione asincrona.

Il principio principale è mantenere una chiara distinzione tra **source of truth** e sistemi derivati utilizzati per funzionalità specifiche.

## Architecture Diagram

![Data Architecture](./diagrams/data-flow.jpeg)

## Data Domains

I principali domini applicativi comprendono:

* Users;
* Properties;
* CRM;
* Media;
* Documents;
* Search Indexes;
* Application Metadata.

I dati transazionali vengono mantenuti nel database relazionale, mentre file e contenuti binari vengono archiviati separatamente.

## Amazon Aurora PostgreSQL

Amazon Aurora PostgreSQL costituisce la **primary data store** della piattaforma.

Aurora contiene i dati strutturati e transazionali dell'applicazione, tra cui:

* utenti;
* immobili;
* informazioni CRM;
* relazioni tra entità;
* configurazioni applicative;
* metadata dei file;
* stato delle operazioni applicative.

Aurora rappresenta la **source of truth** per i dati transazionali.

Il modello relazionale consente di mantenere:

* consistenza dei dati;
* relazioni tra entità;
* vincoli applicativi;
* transazioni;
* integrità referenziale.

## RDS Proxy

RDS Proxy viene utilizzato come livello intermedio tra le funzioni AWS Lambda e Amazon Aurora PostgreSQL.

Il flusso principale è:

```text
Lambda
   │
   ▼
RDS Proxy
   │
   ▼
Aurora PostgreSQL
```

RDS Proxy consente di gestire in modo più efficiente le connessioni al database in presenza di workload Serverless caratterizzati da esecuzioni concorrenti.

Le funzioni Lambda non devono quindi gestire direttamente una grande quantità di connessioni persistenti verso Aurora.

## Amazon S3

Amazon S3 viene utilizzato per archiviare dati non relazionali e contenuti binari.

Esempi:

* immagini degli immobili;
* documenti;
* allegati;
* file caricati dagli utenti;
* altri media applicativi.

Il database non memorizza direttamente il contenuto binario dei file.

Invece, Aurora conserva i metadata necessari per identificare e gestire gli oggetti presenti in S3.

Esempio concettuale:

```text
Aurora PostgreSQL
      │
      ├── file_id
      ├── object_key
      ├── content_type
      ├── file_size
      └── metadata
               │
               ▼
              S3
               │
               └── binary content
```

## File Access

I file possono essere trasferiti utilizzando **presigned URLs**.

Il flusso concettuale per un upload è:

```text
User
  │
  ▼
API
  │
  ▼
Lambda
  │
  ├── create upload metadata
  │
  └── generate presigned URL
              │
              ▼
             S3
```

Il client può quindi caricare direttamente il file su S3 senza far transitare il contenuto attraverso Lambda quando non necessario.

Dopo il caricamento, un evento può essere utilizzato per avviare eventuali elaborazioni asincrone.

## Amazon OpenSearch

Amazon OpenSearch viene utilizzato come **search and indexing layer**.

OpenSearch non rappresenta la source of truth dei dati applicativi.

Il suo ruolo è fornire funzionalità ottimizzate per:

* full-text search;
* filtering;
* sorting;
* faceted search;
* ricerca di immobili;
* query complesse orientate alla ricerca.

Il database relazionale rimane il sistema principale per i dati transazionali.

## Search Index

Gli indici OpenSearch rappresentano una proiezione dei dati presenti nel database.

Il modello concettuale è:

```text
Aurora PostgreSQL
       │
       │ domain/application event
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

Questo approccio permette di separare il workload transazionale dal workload di ricerca.

Eventuali ritardi temporanei nella sincronizzazione dell'indice non devono compromettere la consistenza dei dati transazionali presenti in Aurora.

## Data Synchronization

La sincronizzazione tra Aurora e OpenSearch viene gestita tramite processi applicativi ed eventi.

Esempi di eventi:

* `PropertyCreated`;
* `PropertyUpdated`;
* `PropertyPublished`;
* `PropertyDeleted`.

Il consumer dell'evento aggiorna l'indice OpenSearch corrispondente.

La strategia definitiva di sincronizzazione, inclusi eventuali meccanismi di retry, idempotency e recovery, verrà definita durante la progettazione dell'implementazione.

## Source of Truth

La responsabilità dei dati viene separata come segue:

| Data | Sys
