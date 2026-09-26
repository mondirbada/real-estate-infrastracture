# Security Infrastructure

## Overview

La security infrastructure implementa i principali controlli di sicurezza dell'architettura AWS.

Il modello segue i principi di:

* **Defense in Depth**;
* **Least Privilege**;
* **Identity-based Access Control**;
* **Network Isolation**;
* **Encryption by Default**;
* **Centralized Secrets Management**;
* **Auditability**;
* **Environment Isolation**.

I principali AWS services coinvolti sono:

* **AWS Identity and Access Management (IAM)**;
* **AWS Key Management Service (KMS)**;
* **AWS Secrets Manager**;
* **Amazon Cognito**;
* **AWS WAF**;
* **AWS CloudTrail**;
* **Amazon CloudWatch**.

La security infrastructure deve essere considerata trasversale a tutti gli altri layer.

```text
                         Security Layer
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
       IAM                   KMS              Secrets Manager
        │                     │                     │
        ├──────────────┬──────┴──────┬──────────────┤
        │              │             │              │
     Lambda         Aurora          S3         Event Services
        │              │             │              │
        └──────────────┴─────────────┴──────────────┘
                              │
                         CloudTrail
                              │
                         CloudWatch
```

---

# AWS IAM

**AWS Identity and Access Management (IAM)** costituisce il principale sistema di autorizzazione tra AWS resources e identities.

L'obiettivo è assegnare a ogni componente solamente i permessi necessari per svolgere la propria funzione.

Il modello deve evitare l'utilizzo di:

* AWS account root per attività operative;
* shared IAM users;
* long-lived access keys dove non necessarie;
* `AdministratorAccess` per workload applicativi;
* wildcard permissions non giustificate.

---

# IAM Roles

Le **IAM Roles** devono essere utilizzate come principale meccanismo di accesso dei workload AWS.

Esempi:

```text id="j3q7pf"
Lambda Users
    │
    └──► Users Lambda Role

Lambda Properties
    │
    └──► Properties Lambda Role

Lambda CRM
    │
    └──► CRM Lambda Role

Search Worker
    │
    └──► Search Worker Role
```

Le execution roles devono essere separate quando le responsabilità e i permessi sono differenti.

Questo evita che una compromissione di una Lambda garantisca automaticamente accesso a tutte le risorse dell'applicazione.

---

# IAM Policy Strategy

Le policy devono seguire il principio di **Least Privilege**.

Una policy dovrebbe specificare, quando possibile:

* `Effect`;
* `Action`;
* `Resource`;
* eventuali `Condition`.

Esempio concettuale:

```json id="q8v2md"
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject"
  ],
  "Resource": "arn:aws:s3:::bucket/path/*"
}
```

È preferibile evitare:

```json id="m5c9xz"
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```

quando non strettamente necessario.

---

# Service-specific Roles

Le IAM Roles devono essere progettate in funzione delle responsabilità.

Possibile modello:

| Role                   | Main Responsibilities   |
| ---------------------- | ----------------------- |
| Users Lambda Role      | User-related operations |
| Properties Lambda Role | Property operations     |
| CRM Lambda Role        | CRM operations          |
| Media Worker Role      | S3/media processing     |
| Search Worker Role     | OpenSearch indexing     |
| Notification Role      | Notification workflows  |
| Step Functions Role    | Workflow orchestration  |
| GitHub Actions Role    | Terraform deployment    |

La struttura definitiva verrà definita durante l'implementazione Terraform.

---

# Lambda Permissions

Ogni Lambda deve avere una execution role dedicata o condivisa solamente quando le permission sono effettivamente equivalenti.

Esempio:

```text id="w7k4pc"
Properties Lambda
      │
      └── IAM Role
            │
            ├── Aurora / RDS Proxy
            ├── S3
            └── EventBridge
```

La Lambda non deve ricevere permessi verso servizi che non utilizza.

Ad esempio, una Lambda che esegue solamente indexing su OpenSearch non dovrebbe avere automaticamente accesso a Secrets Manager, S3 e SES.

