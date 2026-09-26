# Observability Infrastructure

## Overview

La observability infrastructure permette di monitorare lo stato dell'applicazione e dell'infrastruttura AWS.

Il modello si basa principalmente su:

* **Amazon CloudWatch** per logs, metrics, dashboards e alarms;
* **AWS X-Ray** per distributed tracing;
* **AWS CloudTrail** per AWS API audit;
* **VPC Flow Logs** per network visibility;
* logging strutturato dalle Lambda;
* monitoring degli asynchronous workloads;
* alerting operativo e security-oriented.

L'obiettivo è poter rispondere rapidamente a domande come:

* cosa sta fallendo?
* dove sta fallendo?
* quando è iniziato il problema?
* quali componenti sono coinvolti?
* quanto traffico sta ricevendo il sistema?
* ci sono queue backlog?
* ci sono errori database?
* ci sono anomalie di rete?
* un deployment ha introdotto un problema?

---

# Observability Model

La piattaforma distingue quattro categorie principali:

```text id="r5m8qa"
Logs
  │
  └── What happened?

Metrics
  │
  └── How much / how often?

Traces
  │
  └── Where did the request travel?

Audit
  │
  └── Who changed AWS infrastructure?
```

Questi segnali devono essere correlabili tramite identificativi comuni quando possibile.

---

# Amazon CloudWatch

Amazon CloudWatch costituisce il principale layer di monitoring operativo.

Verrà utilizzato per:

* Lambda Logs;
* application metrics;
* AWS service metrics;
* alarms;
* dashboards;
* monitoring delle queue;
* monitoring dei workflow;
* operational visibility.

Schema:

```text id="x7n3kc"
Application
     │
     ├── Logs
     ├── Metrics
     └── Traces
           │
           ▼
      CloudWatch
           │
     ┌─────┴─────┐
     │           │
 Dashboards    Alarms
```

---

# CloudWatch Logs

Le Lambda scriveranno i log in Amazon CloudWatch Logs.

Ogni Lambda dovrà avere un proprio **CloudWatch Log Group**.

Esempio concettuale:

```text id="m2q8vf"
Lambda Users
    │
    └── CloudWatch Log Group

Lambda Properties
    │
    └── CloudWatch Log Group

Lambda CRM
    │
    └── CloudWatch Log Group

Search Worker
    │
    └── CloudWatch Log Group
```

La retention dovrà essere configurata esplicitamente.

Non è previsto lasciare indefinitamente i log senza una retention policy.

---

# Structured Logging

Le Lambda dovranno utilizzare **structured logging**.

Un log dovrebbe contenere informazioni strutturate come:

```json id="g6p4ws"
{
  "level": "INFO",
  "timestamp": "2026-09-26T10:00:00Z",
  "service": "property-service",
  "requestId": "uuid",
  "eventType": "PropertyCreated",
  "propertyId": "uuid",
  "message": "Property created"
}
```

La struttura definitiva del log schema verrà definita durante l'implementazione applicativa.

L'obiettivo è evitare log esclusivamente testuali difficili da interrogare.

---

# Correlation IDs

Le richieste devono poter essere correlate tra i diversi componenti.

Un possibile modello:

```text id="c4m7zx"
Client Request
      │
      ▼
API Gateway
      │
      │ requestId / correlationId
      ▼
Lambda
      │
      ├── Aurora
      ├── EventBridge
      └── SQS
              │
              ▼
          Lambda Worker
              │
              ▼
          OpenSearch
```

Il `correlationId` deve essere propagato quando appropriato.

Gli eventi asincroni devono mantenere almeno un riferimento al contesto che ha generato l'operazione.

---

# Error Logging

Gli errori devono contenere informazioni sufficienti per il troubleshooting senza esporre dati sensibili.

Esempio concettuale:

```json id="w8k2fn"
{
  "level": "ERROR",
  "service": "search-worker",
  "requestId": "uuid",
  "eventId": "uuid",
  "errorType": "IndexingError",
  "message": "Failed to index property"
}
```

Non devono essere inseriti nei log:

* password;
* access tokens;
* refresh tokens;
* database credentials;
* secret values;
* authorization headers completi;
* dati personali non necessari.

---

# Log Retention

La retention deve essere differenziata per environment.

Un possibile modello:

```text id="z3q7mc"
Development
    │
    └── Short retention

Staging
    │
    └── Medium retention

Production
    │
    └── Longer retention
```

I valori definitivi dovranno essere determinati in base a:

