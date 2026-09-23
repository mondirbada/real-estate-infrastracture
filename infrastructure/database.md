# Database

## Overview

Il database layer gestisce la persistenza transazionale della piattaforma.

La soluzione principale è basata su:

* Amazon Aurora PostgreSQL;
* Amazon RDS Proxy;
* AWS Secrets Manager;
* VPC Private Subnets;
* Security Groups;
* encryption tramite AWS KMS quando richiesto.

Amazon Aurora PostgreSQL rappresenta la **source of truth** per i dati transazionali.

RDS Proxy costituisce il livello intermedio tra le applicazioni Serverless e il database.

## Architecture

Il flusso applicativo principale è:

```text
AWS Lambda
     │
     ▼
RDS Proxy
     │
     ▼
Aurora PostgreSQL
     │
     ├── Primary Data
     └── Transactional Data
```

Il database non deve essere direttamente accessibile da Internet.

## Amazon Aurora PostgreSQL

Amazon Aurora PostgreSQL viene utilizzato come database relazionale principale.

Aurora gestisce i dati strutturati dell'applicazione, inclusi:

* Users;
* Properties;
* CRM;
* application metadata;
* file metadata;
* relazioni tra entità.

Il database deve garantire:

* transactional consistency;
* referential integrity;
* backup;
* high availability;
* controlled access.

## Aurora Cluster

L'infrastruttura utilizzerà un Aurora DB Cluster.

Concettualmente:

```text id="j5pj6d"
Aurora Cluster
│
├── Writer Instance
│
└── Reader Instance(s)
```

La configurazione definitiva del numero e del tipo di DB Instances dipenderà dai requisiti di workload e availability.

La configurazione iniziale dovrà essere sufficientemente semplice da poter essere estesa in seguito.

## Availability Zones

Aurora deve essere distribuito in modo da garantire resilienza rispetto al failure di una singola Availability Zone.

Il DB subnet group dovrà utilizzare subnet private distribuite su più Availability Zones.

Concettualmente:

```text id="h7s2me"
AWS Region
│
├── Availability Zone A
│   └── Private Subnet
│
└── Availability Zone B
    └── Private Subnet

          │
          ▼
    Aurora Cluster
```

La configurazione esatta delle AZ sarà definita tramite Terraform.

## DB Subnet Group

Aurora deve utilizzare un DB Subnet Group composto da private subnets.

Il subnet group deve:

* utilizzare almeno due Availability Zones;
* non contenere subnet pubbliche;
* essere dedicato alle risorse database quando appropriato.

## Database Security Group

Aurora deve essere protetto tramite un Security Group dedicato.

Il database Security Group non deve consentire accesso pubblico.

Il traffico deve essere consentito esclusivamente dai workload autorizzati.

Il modello previsto è:

```text id="4n0czi"
Lambda Security Group
        │
        ▼
RDS Proxy Security Group
        │
        ▼
Aurora Security Group
```

Le regole definitive dipenderanno dall'implementazione VPC e dal modello di networking scelto.

## RDS Proxy

Amazon RDS Proxy viene utilizzato tra Lambda e Aurora PostgreSQL.

Il proxy fornisce un livello di gestione delle connessioni tra il compute layer e il database.

Il flusso è:

```text id="g5b2dk"
Lambda
  │
  │ database request
  ▼
RDS Proxy
  │
  │ managed connection
  ▼
Aurora
```

Questo è particolarmente importante in un'architettura Serverless, dove un aumento delle invocazioni Lambda può produrre un aumento significativo delle connessioni concorrenti.

## Connection Management

RDS Proxy deve essere configurato per gestire il connection pooling verso Aurora.

La configurazione dovrà essere valutata in relazione a:

* Lambda concurrency;
* database capacity;
* connection limits;
* transaction duration;
* workload profile.

L'obiettivo è evitare che lo scaling del compute produca un sovraccarico delle connessioni al database.

## Database Authentication

L'accesso al database deve utilizzare un meccanismo di autenticazione sicuro.

Le opzioni da valutare includono:

* database credentials gestite tramite AWS Secrets Manager;
* IAM database authentication, quando appropriata e supportata dal workload.

La scelta definitiva sarà documentata prima dell'implementazione.

Le credenziali non devono essere memorizzate nel repository.

## AWS Secrets Manager

Le credenziali utilizzate da Aurora/RDS Proxy devono essere gestite tramite AWS Secrets Manager quando si utilizza il modello basato su database credentials.

Il secret deve essere accessibile esclusivamente alle identità che ne hanno bisogno.

Esempio concettuale:

```text id="yrq8kx"
Lambda / RDS Proxy
        │
        ▼
Secrets Manager
        │
        ▼
Database Credentials
```

I secrets non devono essere inseriti direttamente nel codice Terraform come valori in chiaro.

## Encryption at Rest

Aurora deve utilizzare encryption at rest.

AWS KMS può essere utilizzato per gestire la chiave di encryption quando richiesto dai requisiti di sicurezza.

La strategia definitiva dovrà definire:

* KMS key;
* key policy;
* key rotation;
* access permissions.

## Encryption in Transit

Le connessioni verso il database devono utilizzare TLS quando supportato e richiesto dalla configurazione.

Il traffico tra:

```text
Lambda → RDS Proxy
```

e:

```text
RDS Proxy → Aurora
```

deve essere protetto.

## Database Parameters

Aurora PostgreSQL utilizza DB parameter groups per configurare il comportamento del database.

I parametri custom dovranno essere introdotti solo quando esiste una necessità applicativa o operativa documentata.

La configurazione deve evitare modifiche non necessarie ai default AWS.