---

# Amazon Cognito

Amazon Cognito gestisce l'identità degli utenti applicativi.

Il modello previsto è:

```text id="a6r9mv"
User
 │
 ▼
Amazon Cognito
 │
 │ Authentication
 ▼
Token
 │
 ▼
API Gateway
 │
 ▼
Lambda
```

Cognito è responsabile dell'autenticazione.

L'applicazione rimane responsabile dell'autorizzazione business-specific.

---

# Authentication vs Authorization

È importante mantenere separate:

**Authentication**

```text
"Who is this user?"
```

gestita principalmente tramite Amazon Cognito.

**Authorization**

```text
"What is this user allowed to do?"
```

gestita attraverso:

* Cognito claims/groups quando appropriato;
* API Gateway;
* application logic;
* IAM per accesso AWS.

L'esistenza di un token valido non implica automaticamente che l'utente possa accedere a qualsiasi risorsa applicativa.

---

# API Authorization

API Gateway deve validare l'autenticazione prima di inoltrare le richieste alle Lambda, secondo il meccanismo di authorizer scelto.

Il flusso concettuale è:

```text id="k4p8sf"
User
 │
 ▼
API Gateway
 │
 ├── Authentication valid?
 │       │
 │       ├── No ──► 401
 │       │
 │       └── Yes
 │
 ▼
Lambda
 │
 ▼
Authorization
 │
 ├── Allowed
 └── Forbidden
```

Le verifiche business-specific devono rimanere nell'application layer.

---

# AWS WAF

**AWS WAF** protegge gli entry point HTTP pubblici da traffico indesiderato e pattern di attacco comuni.

Il WAF deve essere applicato ai punti di ingresso compatibili con l'architettura.

Il modello principale è:

```text id="x8m2qd"
Internet
   │
   ▼
AWS WAF
   │
   ▼
CloudFront
   │
   ▼
Application
```

Per eventuali API endpoint esposti tramite una distribuzione CloudFront dedicata, il WAF potrà essere associato anche a tale entry point.

La configurazione definitiva dipenderà dal modello di esposizione scelto per frontend e API.

---

# WAF Rules

Le WAF Rules dovranno essere definite in funzione dei requisiti applicativi.

Possibili categorie:

* managed rule groups;
* rate limiting;
* IP restrictions;
* request filtering;
* geo restrictions, se richieste;
* protezione da pattern HTTP anomali.

Le regole devono essere introdotte con attenzione per evitare falsi positivi.

La configurazione production dovrà prevedere monitoring e review delle WAF decisions.

---

# AWS KMS

**AWS Key Management Service (KMS)** gestisce le encryption keys utilizzate quando è richiesta una gestione esplicita delle chiavi.

KMS può essere utilizzato per proteggere:

* S3 objects;
* Secrets Manager secrets;
* SQS messages;
* database encryption;
* altri dati supportati dagli AWS services.

Il modello concettuale è:

```text id="r7v3nk"
AWS KMS
   │
   ├── S3
   ├── Secrets Manager
   ├── SQS
   └── Aurora
```

Non tutti i servizi devono necessariamente utilizzare la stessa KMS Key.

---

# KMS Key Strategy

La strategia delle KMS Keys deve considerare:

* environment;
* tipo di dato;
* separation of duties;
* access control;
* key rotation;
* audit;
* costi;
* eventuali requisiti di compliance.

Una possibile strategia è separare le chiavi per environment:

```text
dev
 └── KMS Keys

staging
 └── KMS Keys

prod
 └── KMS Keys
```

La granularità esatta sarà definita durante l'implementazione.

---

# Key Policies

Le KMS Key Policies devono essere progettate insieme alle IAM Policies.

L'accesso alla key deve essere concesso solamente alle identities che devono effettivamente utilizzarla.

Esempio concettuale:

```text id="c5q9wb"
Lambda Role
     │
     │ kms:Decrypt
     ▼
KMS Key
     │
     ▼
Encrypted Secret
```