* troubleshooting requirements;
* security requirements;
* compliance;
* costi.

---

# Application Metrics

Oltre ai log, l'applicazione dovrà produrre metriche significative.

Possibili metriche:

* request count;
* request latency;
* error count;
* successful operations;
* failed operations;
* business operations;
* queue processing time;
* indexing failures;
* workflow failures.

Le metriche applicative dovranno essere definite evitando un numero eccessivo di dimensions ad alta cardinalità.

---

# AWS Service Metrics

Gli AWS services producono metriche CloudWatch native.

Esempi:

### Lambda

* Invocations;
* Errors;
* Duration;
* Throttles;
* ConcurrentExecutions.

### API Gateway

* Count;
* 4XXError;
* 5XXError;
* Latency;
* IntegrationLatency.

### SQS

* ApproximateNumberOfMessagesVisible;
* ApproximateAgeOfOldestMessage;
* NumberOfMessagesSent;
* NumberOfMessagesReceived;
* NumberOfMessagesDeleted.

### Aurora

* CPUUtilization;
* DatabaseConnections;
* FreeableMemory;
* ReadLatency;
* WriteLatency;
* storage-related metrics.

### RDS Proxy

* ClientConnections;
* DatabaseConnections;
* connection utilization;
* target health.

### OpenSearch

* cluster health;
* CPU utilization;
* storage;
* JVM memory;
* indexing/search performance.

Le metriche effettivamente utilizzate saranno definite insieme ai relativi alarms.

---

# CloudWatch Alarms

Gli alarms permettono di trasformare le metriche in segnali operativi.

Possibili categorie:

```text id="q6m2kp"
Infrastructure
     │
     ├── High CPU
     ├── High memory
     └── Capacity issues

Application
     │
     ├── High error rate
     ├── High latency
     └── Lambda throttling

Messaging
     │
     ├── Queue backlog
     ├── Old messages
     └── DLQ messages

Database
     │
     ├── Connection pressure
     ├── High latency
     └── Resource saturation
```

Gli alarms devono essere basati su soglie significative e non su ogni singolo errore.

---

# Critical Alarms

Alcuni alarms devono essere considerati particolarmente importanti in production.

Esempi:

```text id="f9v3wa"
Critical

├── Lambda error rate
├── API Gateway 5XX
├── SQS DLQ messages
├── Queue age
├── Aurora availability
├── Database connection pressure
├── OpenSearch cluster health
└── Step Functions failures
```

La severità effettiva sarà definita nel monitoring model.

---

# SQS Monitoring

Le queue devono essere monitorate soprattutto per identificare backlog e consumer failures.

Il modello è:

```text id="j4x7rc"
Producer
   │
   ▼
SQS
   │
   ├── Queue Depth
   ├── Message Age
   └── DLQ Count
          │
          ▼
       Alarm
```

Particolare attenzione deve essere prestata a:

* `ApproximateAgeOfOldestMessage`;
* messaggi nella DLQ;
* crescita persistente della queue;
* consumer throttling.

Un aumento temporaneo della queue non implica necessariamente un problema.

La soglia deve essere valutata in funzione del workload.

---

# Step Functions Monitoring

I workflow Step Functions devono essere monitorati per:

* executions started;
* executions succeeded;
* executions failed;
* executions timed out;
* execution duration.

Esempio:

```text id="v2k8ns"
Event
 │
 ▼
Step Functions
 │
 ├── Success
 ├── Failed
 └── Timed Out
       │
       ▼
   CloudWatch Alarm
```

Gli errori devono poter essere correlati all'eventuale evento che ha avviato il workflow.

---

# AWS X-Ray

**AWS X-Ray** viene utilizzato per distributed tracing.

È particolarmente utile per richieste che attraversano più componenti.

Esempio:

```text id="b5r9mx"
Client
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
Aurora
```

X-Ray può aiutare a identificare quale componente contribuisce maggiormente alla latenza.

---

# Tracing Asynchronous Flows

I workflow asincroni sono più difficili da seguire rispetto alle richieste sincrone.

Esempio:

```text id="n7c4pd"
API Request
    │
    ▼
Lambda
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

Per questo motivo è importante combinare:

* X-Ray;
* `requestId`;
* `correlationId`;
* `eventId`;
* structured logs.

Non tutti i confini asincroni avranno necessariamente una singola trace continua; la correlazione applicativa deve quindi essere mantenuta anche tramite identifiers.

---

# Sampling

X-Ray utilizza un meccanismo di sampling per evitare che ogni richiesta debba necessariamente essere tracciata in modo completo.

La configurazione dovrà essere differenziata per environment.

Possibile approccio:

```text id="c6w2hk"
Development
    │
    └── Higher sampling