Eventuali parameter groups personalizzati saranno gestiti tramite Terraform.

## Backup

Aurora deve utilizzare le funzionalità di backup native del servizio.

La configurazione dovrà definire:

* backup retention;
* preferred backup window;
* preferred maintenance window;
* eventuali snapshot policies.

I valori definitivi dipenderanno dai requisiti di recovery degli ambienti.

## Point-in-Time Recovery

La strategia di backup dovrà supportare il recupero del database a un punto specifico nel tempo quando richiesto dai requisiti.

Il Point-in-Time Recovery deve essere considerato parte della strategia di disaster recovery del database.

## Snapshots

Gli snapshot possono essere utilizzati per:

* backup aggiuntivi;
* disaster recovery;
* creazione di nuovi ambienti;
* procedure operative controllate.

Gli snapshot contenenti dati sensibili devono essere protetti secondo le stesse policy di sicurezza del database.

## High Availability

Aurora deve essere configurato per garantire elevata disponibilità.

La strategia include:

* deployment multi-AZ;
* automated failover;
* database instances ridondate quando richiesto;
* monitoring;
* backup automatici.

La configurazione finale dipenderà dal livello di availability richiesto da ciascun ambiente.

## Scaling

Aurora deve poter gestire la crescita del workload.

Devono essere valutati:

* instance size;
* reader instances;
* storage scaling;
* connection limits;
* workload distribution.

La strategia di scaling deve essere coordinata con RDS Proxy e Lambda concurrency.

## Read Scaling

Quando il workload lo richiede, possono essere utilizzate Aurora reader instances per distribuire le operazioni di lettura.

Concettualmente:

```text id="0jykgl"
Application
    │
    ├── Write ──► Writer
    │
    └── Read ───► Reader(s)
```

La separazione effettiva tra read e write appartiene al design applicativo e non viene introdotta automaticamente.

## Database Migrations

Le modifiche allo schema database devono essere gestite tramite un sistema di migrations.

Terraform deve gestire l'infrastruttura del database, ma non deve diventare il meccanismo principale per applicare modifiche allo schema applicativo.

Il processo previsto è:

```text id="6b6cfr"
Application Change
       │
       ▼
Database Migration
       │
       ▼
Aurora PostgreSQL
```

La tecnologia specifica per le migrations verrà definita nel repository applicativo.

## Monitoring

Il database deve essere monitorato tramite Amazon CloudWatch.

Le metriche da considerare includono:

* CPU utilization;
* database connections;
* memory pressure;
* storage usage;
* read/write throughput;
* latency;
* replication metrics;
* failover events.

Le metriche e gli alarms definitivi verranno definiti nel layer Observability.

## Logging

I database logs devono essere abilitati quando necessari per troubleshooting, auditing o security monitoring.

La configurazione dovrà tenere conto di:

* log retention;
* cost;
* volume;
* informazioni sensibili.

I log non devono contenere dati sensibili non necessari.

## Performance Monitoring

La configurazione definitiva dovrà valutare strumenti AWS per il monitoring delle performance del database.

L'obiettivo è individuare:

* slow queries;
* connection saturation;
* resource bottlenecks;
* anomalous workload;
* inefficient query patterns.

La scelta degli strumenti specifici sarà definita durante l'implementazione.

## Maintenance

Aurora utilizza maintenance windows per operazioni gestite dal servizio.

Devono essere definite finestre compatibili con gli ambienti:

* development;
* staging;
* production.

Production deve utilizzare finestre pianificate che minimizzino l'impatto sul workload applicativo.

## Environment Configuration

La configurazione del database deve variare in base all'ambiente.

Esempio concettuale:

| Environment | Configuration     |
| ----------- | ----------------- |
| Development | cost-optimized    |
| Staging     | production-like   |
| Production  | high availability |

I valori effettivi di instance size, backup retention e scaling verranno definiti durante l'implementazione.

## Database Security

Il database deve rispettare i principi definiti nella Security Architecture.

In particolare:

* private subnets;
* no public access;
* dedicated Security Groups;
* encryption;
* TLS;
* Secrets Manager;
* Least Privilege;
* audit;
* monitoring.

## Infrastructure Dependencies

Il database layer dipende principalmente da:

```text id="x3e6jy"
Networking
    │
    ├── VPC
    ├── Private Subnets
    └── Security Groups
            │
            ▼
       RDS / Aurora
            │
            ▼
        RDS Proxy

Security
    │
    ├── IAM
    ├── KMS
    └── Secrets Manager

Observability
    │
    └── CloudWatch
```

Le dipendenze effettive saranno gestite tramite Terraform.

## Disaster Recovery

La strategia di disaster recovery dovrà considerare:

* automated backups;
* Point-in-Time Recovery;
* snapshots;
* multi-AZ availability;
* eventuale cross-region strategy;
* recovery procedures;
* RTO;
* RPO.

I valori target di RTO e RPO verranno definiti sulla base dei requisiti applicativi.

## Open Decisions

Le principali decisioni ancora da definire sono:

* Aurora instance class;
* number of DB instances;
* reader strategy;
* backup retention;
* maintenance windows;
* backup windows;
* encryption key strategy;
* authentication model;
* RDS Proxy configuration;
* connection limits;
* parameter groups;
* database migrations;
* monitoring thresholds;
* RTO;
* RPO;
* disaster recovery strategy;
* eventuale cross-region replication.

## Related Documentation

* [Infrastructure](./README.md)
* [Compute](./compute.md)
* [Networking](./networking.md)
* [Security](./security.md)
* [Data Architecture](../architecture/data.md)
* [Security Architecture](../architecture/security.md)
* [AWS Services](../architecture/aws-services.md)
