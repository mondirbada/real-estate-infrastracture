# Networking Infrastructure

## Overview

La networking infrastructure definisce la rete AWS all'interno della quale verranno eseguite le componenti che richiedono isolamento di rete.

Il networking si basa principalmente su:

* **Amazon VPC**;
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

L'obiettivo è mantenere una **minimal public surface** e consentire l'accesso pubblico solo ai componenti che ne hanno effettivamente bisogno.

Il modello generale è:

```text id="v7x4pk"
Internet
    │
    ▼
CloudFront + WAF
    │
    ▼
API Gateway
    │
    │
    ├─────────────────────────────┐
    │                             │
    ▼                             ▼
Lambda                      AWS Managed Services
    │                       S3 / EventBridge /
    │                       SQS / SES
    │
    ▼
Private Subnets
    │
    ├── RDS Proxy
    │       │
    │       ▼
    │    Aurora PostgreSQL
    │
    └── OpenSearch
```

Non tutti i componenti devono essere inseriti nella VPC.

---

# Amazon VPC

Amazon VPC costituisce il principale network boundary dell'infrastruttura.

La VPC ospiterà le risorse che richiedono isolamento di rete, in particolare:

* Amazon Aurora PostgreSQL;
* Amazon RDS Proxy;
* Amazon OpenSearch Service;
* eventuali Lambda che devono accedere direttamente a risorse private;
* eventuali componenti futuri che richiedano networking privato.

La VPC dovrà essere progettata per supportare almeno due Availability Zones in production.

---

# Availability Zones

La configurazione production dovrà utilizzare più Availability Zones per migliorare la resilienza.

Schema concettuale:

```text id="b2n8hf"
                 VPC
                  │
        ┌─────────┴─────────┐
        │                   │
   Availability Zone A  Availability Zone B
        │                   │
   Private Subnets      Private Subnets
        │                   │
        ├── Aurora       ├── Aurora
        ├── RDS Proxy    ├── RDS Proxy
        └── OpenSearch   └── OpenSearch
```

La distribuzione effettiva delle risorse dipenderà dalle caratteristiche dei singoli AWS services.

Il numero di Availability Zones utilizzate per dev e staging potrà essere differente rispetto a production per contenere i costi.

---

# Subnet Strategy

La VPC dovrà essere suddivisa in subnet con responsabilità differenti.

Il modello concettuale è:

```text id="x9c4tm"
VPC
│
├── Public Subnets
│
│   └── Internet-facing infrastructure
│
└── Private Subnets
    │
    ├── Application
    ├── Database
    └── Search
```

La distinzione principale è:

* **Public Subnets**: risorse che devono avere un percorso diretto verso un Internet Gateway;
* **Private Subnets**: risorse senza indirizzo IP pubblico e senza esposizione diretta a Internet.

Le risorse database e search devono essere mantenute nelle subnet private.

---

# Public Subnets

Le Public Subnets sono associate a Route Tables che contengono una route verso l'**Internet Gateway**.

Schema:

```text id="h6r1zc"
Public Subnet
      │
      ▼
Route Table
      │
      │ 0.0.0.0/0
      ▼
Internet Gateway
      │
      ▼
Internet
```

L'utilizzo di Public Subnets deve essere limitato alle risorse che ne hanno realmente necessità.

Il fatto che una subnet sia pubblica non implica che ogni risorsa presente al suo interno debba essere pubblicamente accessibile.

---

# Private Subnets

Le Private Subnets non devono avere una route diretta verso un Internet Gateway.

Le risorse private potranno raggiungere servizi esterni tramite:

* NAT Gateway, quando necessario;
* VPC Endpoints, quando supportati e appropriati.

Schema:

```text id="j5p8wd"
Private Subnet
      │
      ▼
Route Table
      │
      ▼
NAT Gateway
      │
      ▼
Internet Gateway
      │
      ▼
Internet
```

Per l'accesso ai servizi AWS supportati da VPC Endpoint:

```text id="s2m7qa"
Private Subnet
      │
      ▼
VPC Endpoint
      │
      ▼
AWS Service
```

---

# Route Tables

Le Route Tables devono essere separate in base al tipo di subnet.

## Public Route Table

Esempio concettuale:

```text id="w8q3dn"
Destination        Target

VPC CIDR           local
0.0.0.0/0          Internet Gateway
```

## Private Route Table

Esempio:

