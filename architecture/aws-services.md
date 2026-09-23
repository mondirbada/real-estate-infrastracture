# Servizi AWS

Questo documento descrive i principali servizi AWS utilizzati dalla piattaforma, la loro responsabilità e il loro ruolo all'interno dell'architettura.

L'obiettivo non è descrivere le configurazioni tecniche dei singoli servizi, ma definire **perché ogni servizio esiste e quale responsabilità ha**.

---

## Frontend e accesso

### Amazon CloudFront

**Responsabilità:** distribuzione del frontend e gestione dell'accesso ai contenuti pubblici.

CloudFront rappresenta il punto di ingresso principale per il frontend della piattaforma.

Viene utilizzato per:

* distribuire i contenuti attraverso una CDN;
* ridurre la latenza per gli utenti;
* gestire la distribuzione degli asset statici;
* applicare controlli di sicurezza a livello edge;
* integrare AWS WAF.

```text
User
 │
 ▼
CloudFront
 │
 ▼
Frontend
```

---

### Next.js

**Responsabilità:** frontend dell'applicazione.

Next.js costituisce l'interfaccia utilizzata dagli utenti per interagire con la piattaforma.

Il frontend comunica principalmente con:

* Amazon Cognito per l'autenticazione;
* API Gateway per le API applicative;
* CloudFront per la distribuzione.

---

## Autenticazione e sicurezza

### Amazon Cognito

**Responsabilità:** gestione dell'identità e autenticazione degli utenti.

Cognito gestisce:

* registrazione degli utenti;
* autenticazione;
* gestione delle sessioni;
* emissione dei token;
* informazioni relative all'identità dell'utente.

Il frontend utilizza Cognito per autenticare l'utente prima di effettuare richieste verso le API protette.

```text
User
 │
 ▼
Next.js
 │
 ▼
Cognito
 │
 ▼
Access Token
 │
 ▼
API Gateway
```

---

### AWS WAF

**Responsabilità:** protezione degli endpoint esposti pubblicamente.

AWS WAF viene utilizzato per applicare regole di sicurezza alle richieste HTTP.

Può essere utilizzato per:

* filtrare richieste indesiderate;
* limitare pattern di traffico sospetti;
* applicare rate limiting;
* proteggere dagli attacchi web più comuni.

Il posizionamento e le regole specifiche verranno documentati nella sezione dedicata alla sicurezza.

---

### AWS IAM

**Responsabilità:** gestione delle autorizzazioni verso le risorse AWS.

IAM viene utilizzato per definire:

* ruoli;
* policy;
* permessi;
* identità utilizzate dai servizi.

L'architettura segue il principio del **least privilege**, concedendo a ogni componente solamente i permessi necessari per svolgere la propria funzione.

---

## API e backend

### Amazon API Gateway

**Responsabilità:** esposizione e gestione delle API backend.

API Gateway rappresenta il punto di ingresso alle funzionalità backend della piattaforma.

Si occupa principalmente di:

* ricevere le richieste HTTP;
* instradare le richieste verso le Lambda corrette;
* applicare autenticazione e autorizzazione;
* gestire configurazioni comuni delle API;
* integrare funzionalità di monitoring e logging.

```text
Next.js
   │
   ▼
API Gateway
   │
   ├──► Users Lambda
   ├──► Properties Lambda
   └──► CRM Lambda
```

---

### AWS Lambda

**Responsabilità:** esecuzione della logica backend.

Lambda viene utilizzato per eseguire il codice backend senza gestire server persistenti.

Le funzioni sono organizzate per responsabilità funzionale.

Esempi iniziali:

```text
Users Lambda
Properties Lambda
CRM Lambda
```

Le Lambda possono comunicare con:

* RDS Proxy;
* S3;
* EventBridge;
* SQS;
* OpenSearch;
* Step Functions;
* altri servizi AWS necessari alla loro responsabilità.

---

## Database

### Amazon Aurora PostgreSQL

**Responsabilità:** persistenza principale dei dati applicativi.