Staging
    │
    └── Medium sampling

Production
    │
    └── Controlled sampling
```

Per production può essere utile aumentare temporaneamente il sampling durante incident investigation.

---

# AWS CloudTrail

AWS CloudTrail fornisce audit delle API AWS.

Il suo ruolo è diverso da CloudWatch Logs.

```text id="p9f3vx"
CloudTrail
    │
    └── AWS API Activity

CloudWatch Logs
    │
    └── Application / Runtime Logs
```

CloudTrail deve essere utilizzato per investigare operazioni come:

* modifica di IAM policies;
* modifica di Security Groups;
* creazione o modifica di risorse;
* modifiche KMS;
* modifiche S3;
* modifiche infrastrutturali.

---

# CloudTrail Security Monitoring

Gli eventi CloudTrail possono essere utilizzati per identificare attività sospette o inattese.

Possibili segnali:

* modifiche a IAM;
* disabilitazione di logging;
* modifiche a Security Groups;
* modifiche a KMS policies;
* accessi amministrativi inattesi;
* modifiche alle bucket policies.

La strategia di alerting dovrà essere definita insieme alla security infrastructure.

---

# VPC Flow Logs

I **VPC Flow Logs** permettono di osservare metadata relativi al traffico di rete.

Sono utili per:

* troubleshooting;
* analisi di connectivity issues;
* security investigation;
* identificazione di rejected traffic.

Esempio:

```text id="s8m5qc"
Lambda
  │
  ▼
RDS Proxy
  │
  ▼
Aurora

       │
       └── VPC Flow Logs
                │
                ▼
          Monitoring / Analysis
```

Flow Logs non forniscono il contenuto delle comunicazioni.

---

# Observability for Database

Aurora PostgreSQL deve avere monitoring dedicato.

Le principali aree sono:

* CPU;
* memory;
* connections;
* storage;
* latency;
* read/write workload;
* replication;
* database health.

RDS Proxy deve essere monitorato separatamente.

Questo permette di distinguere:

```text id="k4q9ms"
Application
    │
    ▼
RDS Proxy
    │
    ▼
Aurora
```

da un problema esclusivamente applicativo o esclusivamente database.

---

# Observability for OpenSearch

OpenSearch richiede monitoring specifico perché costituisce una componente derivata ma potenzialmente critica per le funzionalità di search.

Devono essere monitorati:

* cluster health;
* CPU;
* memory;
* storage;
* indexing errors;
* search latency;
* rejected requests;
* shard health;
* indexing backlog.

Un problema di OpenSearch non deve compromettere necessariamente le operazioni transazionali su Aurora.

---

# Observability for S3

Per Amazon S3 il monitoring deve concentrarsi principalmente su:

* errori di accesso;
* richieste;
* lifecycle behavior;
* anomalie nei workflow di processing;
* eventi S3 non processati correttamente.

Il monitoring dell'object storage deve essere coordinato con il monitoring delle queue che ricevono gli eventi S3.

---

# Observability for API Gateway

API Gateway deve essere monitorato per:

* request count;
* 4XX;
* 5XX;
* latency;
* integration latency;
* throttling.

Il confronto tra 4XX e 5XX è particolarmente utile:

```text id="m6x2pq"
4XX
 │
 └── Client / Authentication / Validation issues

5XX
 │
 └── Server / Integration / Infrastructure issues
```

Le due categorie non devono essere trattate allo stesso modo.

---

# Observability for Lambda

Per ogni Lambda devono essere osservati almeno:

* invocations;
* errors;
* duration;
* throttles;
* concurrent executions.

Per Lambda che consumano SQS devono essere aggiunti:

* batch processing;
* partial failures;
* queue age;
* DLQ behavior.

---

# Dashboards

CloudWatch Dashboards potranno fornire una vista aggregata dell'ambiente.

Un possibile dashboard production:

```text id="t8q4vk"
Production Overview
│
├── API
│   ├── Requests
│   ├── 4XX
│   ├── 5XX
│   └── Latency
│
├── Lambda
│   ├── Errors
│   ├── Duration
│   └── Throttles
│
├── Database
│   ├── Connections
│   ├── CPU
│   └── Latency
│
├── Messaging
│   ├── Queue Depth
│   ├── Queue Age
│   └── DLQ
│
└── Search
    ├── Cluster Health
    ├── CPU
    └── Storage