```text id="r6k2fx"
Destination        Target

VPC CIDR           local
0.0.0.0/0          NAT Gateway
```

Le route effettive dipenderanno dall'uso dei VPC Endpoints e dall'eventuale necessità di comunicazione verso network esterni.

---

# Internet Gateway

L'**Internet Gateway** fornisce il collegamento tra la VPC e Internet per le risorse che dispongono di routing e configurazione compatibili.

L'Internet Gateway sarà associato alla VPC.

Non deve essere utilizzato come meccanismo per esporre direttamente:

* Aurora PostgreSQL;
* RDS Proxy;
* OpenSearch.

Queste risorse devono rimanere private.

---

# NAT Gateway

Il **NAT Gateway** permette alle risorse private di effettuare connessioni outbound verso Internet senza diventare direttamente raggiungibili dall'esterno.

Possibili casi d'uso:

* download di dipendenze;
* accesso a servizi esterni;
* outbound HTTP/HTTPS;
* comunicazione verso endpoint che non dispongono di un VPC Endpoint appropriato.

Il traffico è principalmente:

```text id="c3v9am"
Private Resource
      │
      ▼
NAT Gateway
      │
      ▼
Internet Gateway
      │
      ▼
Internet
```

Il NAT Gateway non consente connessioni inbound arbitrarie dalla Internet.

---

## NAT Gateway Strategy

La configurazione production dovrà valutare un NAT Gateway per Availability Zone oppure una strategia centralizzata.

### NAT Gateway per AZ

```text id="a7k4xp"
AZ A                         AZ B
 │                            │
Private                       Private
 │                            │
NAT A                         NAT B
```

Vantaggi:

* maggiore resilienza;
* traffico locale all'AZ;
* riduzione delle dipendenze cross-AZ.

Svantaggi:

* costo maggiore.

### Shared NAT Gateway

```text id="n3f8wd"
Private Subnets
      │
      ▼
Shared NAT Gateway
      │
      ▼
Internet Gateway
```

Vantaggi:

* costo inferiore;
* infrastruttura più semplice.

Svantaggi:

* possibile dipendenza cross-AZ;
* maggiore impatto in caso di failure del NAT Gateway.

La scelta definitiva è un'**Open Decision**.

---

# VPC Endpoints

I **VPC Endpoints** devono essere valutati per ridurre il traffico attraverso il NAT Gateway quando un AWS service supporta un accesso privato appropriato.

Un caso particolarmente rilevante è Amazon S3.

Schema:

```text id="p8m4yz"
Private Lambda
     │
     ▼
S3 VPC Endpoint
     │
     ▼
Amazon S3
```

I VPC Endpoints possono essere:

* Gateway Endpoints;
* Interface Endpoints.

La scelta dipende dal servizio AWS utilizzato.

Possibili servizi da valutare includono:

* Amazon S3;
* Amazon DynamoDB, se introdotto in futuro;
* AWS Secrets Manager;
* Amazon CloudWatch;
* AWS STS;
* altri servizi necessari alle Lambda private.

Non è necessario creare automaticamente un Endpoint per ogni AWS service.

La decisione deve tenere conto di:

* supporto del servizio;
* security;
* costi;
* frequenza del traffico;
* dipendenza dal NAT Gateway.

---

# Lambda Networking

Le Lambda non devono essere inserite automaticamente nella VPC.

Una Lambda che utilizza esclusivamente servizi AWS pubblici/managed può rimanere fuori dalla VPC.

Una Lambda deve essere associata alla VPC quando necessita di accesso diretto a risorse private, ad esempio:

```text id="t1y6qb"
Lambda
   │
   ▼
RDS Proxy
   │
   ▼
Aurora PostgreSQL
```

oppure:

```text id="m5c9vx"
Lambda
   │
   ▼
OpenSearch
```

Questa distinzione permette di evitare complessità di networking non necessarie.

---

# Lambda Subnet Placement

Le Lambda che richiedono accesso a risorse private dovranno essere associate a subnet private.

Esempio:

```text id="z4n7kc"
VPC
│
├── Private App Subnet A
│      └── Lambda
│
├── Private App Subnet B
│      └── Lambda
│
├── Private DB Subnet A
│      └── Aurora
│
└── Private DB Subnet B
       └── Aurora
```

Le subnet applicative e database possono essere separate logicamente anche quando entrambe sono private.

---

# Aurora Networking

Amazon Aurora PostgreSQL dovrà essere deployato all'interno di private subnets.