L'accesso a una risorsa encrypted non implica automaticamente il permesso di utilizzare la relativa KMS Key.

Entrambi i livelli devono essere configurati correttamente.

---

# AWS Secrets Manager

**AWS Secrets Manager** deve essere utilizzato per la gestione dei secrets applicativi.

Possibili secrets:

* database credentials;
* API keys;
* third-party credentials;
* application secrets;
* altri valori sensibili che non devono essere presenti nel repository.

Il flusso concettuale è:

```text id="p4m7xs"
Lambda
 │
 ▼
IAM Role
 │
 ▼
Secrets Manager
 │
 ▼
Secret
```

I secrets non devono essere inseriti direttamente nel codice sorgente o nei file Terraform in chiaro.

---

# Secrets and Lambda

Quando una Lambda necessita di un secret, la execution role deve ricevere solamente il permesso necessario.

Esempio:

```text id="v6k2ra"
Lambda
 │
 └── secretsmanager:GetSecretValue
             │
             ▼
       Specific Secret
```

La permission deve essere limitata al singolo secret quando possibile.

---

# Database Credentials

Le credenziali di Aurora PostgreSQL dovranno essere gestite tramite una strategia esplicita.

Le opzioni principali sono:

* credentials gestite tramite Secrets Manager;
* IAM Database Authentication, se appropriato;
* integrazione con Amazon RDS Proxy.

La scelta definitiva è già identificata come **Open Decision** nella documentazione database.

Non devono essere presenti database credentials hardcoded nel repository.

---

# GitHub Actions OIDC

La CI/CD pipeline utilizzerà **OpenID Connect (OIDC)** per ottenere credenziali AWS temporanee.

Il modello previsto è:

```text id="n8w4fc"
GitHub Actions
      │
      │ OIDC Token
      ▼
AWS IAM
      │
      │ Assume Role
      ▼
Deployment Role
      │
      ▼
Terraform
```

Questo evita di memorizzare AWS access keys permanenti nei GitHub Secrets.

---

# GitHub Actions Deployment Role

La deployment role utilizzata da GitHub Actions deve essere separata dalle execution roles dell'applicazione.

Esempio:

```text id="m3q7vx"
GitHub Actions
      │
      ▼
Terraform Deployment Role
      │
      ├── Networking
      ├── Security
      ├── Compute
      ├── Database
      └── Storage
```

I permessi della role devono essere limitati agli environment autorizzati.

Production deve avere controlli aggiuntivi rispetto a development.

---

# OIDC Trust Policy

La trust relationship della deployment role deve limitare le identità GitHub autorizzate.

I controlli possono includere:

* GitHub organization;
* repository;
* branch;
* environment;
* workflow context.

L'obiettivo è evitare che qualsiasi repository GitHub possa assumere la deployment role.

---

# Terraform State Security

Il Terraform state può contenere informazioni sensibili o riferimenti a infrastruttura interna.

Lo state deve quindi essere protetto.

La strategia futura dovrà prevedere:

* remote backend;
* encryption;
* access control;
* versioning;
* eventuale locking;
* separazione per environment.

Un modello tipico è:

```text id="z9p4kx"
GitHub Actions
      │
      ▼
Terraform
      │
      ▼
Remote State
      │
      ▼
Protected Storage
```

Il Terraform state non deve essere committato nel repository Git.

---

# S3 Security

I bucket Amazon S3 devono utilizzare:

* Block Public Access;
* IAM policies;
* Bucket Policies quando necessarie;
* encryption;
* eventuale Versioning;
* Lifecycle Rules;
* presigned URLs per accesso temporaneo.

Il principio è:

```text id="e2m8qw"
Public Access
     │
     ▼
   DENIED

Authorized Application
     │
     ▼
IAM / Presigned URL
     │
     ▼
Amazon S3
```

Non è previsto rendere pubblici direttamente i bucket contenenti dati applicativi.

---

# Database Security

Aurora PostgreSQL deve rimanere in private subnets.

Il modello è:

