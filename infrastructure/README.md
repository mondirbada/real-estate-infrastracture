# Infrastructure

## Overview

Questa sezione descrive come verrà organizzata e implementata l'infrastruttura AWS della piattaforma.

L'obiettivo è trasformare le decisioni architetturali definite nella sezione `architecture/` in una struttura Infrastructure as Code coerente, modulare e riproducibile.

L'infrastruttura verrà gestita tramite **Terraform** e distribuita attraverso pipeline CI/CD.

In questa fase la repository contiene esclusivamente la definizione architetturale e documentale dell'infrastruttura.

Il codice Terraform verrà introdotto in una fase successiva.

## Infrastructure Principles

L'infrastruttura seguirà i seguenti principi:

* **Infrastructure as Code** — tutte le risorse infrastrutturali devono essere dichiarate tramite codice;
* **Reproducibility** — gli ambienti devono poter essere ricreati in modo consistente;
* **Modularity** — le responsabilità infrastrutturali devono essere separate;
* **Least Privilege** — IAM permissions e accessi devono essere minimizzati;
* **Environment Isolation** — gli ambienti devono essere separati;
* **Immutable Infrastructure** — le modifiche devono essere applicate tramite Terraform anziché tramite modifiche manuali;
* **Managed Services First** — utilizzare servizi AWS gestiti quando appropriato;
* **Observability by Default** — logging, metrics e monitoring devono essere considerati parte dell'infrastruttura;
* **Security by Default** — le risorse devono essere configurate secondo i principi di sicurezza definiti nell'architettura.

## Infrastructure Layers

L'infrastruttura sarà organizzata concettualmente nei seguenti layer:

```text
Infrastructure
│
├── Networking
│
├── Security
│
├── Compute
│
├── Database
│
├── Storage
│
├── Messaging
│
├── Observability
│
└── Supporting Services
```

Ogni layer rappresenta una responsabilità infrastrutturale distinta.

## Networking

Il layer di networking gestisce le risorse necessarie alla connettività e all'isolamento di rete.

Comprende, a seconda della configurazione finale:

* AWS VPC;
* Availability Zones;
* Public Subnets;
* Private Subnets;
* Route Tables;
* Internet Gateway;
* NAT Gateway;
* VPC Endpoints;
* Security Groups;
* Network ACLs;
* VPC Flow Logs.

Il dettaglio architetturale è definito in:

* [Networking](../architecture/networking.md)

## Security

Il layer di security gestisce le risorse e le configurazioni necessarie per proteggere l'infrastruttura.

Può comprendere:

* IAM Roles;
* IAM Policies;
* Amazon Cognito;
* AWS WAF;
* AWS KMS;
* AWS Secrets Manager;
* security-related resource policies;
* audit configuration.

Il dettaglio architetturale è definito in:

* [Security Architecture](../architecture/security.md)

## Compute

Il layer di compute gestisce i componenti che eseguono la logica applicativa e i processi asincroni.

Comprende principalmente:

* Amazon API Gateway;
* AWS Lambda;
* Lambda execution roles;
* Lambda configuration;
* eventuali Lambda Layers;
* eventuali concurrency settings.

Le funzioni Lambda saranno organizzate per responsabilità funzionale.

Esempi:

```text
Compute
│
├── Users
├── Properties
├── CRM
├── Workers
├── Notifications
└── Supporting Functions
```

La struttura definitiva delle funzioni verrà definita durante la fase di implementazione.

## Database

Il layer database gestisce la persistenza dei dati transazionali.

Comprende:

* Amazon Aurora PostgreSQL;
* RDS Cluster;
* DB Instances;
* RDS Proxy;
* database Security Groups;
* parameter configuration;
* backup configuration;
* monitoring.

Aurora PostgreSQL rappresenta la source of truth per i dati transazionali.

Il dettaglio architetturale è definito in:

* [Data Architecture](../architecture/data.md)

## Storage

Il layer storage gestisce i dati non relazionali e i file.

Comprende principalmente:

* Amazon S3;
* S3 Buckets;
* Bucket Policies;
* encryption;
* versioning;
* lifecycle policies;
* access controls.

I bucket dovranno essere separati in base alla responsabilità e all'ambiente.

## Messaging

Il layer messaging gestisce la comunicazione asincrona e l'event-driven architecture.

Comprende:

* Amazon EventBridge;
* EventBridge Event Buses;
* EventBridge Rules;
* EventBridge Targets;
* Amazon SQS;
* SQS Queues;
* Dead-Letter Queues;
* AWS Step Functions.

Il dettaglio architetturale è definito in:

* [Event-Driven Architecture](../architecture/events.md)

## Search

Il layer search gestisce l'indicizzazione e la ricerca dei dati applicativi.

Comprende:

* Amazon OpenSearch;
* OpenSearch domain o deployment equivalente previsto dalla soluzione;
* network configuration;
* access policies;
* encryption;
* logging;
* monitoring.

OpenSearch deve essere considerato un sistema derivato rispetto alla source of truth rappresentata da Aurora PostgreSQL.

## Notifications

Il layer notifications gestisce i servizi utilizzati per le comunicazioni applicative.

Comprende principalmente:

* Amazon SES;
* eventuali configuration sets;
* identity verification;
* monitoring e logging.