```

I dashboard devono essere organizzati per environment.

---

# Alert Severity

Gli alerts possono essere classificati per severità.

Un possibile modello:

```text id="z5p9hr"
Critical
    │
    └── User-facing or data-impacting issue

Warning
    │
    └── Degradation or capacity pressure

Info
    │
    └── Operational event
```

Le categorie definitive dipenderanno dal processo operativo del progetto.

---

# Alert Fatigue

Un sistema di monitoring troppo rumoroso può diventare controproducente.

Per questo motivo:

* non ogni log error deve generare un alert;
* le soglie devono essere basate su comportamento significativo;
* gli alert duplicati devono essere ridotti;
* i transient failures devono essere gestiti tramite retry;
* gli alert devono avere un'azione associata.

Ogni alarm production dovrebbe idealmente rispondere alla domanda:

```text
"What action should an operator take?"
```

---

# Incident Investigation

Durante un incidente, la sequenza di analisi può essere:

```text id="h3v7mx"
1. CloudWatch Alarms
        │
        ▼
2. Application Logs
        │
        ▼
3. Metrics
        │
        ▼
4. X-Ray Traces
        │
        ▼
5. CloudTrail
        │
        ▼
6. VPC Flow Logs
```

La sequenza non è obbligatoria, ma fornisce un modello operativo iniziale.

---

# Retention Strategy

La retention dei dati di observability deve essere definita per categoria.

| Data             | Example Retention Consideration |
| ---------------- | ------------------------------- |
| Application Logs | Operational troubleshooting     |
| Metrics          | Trend analysis                  |
| X-Ray Traces     | Debugging                       |
| CloudTrail       | Audit                           |
| VPC Flow Logs    | Network/security analysis       |

La retention definitiva dipenderà da:

* operational requirements;
* security;
* compliance;
* cost.

---

# Cost Management

La observability può generare costi significativi.

Gli elementi principali da controllare sono:

* CloudWatch Logs ingestion;
* CloudWatch Logs storage;
* custom metrics;
* high-cardinality metrics;
* X-Ray traces;
* CloudTrail data events;
* VPC Flow Logs;
* log exports;
* dashboards e monitoring components.

Devono essere evitate metriche custom inutilmente numerose e logging eccessivamente verboso in production.

---

# Terraform Structure

La futura implementazione Terraform potrà utilizzare:

```text id="f8k3nd"
terraform/
└── modules/
    └── observability/
        ├── cloudwatch.tf
        ├── alarms.tf
        ├── dashboards.tf
        ├── xray.tf
        ├── cloudtrail.tf
        ├── flow-logs.tf
        ├── variables.tf
        ├── outputs.tf
        └── versions.tf
```

La struttura definitiva potrà essere modificata quando saranno note le dipendenze effettive dei singoli AWS services.

---

# Infrastructure Dependencies

La observability layer attraversa tutti gli altri componenti:

```text id="w2m7qc"
Networking ───────► VPC Flow Logs
       │
Compute ──────────► CloudWatch + X-Ray
       │
Database ─────────► CloudWatch
       │
Storage ──────────► CloudWatch / CloudTrail
       │
Messaging ────────► CloudWatch
       │
Security ─────────► CloudTrail + CloudWatch
```

La observability deve quindi essere considerata parte integrante dell'infrastruttura e non un componente aggiunto successivamente.

---

# Open Decisions

Prima dell'implementazione Terraform dovranno essere definiti:

* log schema;
* CloudWatch Log Groups;
* log retention per environment;
* application metrics;
* custom metrics strategy;
* CloudWatch alarms;
* alarm thresholds;
* dashboard structure;
* X-Ray sampling;
* tracing strategy;
* correlation ID standard;
* CloudTrail configuration;
* CloudTrail retention;
* VPC Flow Logs destination;
* VPC Flow Logs retention;
* security alerts;
* notification mechanism per gli alarms;
* incident escalation;
* observability cost controls;
* eventuale centralized logging account;
* eventuale cross-account observability.

---

# Related Documentation

* [Architecture Overview](../architecture/README.md)
* [Security Architecture](../architecture/security.md)
* [Networking Architecture](../architecture/networking.md)
* [Infrastructure Overview](./README.md)
* [Compute Infrastructure](./compute.md)
* [Database Infrastructure](./database.md)
* [Storage Infrastructure](./storage.md)
* [Messaging Infrastructure](./messaging.md)
* [Security Infrastructure](./security.md)