```text id="h7v3mc"
Lambda
 │
 ▼
RDS Proxy
 │
 ▼
Aurora PostgreSQL
```

Security Groups devono limitare il traffico alle sorgenti autorizzate.

Il database non deve essere direttamente raggiungibile da Internet.

Le credenziali devono essere gestite tramite il meccanismo scelto tra Secrets Manager e IAM Database Authentication.

---

# OpenSearch Security

OpenSearch deve essere protetto tramite:

* network isolation;
* Security Groups;
* IAM;
* encryption;
* access policies;
* TLS.

Il traffico applicativo deve essere limitato alle Lambda e ai componenti autorizzati.

Non deve essere necessario esporre OpenSearch direttamente a Internet per consentire il normale funzionamento dell'applicazione.

---

# Encryption in Transit

Le comunicazioni devono utilizzare TLS quando supportato.

Esempi:

```text id="q5r9bx"
Client
  │ HTTPS
  ▼
CloudFront / API Gateway

Lambda
  │ TLS
  ▼
RDS Proxy

Lambda
  │ HTTPS
  ▼
S3

Lambda Worker
  │ HTTPS
  ▼
OpenSearch
```

La configurazione dovrà utilizzare TLS e certificate validation secondo le impostazioni AWS appropriate.

---

# CloudTrail

**AWS CloudTrail** deve essere utilizzato per l'audit delle API AWS.

CloudTrail permette di registrare operazioni come:

* creazione e modifica delle risorse;
* modifiche IAM;
* accesso alle configurazioni;
* attività amministrative;
* eventi rilevanti per security investigation.

Il modello è:

```text id="d8k3wf"
AWS Account
    │
    ├── IAM
    ├── S3
    ├── Lambda
    ├── KMS
    └── Other Services
            │
            ▼
        CloudTrail
```

La retention dei log deve essere definita in funzione dei requisiti di audit.

---

# CloudWatch Security Monitoring

Amazon CloudWatch può essere utilizzato per creare alert relativi a eventi di sicurezza e infrastruttura.

Possibili segnali:

* Lambda authentication/authorization errors;
* WAF blocked requests;
* anomalie nelle DLQ;
* database connectivity errors;
* unexpected infrastructure changes;
* elevated error rates.

CloudWatch non sostituisce CloudTrail: i due servizi hanno responsabilità differenti.

---

# Audit vs Application Logging

È importante distinguere:

**CloudTrail**

```text
AWS API Activity
```

**CloudWatch Logs**

```text
Application / Runtime Logs
```

**WAF Logs**

```text
Web Request Filtering
```

**VPC Flow Logs**

```text
Network Traffic Metadata
```

Ogni fonte deve essere utilizzata per il relativo caso d'uso.

---

# Sensitive Data in Logs

I log applicativi non devono contenere informazioni sensibili non necessarie.

In particolare, devono essere evitati:

* password;
* access tokens;
* refresh tokens;
* database credentials;
* secret values;
* dati personali non necessari;
* authorization headers completi.

Le Lambda dovranno utilizzare logging strutturato e controllato.

---

# Environment Isolation

La security infrastructure deve essere separata per environment.

```text id="k2x7pm"
Development
    │
    ├── IAM
    ├── KMS
    ├── Secrets
    └── Cognito

Staging
    │
    ├── IAM
    ├── KMS
    ├── Secrets
    └── Cognito

Production
    │
    ├── IAM
    ├── KMS
    ├── Secrets
    └── Cognito
```

Production deve avere policy e access control più restrittivi rispetto agli environment non-production.

L'utilizzo di AWS Accounts distinti può fornire un ulteriore livello di isolamento.

---

# Administrative Access

L'accesso amministrativo AWS deve essere limitato agli utenti autorizzati.

Devono essere evitati:

* IAM users condivisi;
* credenziali condivise;
* access keys permanenti non necessarie;
* uso operativo dell'account root.

Devono essere utilizzati meccanismi di accesso centralizzati e MFA secondo le capacità e i requisiti dell'organizzazione AWS.

---

# Break-Glass Access