Il database non deve avere accesso pubblico.

Schema:

```text id="u8r2lm"
Lambda
   │
   ▼
RDS Proxy
   │
   ▼
Private Subnet
   │
   ▼
Aurora PostgreSQL
```

L'accesso deve essere controllato tramite Security Groups.

---

# RDS Proxy Networking

Amazon RDS Proxy sarà posizionato all'interno della VPC e associato alle subnet appropriate.

Il traffico previsto è:

```text id="v6k9pd"
Lambda
   │
   │ TCP
   ▼
RDS Proxy
   │
   │ TCP
   ▼
Aurora PostgreSQL
```

Il Security Group del Proxy dovrà consentire connessioni provenienti esclusivamente dalle risorse applicative autorizzate.

Il database dovrà accettare connessioni dal Security Group del RDS Proxy, non genericamente dalla VPC.

---

# OpenSearch Networking

Amazon OpenSearch Service dovrà essere configurato con networking coerente con i requisiti di sicurezza dell'applicazione.

Quando utilizzato all'interno della VPC:

```text id="e5r7kt"
Lambda Worker
      │
      ▼
Security Group
      │
      ▼
OpenSearch
```

Il dominio non deve essere esposto pubblicamente se non espressamente richiesto.

L'accesso deve essere limitato alle applicazioni e ai ruoli autorizzati.

---

# Security Groups

I **Security Groups** costituiscono il principale controllo stateful del traffico tra le risorse.

La strategia deve essere basata su riferimenti tra Security Groups anziché su CIDR troppo permissivi quando possibile.

Esempio:

```text id="q2w8nf"
Lambda SG
    │
    │ TCP 5432
    ▼
RDS Proxy SG
    │
    │ TCP 5432
    ▼
Aurora SG
```

Per OpenSearch:

```text id="j4m6xs"
Lambda Worker SG
       │
       │ HTTPS
       ▼
OpenSearch SG
```

Non è previsto l'utilizzo di:

```text
0.0.0.0/0
```

come source per porte interne sensibili quando è possibile utilizzare un Security Group specifico.

---

# Security Group Strategy

I Security Groups saranno organizzati per responsabilità.

Possibile modello:

```text id="c7p3vr"
sg-lambda
sg-rds-proxy
sg-aurora
sg-opensearch
```

Esempio di relazioni:

```text id="n9x5kd"
sg-lambda
    │
    ├──► sg-rds-proxy : 5432
    │
    └──► sg-opensearch : 443

sg-rds-proxy
    │
    └──► sg-aurora : 5432
```

Questo modello rende esplicite le dipendenze di rete.

---

# Network ACLs

Le **Network ACLs (NACLs)** costituiscono un ulteriore livello di network control.

La configurazione dovrà evitare regole eccessivamente complesse che rendano difficile il troubleshooting.

Il controllo principale tra applicazione e database dovrà essere affidato ai Security Groups.

Le NACLs possono essere utilizzate come ulteriore boundary quando richiesto dai requisiti di sicurezza.

---

# DNS

La VPC dovrà utilizzare i meccanismi DNS forniti da AWS.

Devono essere abilitate le funzionalità necessarie per:

* DNS resolution;
* DNS hostnames;
* risoluzione degli endpoint AWS;
* eventuali private hosted zones future.

Il DNS interno deve permettere alle risorse private di utilizzare gli endpoint appropriati senza dipendere da configurazioni statiche di IP.

---

# VPC Flow Logs

I **VPC Flow Logs** potranno essere utilizzati per osservare il traffico di rete.

Sono utili per:

* troubleshooting;
* security investigation;
* identificazione di connessioni rifiutate;
* analisi del traffico;
* auditing.

Il logging dovrà essere configurato tenendo conto di:

* retention;
* costi;
* destinazione dei log;
* requisiti di sicurezza.

---

# Network Architecture

Il modello complessivo può essere rappresentato come:

```text id="r3q8mf"
                         Internet
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
                    ┌───────┴───────┐
                    │               │
             Private Subnet    AWS Services
                    │           S3 / SQS /
                    │           EventBridge /
                    │           SES
                    │
          ┌─────────┴─────────┐
          │                   │
       RDS Proxy          OpenSearch
          │
          ▼
       Aurora
```

CloudFront, API Gateway e molti altri AWS managed services non devono essere interpretati come risorse collocate fisicamente nelle Public Subnets della VPC.

La VPC rappresenta il network boundary per le risorse che richiedono networking privato.