La logica applicativa per l'invio delle notifiche rimane responsabilità del compute layer.

## Observability

Il layer observability gestisce logging, metrics, tracing e auditing.

Comprende:

* Amazon CloudWatch;
* CloudWatch Logs;
* CloudWatch Metrics;
* CloudWatch Alarms;
* dashboards;
* AWS X-Ray;
* AWS CloudTrail;
* VPC Flow Logs;
* eventuali log destinations.

L'observability deve essere integrata con gli altri layer anziché essere considerata un componente isolato.

## Frontend Delivery

La distribuzione del frontend comprende:

* Amazon CloudFront;
* eventuale S3 origin per gli asset statici;
* AWS WAF;
* cache policies;
* origin configuration;
* TLS configuration;
* DNS integration quando richiesta.

Il frontend applicativo è sviluppato con Next.js, mentre questa repository definisce esclusivamente l'infrastruttura necessaria al suo deployment e alla sua distribuzione.

## Terraform Structure

La struttura Terraform verrà definita in una fase successiva.

Il progetto dovrà comunque mantenere una separazione chiara tra:

* environment configuration;
* reusable modules;
* shared infrastructure;
* resource definitions;
* variables;
* outputs;
* providers;
* backend/state configuration.

Una possibile organizzazione futura è:

```text
terraform/
│
├── modules/
│   ├── networking/
│   ├── security/
│   ├── compute/
│   ├── database/
│   ├── storage/
│   ├── messaging/
│   ├── search/
│   └── observability/
│
└── environments/
    ├── dev/
    ├── staging/
    └── prod/
```

Questa struttura è indicativa e potrà essere modificata quando verranno definiti i requisiti effettivi dei moduli.

## Terraform State

Lo Terraform state dovrà essere gestito tramite un backend remoto e non dovrà essere salvato nel repository.

La strategia definitiva dovrà definire:

* backend;
* state storage;
* state locking;
* encryption;
* access control;
* versioning;
* backup;
* separazione dello state tra ambienti.

## Environment Strategy

L'infrastruttura dovrà supportare almeno:

* development;
* staging;
* production.

Ogni ambiente dovrà avere risorse e configurazioni isolate.

La strategia definitiva potrà utilizzare:

* workspace Terraform;
* directory separate;
* account AWS separati;
* oppure una combinazione di questi approcci.

La scelta verrà documentata nella sezione `environments/`.

## Dependency Management

Le dipendenze tra i layer devono essere esplicite.

Un esempio concettuale:

```text
Networking
    │
    ├──────────────┐
    ▼              ▼
Security        Database
    │              │
    │              ▼
    └──────────► Compute
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
       Storage   Messaging   Search
                    │
                    ▼
               Observability
```

La struttura effettiva delle dipendenze verrà definita nei moduli Terraform.

## Deployment Strategy

Le modifiche infrastrutturali dovranno essere applicate tramite pipeline CI/CD.

Il flusso previsto è:

```text
Developer
    │
    ▼
GitHub
    │
    ▼
GitHub Actions
    │
    ├── Terraform Format
    ├── Terraform Validate
    ├── Terraform Plan
    │
    ▼
Approval / Protected Environment
    │
    ▼
Terraform Apply
    │
    ▼
AWS
```

Le pipeline dovranno utilizzare autenticazione sicura verso AWS tramite OIDC e IAM roles.

## Infrastructure Changes

Le modifiche all'infrastruttura dovranno essere:

1. definite nel repository;
2. sottoposte a code review;
3. validate automaticamente;
4. analizzate tramite Terraform Plan;
5. applicate tramite pipeline autorizzata.

Le modifiche manuali direttamente nella console AWS devono essere evitate salvo operazioni eccezionali e documentate.

## Resource Naming

Dovrà essere definita una naming convention coerente per le risorse AWS.

Il naming dovrà tenere conto almeno di:

* project;
* environment;
* service;
* resource type;
* eventuale region o component identifier.

Esempio concettuale:

```text
<project>-<environment>-<service>-<resource>
```

La naming convention definitiva verrà documentata durante la progettazione Terraform.

## Tagging Strategy

Le risorse AWS dovranno utilizzare tag coerenti.

I tag potranno includere:

* Project;
* Environment;
* ManagedBy;
* Service;
* Owner;
* CostCenter.

La lista definitiva dei tag obbligatori verrà definita prima dell'implementazione Terraform.

## Infrastructure Security

La sicurezza dell'infrastruttura segue i principi definiti in:

* [Security Architecture](../architecture/security.md)

In particolare:

* Least Privilege;
* private resources;
* encryption;
* secrets management;
* IAM roles;
* audit;
* environment isolation;
* secure CI/CD.

## Documentation

I dettagli dei singoli layer saranno documentati nei seguenti file:

* [Compute](./compute.md)
* [Database](./database.md)
* [Storage](./storage.md)
* [Messaging](./messaging.md)
* [Networking](./networking.md)
* [Security](./security.md)
* [Observability](./observability.md)

## Implementation Status

Attualmente questa sezione contiene esclusivamente la definizione architetturale dell'infrastruttura.

Terraform non è ancora stato introdotto.

L'implementazione verrà realizzata progressivamente dopo aver completato la documentazione dei singoli layer infrastrutturali.
