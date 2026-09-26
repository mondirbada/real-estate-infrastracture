# Environments

## Overview

La gestione degli ambienti definisce come separare, configurare e distribuire l'infrastruttura AWS nei diversi stage del progetto.

L'obiettivo è garantire:

* isolamento tra ambienti;
* sicurezza dei dati;
* configurazioni riproducibili;
* deployment controllati;
* separazione dei Terraform state;
* possibilità di promuovere le modifiche da un ambiente all'altro;
* controllo dei costi;
* osservabilità coerente;
* riduzione del rischio di modifiche accidentali in production.

Gli ambienti principali previsti sono:

* **dev** — sviluppo e test continui;
* **staging** — validazione pre-production;
* **prod** — ambiente production.

La configurazione dell'infrastruttura sarà gestita tramite **Terraform** e il deployment sarà automatizzato tramite **GitHub Actions**.

---

## Environment Model

```text
                         Git Repository
                               │
                               ▼
                        GitHub Actions
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
              dev          staging           prod
                │              │              │
                ▼              ▼              ▼
           AWS Resources   AWS Resources   AWS Resources
                │              │              │
                ▼              ▼              ▼
          Terraform State Terraform State Terraform State
```

Ogni ambiente deve avere una configurazione Terraform e uno state logicamente separati.

Le risorse AWS devono essere identificabili in modo chiaro tramite naming e tagging.

---

# Environment: dev

L'ambiente `dev` è destinato allo sviluppo quotidiano.

Caratteristiche principali:

* deployment frequenti;
* test funzionali;
* test di integrazione;
* debugging;
* sperimentazione controllata;
* cost optimization rispetto a production;
* dati non production.

L'ambiente `dev` può utilizzare configurazioni meno dimensionate rispetto a production, purché siano sufficienti per validare il comportamento dell'architettura.

Esempi:

* minore capacità database;
* configurazioni Lambda ottimizzate per cost;
* retention dei log più breve;
* OpenSearch dimensionato per il carico di sviluppo;
* configurazioni di monitoring meno aggressive.

L'ambiente `dev` non deve essere considerato una replica perfetta di production.

Deve invece mantenere compatibilità architetturale con production per consentire una validazione significativa delle modifiche.

---

# Environment: staging

L'ambiente `staging` rappresenta il principale ambiente di validazione prima di production.

Obiettivi:

* integration testing;
* end-to-end testing;
* validation delle configurazioni;
* testing delle nuove versioni;
* verifica delle integrazioni AWS;
* test delle pipeline CI/CD;
* validazione dei Terraform changes;
* test delle procedure operative.

Quando possibile, staging dovrebbe utilizzare configurazioni tecniche il più possibile compatibili con production.

Non è necessario che abbia necessariamente la stessa capacità o lo stesso costo, ma deve mantenere gli stessi principali pattern architetturali.

Esempi:

```text
API Gateway
Lambda
Aurora PostgreSQL
RDS Proxy
S3
EventBridge
SQS
Step Functions
OpenSearch
CloudWatch
AWS WAF
```

Le differenze rispetto a production devono essere deliberate e documentate.

---

# Environment: prod

L'ambiente `prod` contiene il sistema utilizzato dagli utenti reali e i dati production.

Production deve avere il livello più elevato di:

* isolation;
* security;
* availability;
* monitoring;
* backup;
* change control;
* access control;
* auditability.

Le modifiche production devono essere applicate tramite un processo controllato.

L'accesso manuale alle risorse deve essere limitato e soggetto alle policy di sicurezza definite nel progetto.

Le modifiche infrastrutturali devono passare attraverso Terraform e la CI/CD pipeline, salvo procedure operative eccezionali e documentate.

---

# AWS Account Strategy

Una possibile strategia è utilizzare un AWS Account separato per ogni ambiente:

```text
AWS Organization
│
├── Dev Account
│
├── Staging Account
│
└── Production Account
```

Questo modello fornisce una forte separazione tra gli ambienti e riduce il rischio che una modifica effettuata in un ambiente possa avere effetti diretti sugli altri.

