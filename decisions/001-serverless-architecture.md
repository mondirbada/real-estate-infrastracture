# ADR 001 — Serverless Architecture

## Status

Accepted

## Context

Il progetto richiede un'infrastruttura cloud per una piattaforma real-estate caratterizzata da:

* API HTTP;
* operazioni CRUD su proprietà e utenti;
* gestione di dati CRM;
* upload e gestione di file multimediali;
* ricerca full-text;
* elaborazione asincrona;
* notifiche;
* workflow applicativi;
* integrazione con diversi AWS services;
* possibilità di scalare in funzione del carico.

L'architettura deve inoltre ridurre il più possibile la gestione operativa di server e componenti infrastructure-heavy.

I principali requisiti architetturali sono:

* scalability;
* high availability;
* security;
* operational simplicity;
* pay-per-use quando appropriato;
* integrazione nativa con AWS;
* possibilità di gestire workload sia sincroni sia asincroni;
* separazione tra transactional workloads e asynchronous workloads.

---

# Decision

Adottiamo una **Serverless Architecture** basata principalmente su managed AWS services.

I principali componenti sono:

```text id="svr6nc"
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
```

A supporto del backend:

```text id="c8b54k"
Lambda
 │
 ├── S3
 ├── EventBridge
 ├── SQS
 ├── Step Functions
 ├── OpenSearch
 └── SES
```

La piattaforma utilizzerà quindi principalmente servizi AWS managed e serverless invece di gestire direttamente virtual machines o container orchestration per i workload applicativi principali.

---

# Selected Services

La Serverless Architecture utilizza i seguenti componenti:

| Area           | AWS Service                | Responsabilità                 |
| -------------- | -------------------------- | ------------------------------ |
| CDN            | Amazon CloudFront          | Frontend delivery              |
| Authentication | Amazon Cognito             | User authentication            |
| API            | Amazon API Gateway         | HTTP API layer                 |
| Compute        | AWS Lambda                 | Application workloads          |
| Database       | Amazon Aurora PostgreSQL   | Transactional data             |
| Connections    | Amazon RDS Proxy           | Database connection management |
| Storage        | Amazon S3                  | Files and media                |
| Events         | Amazon EventBridge         | Event routing                  |
| Queue          | Amazon SQS                 | Async processing               |
| Workflow       | AWS Step Functions         | Workflow orchestration         |
| Search         | Amazon OpenSearch Service  | Search and indexing            |
| Email          | Amazon SES                 | Email delivery                 |
| Secrets        | AWS Secrets Manager        | Secret management              |
| Encryption     | AWS Key Management Service | Encryption key management      |
| Monitoring     | Amazon CloudWatch          | Logs and metrics               |
| Tracing        | AWS X-Ray                  | Distributed tracing            |
| Protection     | AWS WAF                    | Web application protection     |

---

# Why Serverless

La scelta Serverless riduce la quantità di infrastructure management necessaria per il workload applicativo.

Con AWS Lambda, API Gateway, EventBridge, SQS e Step Functions, la gestione di:

* server;
* operating systems;
* capacity provisioning;
* patching applicativo dell'infrastruttura;
* scaling manuale;

viene ridotta rispetto a un'architettura basata principalmente su virtual machines o cluster gestiti direttamente.

Questo consente al progetto di concentrarsi maggiormente sulla logica applicativa e sui contratti tra i servizi.

---

# Scalability

I workload applicativi principali devono poter scalare in funzione della domanda.

AWS Lambda viene utilizzato per workload stateless e adatti al modello event-driven.

Amazon API Gateway gestisce il layer API davanti alle Lambda functions.

Amazon SQS permette di disaccoppiare i workload asincroni e assorbire variazioni del carico.

Amazon EventBridge permette di distribuire gli eventi senza creare dipendenze dirette tra tutti i producer e consumer.

Amazon Aurora PostgreSQL rappresenta invece il transactional data store e deve essere dimensionato in base ai requisiti di database.

La Serverless Architecture non significa che tutti i componenti siano automaticamente serverless o infinitamente scalabili.

Database, OpenSearch e altri managed services devono essere dimensionati e monitorati secondo i rispettivi workload.

---

# Event-Driven Architecture

La Serverless Architecture viene combinata con un modello **Event-Driven**.

Gli application services possono generare domain events come:

```text id="4kgp3p"
PropertyCreated
PropertyUpdated
PropertyPublished
PropertyDeleted
MediaUploaded
UserCreated
```

