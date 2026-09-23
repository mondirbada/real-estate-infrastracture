# Compute

## Overview

Il compute layer gestisce l'esecuzione della logica applicativa e dei processi asincroni della piattaforma.

L'architettura utilizza principalmente:

* Amazon API Gateway;
* AWS Lambda;
* IAM Execution Roles;
* Lambda Layers quando appropriato;
* Lambda Event Source Mappings per i workload asincroni.

Il modello è Serverless e permette di scalare le funzioni in base al workload senza gestire server applicativi tradizionali.

## Architecture

Il flusso principale delle richieste applicative è:

```text id="4czw9h"
Client
  │
  ▼
API Gateway
  │
  ▼
Lambda
  │
  ├── RDS Proxy
  │       │
  │       ▼
  │    Aurora
  │
  ├── S3
  │
  └── EventBridge
```

I workload asincroni seguono invece un modello basato su eventi e code:

```text id="q2y0a4"
EventBridge
     │
     ▼
    SQS
     │
     ▼
Lambda Worker
     │
     ├── OpenSearch
     ├── Aurora
     └── other services
```

## Amazon API Gateway

Amazon API Gateway costituisce l'API layer della piattaforma.

Le responsabilità principali includono:

* esposizione delle API HTTP;
* routing verso le Lambda;
* integrazione con authentication;
* gestione delle richieste;
* throttling quando necessario;
* logging e monitoring;
* gestione degli stage.

Le API devono essere organizzate secondo responsabilità funzionali chiare.

Esempi:

```text id="b4wby7"
API
├── Users
├── Properties
├── CRM
├── Media
└── Notifications
```

La struttura definitiva degli endpoint appartiene al livello applicativo e non viene definita in questo documento.

## API Authentication

Le API devono essere protette tramite un meccanismo di autenticazione coerente con l'architettura applicativa.

Amazon Cognito rappresenta il principale identity provider per gli utenti della piattaforma.

Concettualmente:

```text id="7m3hwp"
User
  │
  ▼
Cognito
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

L'autenticazione e l'autorizzazione applicativa devono essere mantenute distinte.

L'API layer verifica l'iden