I principali vantaggi sono:

* account-level isolation;
* IAM boundaries separate;
* billing separato;
* CloudTrail separato;
* Service Quotas separate;
* riduzione del blast radius;
* maggiore separazione dei dati;
* maggiore controllo degli accessi production.

L'utilizzo di account separati introduce però maggiore complessità organizzativa e operativa.

Per questo motivo la scelta definitiva dell'account strategy deve essere considerata una decisione architetturale da validare prima dell'implementazione Terraform definitiva.

---

# Single Account Strategy

Nel caso in cui inizialmente venga utilizzato un singolo AWS Account, gli ambienti devono comunque essere separati tramite:

* naming;
* tagging;
* risorse dedicate;
* Terraform state separati;
* IAM policies;
* configurazioni separate;
* Secrets Manager secrets separati;
* CloudWatch log groups separati;
* S3 buckets separati quando necessario;
* database e data stores separati.

Esempio concettuale:

```text
AWS Account
│
├── dev
│   ├── Lambda
│   ├── Aurora
│   ├── S3
│   └── OpenSearch
│
├── staging
│   ├── Lambda
│   ├── Aurora
│   ├── S3
│   └── OpenSearch
│
└── prod
    ├── Lambda
    ├── Aurora
    ├── S3
    └── OpenSearch
```

Questa strategia deve essere considerata una separazione logica e non equivalente all'isolamento fornito da AWS Accounts separati.

---

# Terraform Environment Structure

La struttura Terraform prevista è:

```text
terraform/
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

I `modules` contengono componenti infrastrutturali riutilizzabili.

Gli `environments` definiscono invece la composizione concreta dell'infrastruttura per ogni ambiente.

Esempio concettuale:

```text
modules/
    networking
        ↓
environments/dev
        ↓
dev AWS resources

modules/
    networking
        ↓
environments/staging
        ↓
staging AWS resources

modules/
    networking
        ↓
environments/prod
        ↓
prod AWS resources
```

L'obiettivo è evitare duplicazione della logica infrastrutturale mantenendo configurazioni specifiche per ambiente.

---

# Terraform State

Ogni ambiente deve avere un Terraform state separato.

Esempio concettuale:

```text
Terraform State
│
├── dev
│
├── staging
│
└── prod
```

Il state deve essere archiviato in un backend remoto e protetto.

La strategia prevista utilizza **Amazon S3** per il Terraform state, con state locking secondo la configurazione supportata dalla versione di Terraform adottata.

Il Terraform state non deve essere:

* salvato nel repository Git;
* condiviso tra ambienti;
* esposto pubblicamente;
* incluso nei build artifacts.

Il bucket utilizzato per il state deve avere appropriate misure di sicurezza, tra cui:

* Block Public Access;
* encryption;
* access control tramite IAM;
* versioning;
* logging/audit dove necessario.

L'accesso al Terraform state deve essere limitato ai ruoli che eseguono Terraform.

---

# Environment Configuration

Le configurazioni specifiche dell'ambiente devono essere separate dal codice dei moduli.

Esempi di variabili:

```text
environment
aws_region
vpc_cidr
availability_zones
lambda_memory
lambda_timeout
database_instance_class
database_backup_retention
opensearch_configuration
log_retention
```

I valori devono essere definiti per ambiente.

Esempio concettuale:

```text
dev
├── smaller capacity
├── shorter retention
└── lower cost

staging
├── production-like configuration
└── controlled capacity