Gli eventi vengono pubblicati su Amazon EventBridge e successivamente indirizzati verso i consumer appropriati.

Esempio:

```text id="2v4tpf"
Property Service
      │
      ▼
EventBridge
      │
      ├──────────► SQS
      │              │
      │              ▼
      │        Lambda Worker
      │              │
      │              ▼
      │          OpenSearch
      │
      └──────────► Step Functions
                     │
                     ▼
                  Workflow
```

Questo modello riduce il coupling tra i componenti e permette di elaborare alcune operazioni in modo asincrono.

---

# Transactional Data

La Serverless Architecture non elimina la necessità di un database relazionale.

Amazon Aurora PostgreSQL viene utilizzato come **system of record** per i dati transazionali.

Il flusso principale è:

```text id="s7g5km"
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

Amazon RDS Proxy viene utilizzato per gestire le connessioni tra Lambda e Aurora e ridurre i problemi derivanti dalla natura concorrente e dinamica dei Lambda workloads.

Amazon OpenSearch Service non viene considerato il system of record.

È utilizzato come search/indexing layer derivato dai dati transazionali.

---

# Storage

Amazon S3 viene utilizzato per i contenuti binary e media:

* property images;
* documents;
* attachments;
* generated files.

Il database mantiene i metadata necessari per collegare il contenuto al dominio applicativo.

Per gli upload browser-based possono essere utilizzati presigned URLs.

Esempio:

```text id="g3tq4w"
Client
   │
   │ request upload
   ▼
API / Lambda
   │
   │ presigned URL
   ▼
Client
   │
   │ upload
   ▼
S3
```

Questo evita di utilizzare Lambda come proxy per il trasferimento dei file.

---

# Asynchronous Processing

Le operazioni che non devono necessariamente essere completate durante la request HTTP possono essere elaborate asincronamente.

Esempi:

* search indexing;
* media processing;
* notification delivery;
* background jobs;
* eventuali integrazioni future.

Il pattern principale è:

```text id="8o6z4k"
Producer
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

Amazon SQS fornisce buffering, retry e Dead-Letter Queue quando necessari.

---

# Workflow Orchestration

Per workflow composti da più step viene utilizzato AWS Step Functions.

Esempi:

* notification workflows;
* multi-step business processes;
* retryable workflows;
* orchestration di Lambda functions;
* processi che richiedono stato esplicito.

La scelta di Step Functions evita di implementare manualmente workflow stateful all'interno delle singole Lambda functions.

---

# Security Model

La Serverless Architecture viene accompagnata da un modello di security basato su:

* Least Privilege;
* IAM Roles;
* Amazon Cognito;
* AWS WAF;
* private networking quando necessario;
* Security Groups;
* Secrets Manager;
* AWS KMS;
* encryption in transit;
* encryption at rest;
* CloudTrail;
* CloudWatch;
* environment isolation.

Ogni Lambda function deve utilizzare un execution role dedicato o comunque sufficientemente ristretto alla propria responsabilità.

L'adozione di servizi serverless non viene considerata una sostituzione dei controlli di sicurezza.

---

# Networking

Non tutte le Lambda functions devono necessariamente essere inserite in una VPC.

Le Lambda functions devono utilizzare il VPC networking quando è necessario accedere a risorse private che lo richiedono.

Le principali risorse private previste sono:

```text id="4j8p4c"
Private Subnets
│
├── Lambda functions where required
├── RDS Proxy
├── Aurora PostgreSQL
└── OpenSearch
```

Amazon S3, Amazon EventBridge, Amazon SQS e altri managed services rimangono servizi AWS gestiti e non vengono considerati risorse collocate direttamente all'interno della VPC.

---

# Observability

La Serverless Architecture richiede un modello di observability coerente.

I principali strumenti sono:

* Amazon CloudWatch Logs;
* Amazon CloudWatch Metrics;
* Amazon CloudWatch Alarms;
* AWS X-Ray;
* AWS CloudTrail;
* VPC Flow Logs;
* AWS WAF logs.

I log applicativi devono essere strutturati e includere correlation identifiers quando necessario per seguire una request attraverso più servizi.

L'observability deve essere progettata insieme all'infrastruttura e non aggiunta successivamente.

---

# Deployment

L'infrastruttura verrà gestita tramite **Terraform**.

Il deployment applicativo e infrastrutturale verrà automatizzato tramite **GitHub Actions**.

Il modello previsto è:

