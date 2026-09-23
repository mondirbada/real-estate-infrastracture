# Security Architecture

## Overview

La sicurezza della piattaforma è basata su un approccio **Defense in Depth**, con più livelli di protezione distribuiti tra identity, application, network, data e infrastructure.

L'obiettivo è:

* ridurre la superficie di attacco;
* applicare il principio del Least Privilege;
* proteggere dati e credenziali;
* isolare le risorse private;
* controllare gli accessi;
* mantenere una traccia delle operazioni;
* rilevare e gestire eventuali anomalie.

## Architecture Diagram

![Security Architecture](./diagrams/security.jpeg)

## Security Principles

L'architettura segue i seguenti principi:

* **Least Privilege** — ogni identità riceve esclusivamente i permessi necessari;
* **Defense in Depth** — la sicurezza è distribuita su più livelli;
* **Minimize Public Exposure** — le risorse pubbliche devono essere limitate allo stretto necessario;
* **Separation of Responsibilities** — ogni componente ha responsabilità e permessi distinti;
* **Centralized Authentication** — l'autenticazione degli utenti è centralizzata;
* **Explicit Authorization** — l'autorizzazione viene verificata esplicitamente;
* **Encryption** — i dati vengono protetti durante il transito e a riposo;
* **Centralized Secrets Management** — i secrets non vengono memorizzati nel repository;
* **Auditability** — le operazioni infrastrutturali devono essere tracciabili;
* **Environment Isolation** — gli ambienti devono essere separati.

## Security Layers

La sicurezza può essere rappresentata attraverso diversi livelli:

```text id="lqz8lq"
Internet
   │
   ▼
AWS WAF
   │
   ▼
CloudFront
   │
   ▼
API Gateway
   │
   ▼
Authentication / Authorization
   │
   ▼
Lambda
   │
   ├───────────────┐
   │               │
   ▼               ▼
RDS Proxy       AWS Services
   │
   ▼
Aurora PostgreSQL

Supporting Security Services:
IAM
Cognito
Secrets Manager
KMS
CloudTrail
CloudWatch
X-Ray
```

## Authentication

Amazon Cognito gestisce l'autenticazione degli utenti applicativi.

Il sistema deve distinguere tra:

* human identities;
* service identities.

Gli utenti applicativi vengono autenticati tramite Amazon Cognito.

I servizi AWS utilizzano invece AWS IAM roles e policies per accedere alle risorse.

## Authorization

L'autenticazione stabilisce l'identità dell