prod
├── production capacity
├── stronger protection
└── higher availability requirements
```

I valori sensibili non devono essere memorizzati direttamente nei file Terraform.

Le credenziali e gli altri secret devono essere gestiti tramite **AWS Secrets Manager** o altri meccanismi appropriati.

---

# Environment Naming

Le risorse devono utilizzare naming coerente con l'ambiente.

Esempio:

```text
real-estate-dev-*
real-estate-staging-*
real-estate-prod-*
```

Il naming deve essere combinato con AWS Tags.

Esempio concettuale:

```text
Project       = real-estate
Environment   = dev
ManagedBy     = terraform
```

Altri tag potranno essere aggiunti in base alle esigenze di cost allocation, ownership e compliance.

---

# Data Isolation

Gli ambienti devono avere dati separati.

In particolare:

* production database non deve essere utilizzato direttamente da dev;
* production S3 bucket non deve essere utilizzato da dev;
* production OpenSearch non deve essere utilizzato da staging;
* production secrets non devono essere disponibili agli ambienti inferiori;
* production credentials non devono essere riutilizzate in dev o staging.

Il trasferimento di dati production verso ambienti inferiori non deve essere considerato automatico.

Se in futuro sarà necessario utilizzare dati realistici per testing, dovrà essere definita una procedura specifica per:

* export;
* sanitization;
* anonymization;
* import;
* access control.

---

# Secrets and Credentials

Ogni ambiente deve avere secrets separati.

Esempio:

```text
AWS Secrets Manager
│
├── dev/
│   └── application-secrets
│
├── staging/
│   └── application-secrets
│
└── prod/
    └── application-secrets
```

Production credentials non devono essere riutilizzate negli altri ambienti.

GitHub Actions deve utilizzare **OIDC** per assumere IAM Roles AWS, evitando access keys statiche dove possibile.

Le permissions devono essere limitate all'ambiente interessato.

---

# CI/CD Environment Strategy

GitHub Actions deve trattare gli ambienti come deployment targets distinti.

Flusso concettuale:

```text
Pull Request
     │
     ▼
Terraform fmt / validate
     │
     ▼
Terraform plan
     │
     ▼
Merge
     │
     ▼
dev
     │
     ▼
staging
     │
     ▼
production
```

Il deployment deve essere progressivo.

Ogni environment deve utilizzare:

* IAM Role dedicato;
* Terraform state dedicato;
* secrets/configuration dedicati;
* GitHub Environment dedicato;
* permissions appropriate.

---

# Production Protection

Production deve avere controlli aggiuntivi rispetto a dev e staging.

Esempi:

* GitHub Environment protection rules;
* required approvals;
* IAM permissions più restrittive;
* Terraform plan review;
* accesso limitato agli operatori autorizzati;
* monitoring più completo;
* backup e recovery configurati secondo i requisiti production.

L'obiettivo è evitare che un normale deployment development possa applicare accidentalmente modifiche all'ambiente production.

---

# Promotion Flow

Il flusso previsto è:

```text
Developer
    │
    ▼
Pull Request
    │
    ▼
Terraform Validation
    │
    ▼
Merge
    │
    ▼
Development
    │
    ▼
Staging Validation
    │
    ▼
Production Approval
    │
    ▼