```text id="x8v4cj"
GitHub
   │
   ▼
GitHub Actions
   │
   ├── Terraform fmt
   ├── Terraform validate
   ├── Terraform plan
   └── Terraform apply
```

GitHub Actions utilizzerà OIDC per autenticarsi verso AWS tramite IAM Roles, evitando ove possibile l'utilizzo di long-lived AWS access keys.

---

# Alternatives Considered

## Virtual Machines

Un'architettura basata principalmente su Amazon EC2 richiederebbe la gestione diretta di una maggiore quantità di infrastructure.

Aspetti da gestire:

* operating systems;
* patching;
* capacity planning;
* scaling;
* deployment;
* instance lifecycle;
* high availability.

È stata quindi preferita un'architettura maggiormente managed.

---

## Container Orchestration

Un'architettura basata principalmente su container e orchestration potrebbe essere implementata tramite servizi come Amazon ECS o Amazon EKS.

Questa soluzione può essere appropriata per workload:

* long-running;
* container-native;
* con esigenze particolari di runtime;
* con requisiti di networking o execution non adatti a Lambda.

Per il workload applicativo iniziale del progetto non è però necessario introdurre un orchestration layer come componente principale.

Eventuali workload futuri che non risultassero adatti a Lambda potranno essere valutati separatamente.

---

## Hybrid Architecture

Un'architettura ibrida rimane possibile.

Ad esempio:

```text id="v4i0jw"
Serverless
   │
   ├── API Gateway
   ├── Lambda
   ├── EventBridge
   ├── SQS
   └── Step Functions
          │
          ▼
     Container workload
```

Questa opzione potrà essere introdotta in futuro se emergeranno workload che richiedono execution environments differenti.

L'adozione iniziale di Serverless non impedisce quindi l'evoluzione verso un modello ibrido.

---

# Consequences

## Positive

* riduzione dell'infrastructure management;
* scaling automatico per i workload adatti;
* integrazione nativa con AWS;
* forte supporto per Event-Driven architecture;
* riduzione del numero di server da gestire direttamente;
* possibilità di adottare un modello pay-per-use per diversi componenti;
* buona integrazione con CI/CD;
* separazione naturale tra componenti applicativi.

## Negative

* maggiore dipendenza dai servizi AWS;
* necessità di comprendere i limiti dei singoli managed services;
* possibile complessità nei sistemi distribuiti;
* necessità di gestire correttamente retry e idempotency;
* eventuali cold start delle Lambda functions;
* debugging distribuito più complesso;
* gestione attenta delle connessioni verso Aurora;
* cost model meno prevedibile per alcuni workload ad alto volume.

## Operational

L'architettura richiede particolare attenzione a:

* Lambda concurrency;
* API throttling;
* SQS visibility timeout;
* Dead-Letter Queues;
* EventBridge retry;
* idempotency;
* database connections;
* observability;
* cost monitoring.

---

# Constraints

La scelta Serverless introduce alcuni vincoli architetturali.

Le applicazioni devono essere progettate considerando:

* execution time limits;
* memory limits;
* concurrency;
* stateless execution;
* eventuali cold starts;
* asynchronous processing;
* eventualual consistency;
* service quotas;
* retry behavior.

Le operazioni che richiedono execution lunga o caratteristiche incompatibili con Lambda dovranno essere valutate separatamente.

---

# Future Evolution

L'architettura potrà evolvere senza invalidare necessariamente questa decisione.

Possibili evoluzioni:

* containerized workloads;
* additional AWS managed services;
* multi-region architecture;
* advanced event processing;
* asynchronous workflows più complessi;
* caching layer;
* read replicas;
* search optimization;
* data processing pipelines.

Eventuali modifiche significative al modello di compute dovranno essere documentate tramite un nuovo ADR.

---

# Related Documentation

* [Architecture Overview](../architecture/high-level.md)
* [AWS Services](../architecture/aws-services.md)
* [Networking](../architecture/networking.md)
* [Security](../architecture/security.md)
* [Events](../architecture/events.md)
* [Data](../architecture/data.md)
* [Compute Infrastructure](../infrastructure/compute.md)
* [Database Infrastructure](../infrastructure/database.md)
* [Messaging Infrastructure](../infrastructure/messaging.md)
* [Environment Strategy](../environments/README.md)

---

# Implementation Status

La decisione architetturale è **Accepted**.

L'architettura è attualmente documentata ma non ancora implementata tramite Terraform.

La successiva implementazione dovrà mantenere i principi descritti in questo ADR, salvo nuove decisioni architetturali documentate.