---

# Traffic Patterns

## Public Request

```text id="d6v2ka"
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
```

## Database Access

```text id="h8m4yc"
Lambda
 │
 ▼
RDS Proxy
 │
 ▼
Aurora
```

## Search Access

```text id="w2p6fz"
Lambda Worker
 │
 ▼
OpenSearch
```

## S3 Access

Quando non è necessario un accesso privato dalla VPC:

```text id="k7n3vx"
Lambda
 │
 ▼
Amazon S3
```

Quando viene utilizzato un VPC Endpoint:

```text id="s5q9jm"
Private Lambda
 │
 ▼
S3 VPC Endpoint
 │
 ▼
Amazon S3
```

---

# Environment Isolation

Ogni environment deve avere un network boundary separato.

Esempio:

```text id="b6r2wd"
dev
 └── VPC

staging
 └── VPC

prod
 └── VPC
```

La separazione può essere ulteriormente rafforzata tramite AWS Accounts distinti.

Non devono esistere route o peering tra environment se non espressamente richiesti.

---

# CIDR Strategy

La VPC dovrà utilizzare un CIDR range sufficientemente ampio da permettere crescita futura.

La pianificazione deve considerare:

* numero di Availability Zones;
* numero di subnet;
* crescita delle risorse;
* eventuali VPC Peering;
* eventuali Transit Gateway;
* eventuale espansione futura.

Un esempio concettuale, non ancora definitivo:

```text id="x3f8qm"
VPC
10.0.0.0/16
│
├── Public A
├── Public B
├── Private App A
├── Private App B
├── Private DB A
└── Private DB B
```

Il CIDR definitivo verrà stabilito prima dell'implementazione Terraform.

---

# Infrastructure Dependencies

La networking infrastructure costituisce una delle fondamenta dell'infrastruttura AWS.

Dipendenze principali:

```text id="p7k4nc"
VPC
 │
 ├── Subnets
 │
 ├── Route Tables
 │
 ├── Internet Gateway
 │
 ├── NAT Gateway
 │
 ├── VPC Endpoints
 │
 ├── Security Groups
 │
 └── Network ACLs
       │
       ├── Lambda
       ├── RDS Proxy
       ├── Aurora
       └── OpenSearch
```

Le risorse database e search dipenderanno quindi dal network layer.

---

# Terraform Structure

La networking infrastructure verrà implementata successivamente tramite Terraform.

Struttura prevista:

```text id="m1z8kf"
terraform/
└── modules/
    └── networking/
        ├── main.tf
        ├── variables.tf
        ├── outputs.tf
        └── versions.tf
```

Il modulo potrà gestire:

* VPC;
* subnets;
* route tables;
* Internet Gateway;
* NAT Gateway;
* VPC Endpoints;
* Security Groups;
* Network ACLs;
* Flow Logs.

La configurazione degli environment verrà mantenuta separata dal modulo riutilizzabile.

---

# Cost Considerations

I principali elementi di costo sono:

* NAT Gateway;
* data processing;
* VPC Endpoints;
* cross-AZ traffic;
* Elastic IP associati al NAT Gateway;
* Flow Logs;
* eventuali componenti network aggiuntivi.

Particolare attenzione deve essere posta al traffico cross-AZ.

La progettazione deve evitare di introdurre dipendenze cross-AZ non necessarie, soprattutto per workload ad alto volume.

---

# Open Decisions

Prima dell'implementazione Terraform dovranno essere definiti:

* VPC CIDR;
* numero di Availability Zones;
* numero di Public Subnets;
* numero di Private App Subnets;
* numero di Private DB Subnets;
* eventuale separazione Search Subnets;
* NAT Gateway per AZ vs shared;
* VPC Endpoints necessari;
* Security Group strategy definitiva;
* NACL strategy;
* DNS configuration;
* VPC Flow Logs destination;
* Flow Logs retention;
* eventuali VPC Peering requirements;
* eventuale Transit Gateway futuro;
* cross-AZ traffic strategy;
* environment isolation;
* eventuale multi-account networking.

---

# Related Documentation

* [Architecture Networking](../architecture/networking.md)
* [Security Architecture](../architecture/security.md)
* [Infrastructure Overview](./README.md)
* [Compute Infrastructure](./compute.md)
* [Database Infrastructure](./database.md)
* [Storage Infrastructure](./storage.md)
* [Messaging Infrastructure](./messaging.md)