Production
```

La promozione deve essere tracciabile attraverso Git e GitHub Actions.

Ogni deployment deve permettere di identificare:

* commit;
* Terraform version;
* environment;
* Terraform plan;
* Terraform apply;
* timestamp;
* identity che ha avviato il deployment.

---

# Observability per Environment

Ogni ambiente deve avere monitoring separato.

Dev:

* logging sufficiente per debugging;
* metriche principali;
* alarms essenziali.

Staging:

* monitoring più vicino a production;
* test degli alarms;
* validazione dei log e delle metriche.

Production:

* monitoring completo;
* alarms critici;
* audit;
* tracing;
* incident investigation;
* retention definita in base ai requisiti operativi.

I log group e le metriche devono essere chiaramente associati all'ambiente.

---

# Backup and Recovery

Le strategie di backup devono essere differenziate in base all'importanza dell'ambiente.

Production deve avere requisiti espliciti per:

* backup retention;
* point-in-time recovery;
* database snapshots;
* S3 data protection;
* disaster recovery;
* recovery procedures;
* Recovery Point Objective (RPO);
* Recovery Time Objective (RTO).

Dev e staging possono avere policy differenti, purché sia chiaro che i loro backup non sostituiscono quelli production.

Le procedure di recovery dovrebbero essere testate periodicamente.

---

# Cost Management

Gli ambienti inferiori devono essere dimensionati in modo coerente con il loro scopo.

Per dev e staging possono essere valutati:

* minori instance sizes;
* minori retention periods;
* scale-down policies;
* risorse non sempre attive quando compatibile con i test;
* OpenSearch capacity ridotta;
* database capacity ridotta.

Production deve invece essere dimensionato sulla base dei requisiti di:

* performance;
* availability;
* traffic;
* data volume;
* recovery;
* business requirements.

Le decisioni di cost optimization non devono compromettere i requisiti fondamentali dell'ambiente production.

---

# Environment Dependencies

La dipendenza tra ambienti deve essere evitata.

Idealmente:

```text
dev       ──X──> staging
staging   ──X──> prod
dev       ──X──> prod
```

Un ambiente non deve dipendere runtime da un altro ambiente.

La promozione avviene tramite deployment dello stesso codice/configurazione controllata, non tramite una dipendenza diretta tra risorse AWS di ambienti differenti.

---

# Disaster Recovery

La strategia di Disaster Recovery deve essere definita principalmente per production.

Gli elementi da considerare includono:

* multi-AZ;
* database backups;
* Aurora recovery;
* S3 data protection;
* infrastructure recreation tramite Terraform;
* Terraform state recovery;
* secrets recovery;
* DNS recovery;
* eventuale multi-region strategy.

La configurazione multi-region non è prevista come requisito iniziale e rimane una decisione futura basata sui requisiti di availability e RTO/RPO.

---

# Open Decisions

Le seguenti decisioni devono essere definite prima dell'implementazione definitiva:

* [ ] AWS Account separati per environment;
* [ ] single-account strategy iniziale;
* [ ] AWS Organization structure;
* [ ] Terraform state bucket strategy;
* [ ] Terraform state locking configuration;
* [ ] AWS Region;
* [ ] environment-specific AWS Regions;
* [ ] naming convention definitiva;
* [ ] tagging strategy;
* [ ] GitHub Environments;
* [ ] production approval process;
* [ ] branch strategy;
* [ ] deployment promotion strategy;
* [ ] backup retention per environment;
* [ ] RPO/RTO production;
* [ ] disaster recovery strategy;
* [ ] data sanitization per test data;
* [ ] cost optimization strategy per dev/staging.

---

# Environment Principles

La strategia degli ambienti segue questi principi:

1. **Isolation** — ogni environment deve essere isolato dagli altri.
2. **Reproducibility** — l'infrastruttura deve poter essere ricreata tramite Terraform.
3. **Least Privilege** — ogni deployment role deve avere solo le permissions necessarie.
4. **Production Protection** — production deve avere controlli aggiuntivi.
5. **Data Isolation** — i dati production non devono essere esposti agli ambienti inferiori.
6. **Traceability** — ogni deployment deve essere riconducibile a un commit.
7. **Automation** — i deployment devono essere eseguiti tramite CI/CD.
8. **Consistency** — gli ambienti devono condividere gli stessi principali architectural patterns.
9. **Controlled Differences** — le differenze tra ambienti devono essere deliberate e documentate.
10. **Recovery** — production deve avere una strategia esplicita di backup e recovery.

---

# Related Documentation

* [Infrastructure](../infrastructure/README.md)
* [Networking](../infrastructure/networking.md)
* [Security](../infrastructure/security.md)
* [Database](../infrastructure/database.md)
* [Storage](../infrastructure/storage.md)
* [Messaging](../infrastructure/messaging.md)
* [Observability](../infrastructure/observability.md)
* [Architecture](../architecture/README.md)
* [Security Architecture](../architecture/security.md)
* [Data Architecture](../architecture/data.md)

---

# Implementation Status

La gestione degli ambienti è attualmente documentata a livello architetturale.

Non sono ancora presenti:

* Terraform configurations;
* AWS Accounts configuration;
* Terraform backends;
* GitHub Actions workflows;
* GitHub Environment configuration;
* AWS IAM deployment roles.

Questi elementi saranno implementati nelle fasi successive del progetto.
