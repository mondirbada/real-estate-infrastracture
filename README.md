# Real Estate Platform — Architettura Infrastrutturale

Repository dedicata alla definizione, documentazione e condivisione dell'architettura infrastrutturale della piattaforma per la gestione e la vendita di immobili.

L'obiettivo di questa repository è fornire una visione condivisa dell'infrastruttura, dei componenti AWS utilizzati, delle loro responsabilità e delle modalità con cui comunicano tra loro.

> **Nota:** in questa fase la repository contiene esclusivamente documentazione architetturale e diagrammi. Il codice applicativo e l'implementazione dell'infrastruttura verranno aggiunti in una fase successiva.

---

## Architettura ad alto livello

```text
                         ┌─────────────┐
                         │ CloudFront  │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │   Next.js   │
                         └──────┬──────┘
                                │
                   ┌────────────┴────────────┐
                   │                         │
                   ▼                         ▼
              ┌──────────┐             ┌─────────────┐
              │ Cognito  │             │ API Gateway │
              └──────────┘             └──────┬──────┘
                                             │
                          ┌──────────────────┼──────────────────┐
                          │                  │                  │
                          ▼                  ▼                  ▼
                       Users            Properties             CRM
                       Lambda              Lambda             Lambda
                          │                  │                  │
                          └──────────────────┼──────────────────┘
                                             │
                                             ▼
                                      ┌──────────────┐
                                      │  RDS Proxy   │
                                      └──────┬───────┘
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │ Aurora PostgreSQL│
                                    └──────────────────┘
                                             │
                         ┌───────────────────┴───────────────────┐
                         │                                       │
                         ▼                                       ▼
                        S3                                  EventBridge
                    Media / Files                               │
                                                         ┌───────┼────────┐
                                                         │       │        │
                                                         ▼       ▼        ▼
                                                        SQS    Lambda  Step Functions
                                                         │       │
                                                         ▼       ▼
                                                      Workers OpenSearch
```

---

## Obiettivo della repository

La repository ha lo scopo di documentare:

* architettura generale della piattaforma;
* servizi AWS utilizzati;
* responsabilità dei singoli componenti;
* comunicazione tra i diversi servizi;
* flussi dei dati;
* architettura degli eventi;
* struttura di rete;
* modello di sicurezza;
* gestione degli ambienti;
* principali decisioni architetturali.

La documentazione deve essere sufficientemente chiara da permettere a un nuovo membro del team di comprendere l'architettura senza dover conoscere preventivamente l'intero progetto.

---

## Stack tecnologico

| Area                    | Tecnologia               |
| ----------------------- | ------------------------ |
| Frontend                | Next.js                  |
| CDN                     | Amazon CloudFront        |
| Autenticazione          | Amazon Cognito           |
| API                     | Amazon API Gateway       |
| Backend                 | AWS Lambda               |
| Database                | Amazon Aurora PostgreSQL |
| Gestione connessioni DB | Amazon RDS Proxy         |
| File e media            | Amazon S3                |
| Ricerca                 | Amazon OpenSearch        |
| Code                    | Amazon SQS               |
| Eventi                  | Amazon EventBridge       |
| Workflow                | AWS Step Functions       |
| Email                   | Amazon SES               |
| Gestione segreti        | AWS Secrets Manager      |
| Monitoring              | Amazon CloudWatch        |
| Tracing                 | AWS X-Ray                |
| Sicurezza               | AWS WAF / IAM            |
| Infrastructure as Code  | Terraform                |
| CI/CD                   | GitHub Actions           |

---

## Struttura della repository

```text
.
├── architecture/       # Architettura generale e diagrammi
├── infrastructure/     # Documentazione dei componenti infrastrutturali
├── flows/              # Flussi applicativi e infrastrutturali
├── environments/       # Documentazione degli ambienti
└── decisions/          # Decisioni architetturali
```

### `architecture/`

Contiene la documentazione dell'architettura generale e i relativi diagrammi.

```text
architecture/
├── README.md
├── high-level.md
├── aws-services.md
├── networking.md
├── data.md
├── events.md
├── security.md
└── diagrams/
```

### `infrastructure/`

Contiene la documentazione dei singoli aspetti dell'infrastruttura:

* compute;
* database;
* storage;
* networking;
* messaging;
* sicurezza;
* osservabilità.

### `flows/`

Contiene la descrizione dei principali flussi del sistema, ad esempio:

* creazione e modifica di un immobile;
* ricerca di un immobile;
* caricamento di immagini e documenti;
* gestione dei lead;
* invio di notifiche;
* indicizzazione su OpenSearch.

### `environments/`

Descrive la struttura e le differenze tra i diversi ambienti:

* `dev`
* `staging`
* `production`

### `decisions/`

Contiene le principali decisioni architetturali attraverso degli **Architecture Decision Records (ADR)**.

---

## Diagrammi

L'architettura viene rappresentata attraverso più diagrammi, ognuno con un livello di dettaglio e uno scopo specifico.

| Diagramma        | Descrizione                                |
| ---------------- | ------------------------------------------ |
| High Level       | Vista generale della piattaforma           |
| AWS Architecture | Servizi AWS e relazioni tra loro           |
| Network          | VPC, subnet e confini di rete              |
| Data Flow        | Flusso dei dati attraverso il sistema      |
| Events           | Comunicazione event-driven                 |
| Security         | Autenticazione, autorizzazione e sicurezza |

I diagrammi saranno mantenuti principalmente tramite **Mermaid**, in modo da poterli versionare insieme alla documentazione.

---

## Principi architetturali

L'architettura segue, dove appropriato, i seguenti principi:

* **Serverless-first**
* utilizzo di servizi AWS gestiti;
* architettura **event-driven**;
* separazione delle responsabilità;
* principio del **least privilege**;
* infrastruttura riproducibile tramite Infrastructure as Code;
* isolamento tra gli ambienti;
* osservabilità integrata;
* gestione centralizzata dei segreti;
* contratti espliciti tra i componenti;
* minimizzazione degli accoppiamenti tra servizi.

---

## Documentazione

Per iniziare a conoscere il progetto si consiglia di seguire questo ordine:

1. [Architettura generale](architecture/high-level.md)
2. [Servizi AWS](architecture/aws-services.md)
3. [Networking](architecture/networking.md)
4. [Architettura dei dati](architecture/data.md)
5. [Architettura degli eventi](architecture/events.md)
6. [Sicurezza](architecture/security.md)
7. [Ambienti](environments/README.md)
8. [Decisioni architetturali](decisions/README.md)

---

## Stato del progetto

Questa repository rappresenta la **definizione architetturale iniziale** della piattaforma.

L'architettura è soggetta a evoluzione durante le fasi di progettazione e sviluppo. Le modifiche significative all'architettura dovranno essere documentate e, quando necessario, accompagnate da un nuovo Architecture Decision Record.

---

## Contributi

Le modifiche alla documentazione e all'architettura devono essere effettuate tramite Pull Request.

Ogni modifica dovrebbe:

* descrivere chiaramente cosa è cambiato;
* aggiornare i diagrammi interessati;
* aggiornare la documentazione collegata;
* mantenere coerenti diagrammi e documentazione testuale;
* introdurre un ADR quando viene presa una nuova decisione architetturale significativa.