Per production può essere definito un meccanismo di **break-glass access**.

Questo accesso deve essere:

* fortemente limitato;
* utilizzato solo in caso di emergenza;
* protetto da MFA;
* auditabile;
* monitorato.

La procedura operativa verrà definita separatamente.

---

# Security Boundaries

I principali security boundaries sono:

```text id="r8f2mc"
Internet
   │
   ▼
WAF
   │
   ▼
CloudFront / API Gateway
   │
   ▼
Application Identity
   │
   ▼
Lambda IAM Roles
   │
   ├── S3
   ├── EventBridge
   ├── SQS
   ├── Secrets Manager
   └── RDS Proxy
             │
             ▼
          Aurora
```

Ogni livello deve impedire che un problema in un componente si propaghi automaticamente a tutta l'infrastruttura.

---

# Terraform Security Structure

La futura implementazione Terraform potrà organizzare le risorse security in un modulo dedicato:

```text id="f4m8qx"
terraform/
└── modules/
    └── security/
        ├── iam.tf
        ├── kms.tf
        ├── secrets.tf
        ├── waf.tf
        ├── cloudtrail.tf
        ├── variables.tf
        ├── outputs.tf
        └── versions.tf
```

La struttura definitiva potrà essere modificata quando emergeranno dipendenze concrete tra moduli.

---

# Security Dependencies

La security layer è trasversale a quasi tutti gli altri moduli.

```text id="p6v2zk"
Networking
    │
    └── Security Groups

Security
    │
    ├── IAM
    ├── KMS
    ├── Secrets Manager
    ├── WAF
    └── CloudTrail
          │
          ▼
Compute / Database / Storage / Messaging
```

Le permission dovranno essere definite insieme alle risorse che le utilizzano, evitando policy centralizzate eccessivamente permissive.

---

# Security Checklist

Prima della production deployment dovranno essere verificati almeno:

* [ ] Root account non utilizzato per operazioni ordinarie
* [ ] MFA configurato per accessi amministrativi
* [ ] IAM Least Privilege
* [ ] Nessuna AWS access key permanente non necessaria
* [ ] GitHub Actions OIDC configurato
* [ ] Production deployment role protetta
* [ ] S3 Block Public Access abilitato
* [ ] S3 encryption configurata
* [ ] Aurora non pubblico
* [ ] RDS Proxy protetto da Security Groups
* [ ] OpenSearch non pubblicamente esposto
* [ ] Secrets gestiti tramite Secrets Manager
* [ ] KMS policies verificate
* [ ] TLS configurato
* [ ] WAF configurato
* [ ] CloudTrail abilitato
* [ ] CloudWatch alarms configurati
* [ ] VPC Flow Logs valutati/configurati
* [ ] Sensitive data esclusi dai log
* [ ] Environment isolation verificata
* [ ] Terraform state protetto
* [ ] IAM policies revisionate
* [ ] DLQ monitoring configurato
* [ ] Security incident procedure definita

---

# Open Decisions

Prima dell'implementazione Terraform dovranno essere definiti:

* IAM role strategy;
* granularità delle Lambda execution roles;
* Cognito authorization model;
* API Gateway authorizer;
* WAF managed rules;
* WAF rate limiting;
* KMS key strategy;
* SSE-S3 vs SSE-KMS;
* Secrets Manager strategy;
* database authentication;
* GitHub Actions OIDC trust policy;
* Terraform deployment permissions;
* Terraform state backend;
* CloudTrail retention;
* CloudWatch security alerts;
* VPC Flow Logs retention;
* administrative access model;
* break-glass procedure;
* eventuale centralized security account;
* eventuale AWS Organizations strategy.

---

# Related Documentation

* [Security Architecture](../architecture/security.md)
* [Networking Architecture](../architecture/networking.md)
* [Infrastructure Overview](./README.md)
* [Compute Infrastructure](./compute.md)
* [Database Infrastructure](./database.md)
* [Storage Infrastructure](./storage.md)
* [Messaging Infrastructure](./messaging.md)