Aurora PostgreSQL rappresenta il database relazionale principale della piattaforma.

Viene utilizzato per dati strutturati come:

* utenti;
* immobili;
* informazioni CRM;
* lead;
* relazioni tra entità;
* configurazioni applicative.

Aurora rappresenta la **fonte primaria dei dati applicativi**.

---

### Amazon RDS Proxy

**Responsabilità:** gestione delle connessioni tra Lambda e Aurora.

RDS Proxy viene utilizzato come livello intermedio tra le Lambda e il database.

```text
Lambda
   │
   ▼
RDS Proxy
   │
   ▼
Aurora PostgreSQL
```

Il proxy permette di gestire in maniera più efficiente le connessioni provenienti da un ambiente serverless, dove numerose Lambda possono essere eseguite contemporaneamente.

---

## Storage

### Amazon S3

**Responsabilità:** storage degli oggetti e dei file.

S3 viene utilizzato per contenuti che non devono essere memorizzati direttamente nel database relazionale.

Esempi:

* immagini degli immobili;
* documenti;
* allegati;
* file generati dalla piattaforma;
* altri contenuti multimediali.

```text
Application
     │
     ▼
    S3
     │
     ├── Images
     ├── Documents
     └── Files
```

I metadati relativi ai file possono essere mantenuti in Aurora mentre il contenuto fisico viene conservato su S3.

---

## Eventi e messaggistica

### Amazon EventBridge

**Responsabilità:** distribuzione degli eventi tra i componenti della piattaforma.

EventBridge costituisce il principale event bus dell'architettura.

I servizi possono pubblicare eventi senza conoscere direttamente i consumer.

```text
                ┌──► Lambda
                │
Service ──► EventBridge ──► SQS
                │
                └──► Step Functions
```

Questo modello riduce l'accoppiamento tra i componenti.

Esempi di eventi:

```text
PropertyCreated
PropertyUpdated
PropertyPublished

LeadCreated
LeadUpdated

MediaUploaded
```

La struttura definitiva degli eventi sarà definita in `architecture/events.md`.

---

### Amazon SQS

**Responsabilità:** gestione delle code per le elaborazioni asincrone.

SQS viene utilizzato quando un'operazione non deve essere completata durante la richiesta HTTP.

Esempio:

```text
EventBridge
     │
     ▼
    SQS
     │
     ▼
Worker Lambda
```

I principali vantaggi sono:

* disaccoppiamento tra producer e consumer;
* gestione delle richieste asincrone;
* possibilità di retry;
* gestione dei picchi di traffico;
* maggiore resilienza.

---

### Lambda Workers

**Responsabilità:** elaborazione asincrona dei messaggi provenienti dalle code.

I worker Lambda consumano i messaggi presenti nelle code SQS ed eseguono le operazioni necessarie.

Esempi:

* aggiornamento degli indici OpenSearch;
* elaborazione di file;
* sincronizzazioni;
* elaborazioni di background;
* notifiche.

---

## Ricerca

### Amazon OpenSearch

**Responsabilità:** ricerca e indicizzazione.

OpenSearch viene utilizzato per fornire funzionalità di ricerca efficienti sui dati che richiedono indicizzazione.

Aurora rimane la fonte primaria dei dati.

OpenSearch rappresenta invece una vista ottimizzata per la ricerca.

```text
Aurora
   │
   ▼
EventBridge
   │
   ▼
SQS
   │
   ▼
Worker Lambda
   │
   ▼
OpenSearch
```

Questo permette di mantenere separati:

* persistenza dei dati;
* indicizzazione;
* ricerca.

---

## Workflow

### AWS Step Functions

**Responsabilità:** orchestrazione di workflow complessi.

Step Functions viene utilizzato quando un processo richiede più passaggi coordinati e una gestione esplicita dello stato.

Può gestire:

* sequenze di operazioni;
* branching;
* retry;
* timeout;
* gestione degli errori;
* esecuzione di servizi diversi.

Esempio concettuale:

```text
Start
  │
  ▼
Validate
  │
  ▼
Process
  │
  ├──► Success
  │
  └──► Error / Retry
```

---

## Email

### Amazon SES

**Responsabilità:** invio delle email applicative.

SES viene utilizzato per l'invio di email generate dalla piattaforma.

Esempi:

* notifiche;
* email transazionali;
* comunicazioni relative ai processi applicativi;
* notifiche generate da workflow.

SES verrà integrato principalmente con Lambda e/o Step Functions in base al tipo di workflow.

---

## Secrets

### AWS Secrets Manager

**Responsabilità:** gestione sicura dei segreti.

Secrets Manager viene utilizzato per memorizzare informazioni sensibili necessarie ai servizi applicativi.

Esempi:

* credenziali;
* API key;
* secret;
* configurazioni sensibili.

I segreti non devono essere inseriti:

* nel codice;
* nei repository Git;
* nei file di configurazione versionati;
* nelle immagini container.

L'accesso ai secret deve essere controllato tramite IAM.

---

## Monitoring e osservabilità

### Amazon CloudWatch

**Responsabilità:** monitoring, logging e metriche.

CloudWatch viene utilizzato per raccogliere:

* log;
* metriche;
* allarmi;
* informazioni operative.

I principali componenti dell'architettura devono essere osservabili tramite CloudWatch.

---

### AWS X-Ray

**Responsabilità:** distributed tracing.

X-Ray viene utilizzato per analizzare il percorso delle richieste attraverso i diversi componenti dell'architettura.

Un esempio di tracing può essere:

```text
Frontend
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

Il tracing è particolarmente utile per identificare:

* latenze;
* colli di bottiglia;
* errori;
* dipendenze tra servizi.

---

### AWS CloudTrail

**Responsabilità:** audit delle operazioni effettuate sulle risorse AWS.

CloudTrail registra le attività effettuate tramite le API AWS e permette di ricostruire operazioni amministrative e modifiche alle risorse.

Viene utilizzato come componente dell'architettura di auditing e sicurezza.

---

## Infrastructure as Code

### Terraform

**Responsabilità:** definizione e provisioning dell'infrastruttura tramite codice.

Terraform sarà utilizzato per descrivere l'infrastruttura AWS in maniera riproducibile e versionabile.

L'obiettivo è evitare configurazioni manuali non tracciate e permettere di ricreare gli ambienti tramite codice.

---

## CI/CD

### GitHub Actions

**Responsabilità:** automazione dei processi di Continuous Integration e Continuous Delivery.

GitHub Actions verrà utilizzato per automatizzare i processi relativi all'infrastruttura e, in una fase successiva, al codice applicativo.

Esempi:

* validazione Terraform;
* linting;
* test;
* plan;
* deployment;
* gestione dei diversi ambienti.

---

## Riepilogo

| Servizio          | Responsabilità principale    |
| ----------------- | ---------------------------- |
| CloudFront        | CDN e distribuzione frontend |
| Cognito           | Identità e autenticazione    |
| API Gateway       | API e routing                |
| Lambda            | Backend serverless           |
| Aurora PostgreSQL | Database principale          |
| RDS Proxy         | Connection pooling           |
| S3                | Storage di file e media      |
| EventBridge       | Event bus                    |
| SQS               | Code asincrone               |
| Lambda Workers    | Elaborazioni background      |
| OpenSearch        | Ricerca e indicizzazione     |
| Step Functions    | Orchestrazione workflow      |
| SES               | Invio email                  |
| Secrets Manager   | Gestione segreti             |
| CloudWatch        | Monitoring e logging         |
| X-Ray             | Distributed tracing          |
| CloudTrail        | Audit                        |
| IAM               | Autorizzazioni               |
| WAF               | Protezione applicativa       |
| Terraform         | Infrastructure as Code       |
| GitHub Actions    | CI/CD                        |

---

## Documenti correlati

* [Architettura High Level](high-level.md)
* [Networking](networking.md)
* [Data Architecture](data.md)
* [Event Architecture](events.md)
* [Security](security.md)
