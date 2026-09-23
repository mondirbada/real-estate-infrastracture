# High-Level Architecture

## Overview

La piattaforma è progettata come un'architettura cloud-native basata principalmente su servizi AWS gestiti e componenti Serverless.

L'obiettivo è ottenere un'infrastruttura:

* scalabile;
* resiliente;
* sicura;
* osservabile;
* facilmente manutenibile;
* separata per responsabilità;
* adatta alla gestione di workload sincroni e asincroni.

## Architecture Diagram

![High-Level Architecture](./diagrams/high-level.jpeg)

## System Overview

Il sistema è composto da un frontend web, un API layer, servizi di compute Serverless, un database relazionale e una serie di servizi AWS dedicati a storage, search, messaging, workflow, security e observability.

Il flusso principale delle richieste è:

```text
User
  │
  ▼
CloudFront + WAF
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
```

I componenti asincroni e i servizi di supporto completano l'architettura:

```text
Lambda / Application
        │
        ▼
   EventBridge
        │
   ┌────┼──────────────┐
   ▼    ▼              ▼
  SQS  Step Functions  SES
   │
   ▼
Lambda Workers
   │
   ▼
OpenSearch
```

I file e i contenuti multimediali vengono gestiti tramite Amazon S3.

## Frontend

Il frontend è sviluppato con Next.js e
