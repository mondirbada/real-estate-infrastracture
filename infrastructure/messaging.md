# Messaging Infrastructure

## Overview

La messaging infrastructure implementa il modello **Event-Driven Architecture** dell'applicazione.

I principali servizi utilizzati sono:

* **Amazon EventBridge** per il routing degli eventi;
* **Amazon SQS** per buffering, decoupling e retry;
* **AWS Step Functions** per workflow multi-step e orchestration.

La separazione delle responsabilità è:

```text id="m8p3qk"
EventBridge
    │
    │ Event Routing
    ▼
SQS
    │
    │ Buffering / Retry
    ▼
Lambda Workers

EventBridge
    │
    │ Workflow Trigger
    ▼
Step Functions
    │
    │ Orchestration
    ▼
Lambda / SES / other services
```

Questi servizi permettono di ridurre il coupling tra i componenti applicativi e di gestire in modo esplicito retry, failure e processamento asincrono.

---

## Amazon EventBridge

Amazon EventBridge costituisce il principale **event routing layer** dell'architettura.

Le sue responsabilità sono:

* ricevere application e domain events;
* applicare event filtering;
* instradare gli eventi verso target differenti;
* separare producer e consumer;
* avviare workflow asincroni;
* integrare servizi AWS e componenti applicativi.

EventBridge non deve essere considerato come una queue.

Il suo compito principale è decidere **dove deve essere inviato un evento**.

---

## Event Producers

Gli eventi possono essere prodotti da diversi componenti.

Esempi:

```text id="k3b1hz"
Lambda
  │
  └── Domain/Application Events

Amazon S3
  │
  └── Object Events

Other AWS Services
  │
  └── Service Events
```

Per gli eventi applicativi, il producer principale sarà costituito dalle Lambda che implementano le operazioni di dominio.

Esempi:

* `PropertyCreated`
* `PropertyUpdated`
* `PropertyPublished`
* `PropertyDeleted`
* `MediaUploaded`
* `UserCreated`
* `LeadCreated`
* `LeadUpdated`

---

## Event Bus

Gli application events verranno pubblicati su un **Amazon EventBridge Event Bus** dedicato all'applicazione.

Schema concettuale:

```text id="s0zq2d"
Application
    │
    ▼
Event Bus
    │
    ├── Rule: Search Indexing
    │       └── SQS
    │
    ├── Rule: Notifications
    │       └── Step Functions
    │
    ├── Rule: Media Processing
    │       └── SQS
    │
    └── Rule: Other Consumers
            └── Target
```

L'Event Bus permette di aggiungere nuovi consumer senza modificare necessariamente il producer originale.

---

## Event Rules

Le **EventBridge Rules** definiscono quali eventi devono essere inoltrati a determinati target.

Il filtering deve essere il più specifico possibile.

Esempio concettuale:

```text id="c9u8da"
PropertyCreated
       │
       ▼
EventBridge Rule
       │
       └──► Search Queue

PropertyPublished
       │
       ▼
EventBridge Rule
       │
       ├──► Search Queue
       └──► Notification Workflow
```

Questo evita che ogni consumer debba ricevere e filtrare tutti gli eventi dell'applicazione.

---

## Event Schema

Gli eventi applicativi dovranno utilizzare un formato coerente.

Esempio:

```json id="9h4k2m"
{
  "eventType": "PropertyCreated",
  "eventId": "uuid",
  "occurredAt": "timestamp",
  "source": "property-service",
  "version": 1,
  "data": {
    "propertyId": "uuid"
  }
}
```

Gli elementi principali sono:

* `eventType`: tipo dell'evento;
* `eventId`: identificatore univoco;
* `occurredAt`: timestamp dell'evento;
* `source`: componente che ha prodotto l'evento;
* `version`: versione del contratto;
* `data`: payload specifico dell'evento.

Gli event contracts devono essere trattati come API interne tra componenti.

---

## Event Versioning

Gli eventi possono evolvere nel tempo.

La versione deve quindi essere esplicita quando necessario.

Esempio:

```text id="x7p2ca"
PropertyCreated v1
PropertyCreated v2
PropertyCreated v3
```

Un consumer deve essere in grado di gestire le versioni supportate del contratto.

La modifica di un event schema non deve introdurre breaking changes inattesi nei consumer esistenti.

---

# Amazon SQS

Amazon SQS viene utilizzato come **asynchronous message queue**.

Le principali responsabilità sono:

* buffering;
* decoupling;
* retry;
* gestione temporanea dei picchi di carico;
* isolamento dei consumer;
* supporto a DLQ.

Il pattern principale è:

```text id="n7v5jf"
Producer
   │
   ▼
EventBridge
   │
   ▼
SQS Queue
   │
   ▼
Lambda Worker
```

EventBridge decide dove inviare l'evento, mentre SQS conserva il messaggio fino al processamento.

---

## Queue Strategy

Le queue devono essere separate in base alla responsabilità del consumer.

Esempio:

```text id="d3s6yw"
EventBridge
    │
    ├──► property-search-queue
    │
    ├──► media-processing-queue
    │
    └──► notification-queue
```

Questo permette di avere:

* scaling indipendente;
* retry indipendenti;
* DLQ separate;
* monitoring specifico;
* failure isolation.

Non è previsto un'unica queue condivisa da tutti i worker.

---

## Standard Queue vs FIFO Queue

La scelta tra **SQS Standard Queue** e **SQS FIFO Queue** deve essere effettuata in base ai requisiti del singolo workload.

### Standard Queue

È il modello predefinito per workload altamente scalabili dove non è richiesta una stretta garanzia di ordering.

È adatto, ad esempio, a:

* search indexing;
* image processing;
* attività asincrone indipendenti.

### FIFO Queue

Può essere utilizzata quando sono necessari:

* ordering;
* deduplicazione;
* processamento sequenziale per un determinato gruppo di messaggi.

L'utilizzo di FIFO non deve essere introdotto automaticamente: deve essere giustificato dal requisito applicativo.

---

## Lambda Event Source Mapping

Le Lambda Worker consumeranno le queue tramite **Lambda Event Source Mapping**.

Schema:

```text id="2h4fkc"
SQS Queue
    │
    │ Polling
    ▼
Lambda Worker
    │
    ▼
Processing
```

AWS gestisce il polling della queue e invia i messaggi alla Lambda secondo la configurazione prevista.

La configurazione dovrà considerare:

* batch size;
* batch window;
* concurrency;
* visibility timeout;
* retry behavior;
* partial batch failure.

---

## Visibility Timeout

Il **Visibility Timeout** deve essere configurato coerentemente con il tempo massimo di processamento della Lambda.

Concettualmente:

```text id="v2n6qa"
Message received
      │
      ▼
Visibility Timeout
      │
      ├── Processing succeeds
      │       └── Message deleted
      │
      └── Processing fails
              └── Message available again
```

Il timeout non deve essere troppo breve rispetto alla durata del processing, altrimenti lo stesso messaggio potrebbe diventare nuovamente visibile mentre è ancora in elaborazione.

---

## Retry Strategy

Gli errori transitori devono poter essere gestiti tramite retry.

Il numero di tentativi e il comportamento dopo i retry devono essere configurati per ogni queue.

Esempio:

```text id="q4n8fs"
Message
   │
   ▼
Lambda Worker
   │
   ├── Success ──► Delete
   │
   └── Failure
         │
         ▼
      Retry
         │
         ├── Success ──► Delete
         │
         └── Repeated Failure
                │
                ▼
               DLQ
```

---

## Dead-Letter Queue

Ogni queue critica deve avere una **Dead-Letter Queue (DLQ)**.

La DLQ permette di isolare messaggi che non possono essere processati correttamente dopo un numero definito di tentativi.

Esempio:

```text id="r2m8ks"
Main Queue
    │
    ▼
Lambda Worker
    │
    ├── Success
    │
    └── Failure
          │
          ▼
       Retry
          │
          ▼
         DLQ
```

I messaggi nella DLQ devono essere monitorati e analizzati.

La DLQ non deve diventare un deposito permanente di errori.

---

## Idempotency

I consumer SQS devono essere progettati per essere **idempotent**.

Lo stesso messaggio potrebbe essere processato più di una volta.

Un worker deve quindi poter ricevere nuovamente lo stesso evento senza generare effetti duplicati indesiderati.

Possibili strategie:

* `eventId` come idempotency key;
* stato di processamento nel database;
* conditional writes;
* controlli prima di creare risorse;
* transazioni dove appropriate.

L'idempotency deve essere gestita a livello applicativo.

---

# AWS Step Functions

AWS Step Functions viene utilizzato per orchestrare workflow che richiedono più passaggi.

A differenza di SQS, Step Functions non è principalmente un meccanismo di buffering.

Il suo compito è rappresentare esplicitamente la sequenza e lo stato di un workflow.

Esempio:

```text id="c1m9vx"
Start
  │
  ▼
Validate
  │
  ▼
Process
  │
  ▼
Persist
  │
  ▼
Notify
  │
  ▼
End
```

---

## Workflow Examples

Possibili workflow:

* property publication;
* media processing;
* customer notifications;
* document processing;
* multi-step CRM operations;
* scheduled business workflows.

Un esempio di notification workflow:

```text id="a8k2pd"
EventBridge
    │
    ▼
Step Functions
    │
    ├── Validate recipient
    │
    ├── Load required data
    │
    ├── Prepare notification
    │
    └── Lambda
          │
          ▼
        SES
```

---

## Workflow State

Step Functions mantiene lo stato del workflow.

Questo permette di modellare:

* success;
* failure;
* retry;
* timeout;
* branching;
* parallel execution;
* compensating actions.

La logica di orchestration deve rimanere distinta dalla business logic delle Lambda.

Step Functions coordina il processo; le Lambda eseguono le operazioni applicative.

---

## Retry and Error Handling

I singoli step possono avere policy di retry differenti.

Esempio concettuale:

```text id="n2w7ra"
Task
 │
 ├── Success ──► Next
 │
 └── Error
       │
       ▼
     Retry
       │
       ├── Success ──► Next
       │
       └── Permanent Failure
              │
              ▼
            Failed
```

Gli errori transient devono poter essere ritentati automaticamente quando appropriato.

Gli errori permanenti devono invece terminare il workflow o attivare un percorso di compensazione.

---

# Messaging Patterns

## Asynchronous Processing

Il pattern principale per processing asincrono è:

```text id="w7f1cd"
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
```

È utilizzato quando il producer non deve attendere il completamento dell'operazione.

---

## Event-Driven Workflow

Per workflow orchestrati:

```text id="b4q9nx"
Lambda
   │
   ▼
EventBridge
   │
   ▼
Step Functions
   │
   ├──► Lambda
   ├──► Lambda
   └──► SES
```

Questo pattern è appropriato quando l'operazione consiste in più step coordinati.

---

## Search Indexing

Un caso importante è la sincronizzazione dell'indice OpenSearch.

```text id="p5j3mz"
Aurora PostgreSQL
       ▲
       │
       │ Transaction
       │
     Lambda
       │
       │ Domain Event
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

Aurora PostgreSQL rimane la **source of truth**.

OpenSearch rappresenta invece una proiezione derivata e può quindi essere aggiornata in modo asincrono.

Questo implica una **eventual consistency** tra database e indice.

---

## Media Processing

Per i file caricati su S3:

```text id="e9v4kt"
Frontend
    │
    ▼
Amazon S3
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
    ├── Processing
    ├── Metadata
    └── Domain Update
```

Questo evita di bloccare la richiesta HTTP durante operazioni di elaborazione potenzialmente lunghe.

---

## Notifications

Per le notifiche:

```text id="x4r8bc"
Domain Event
     │
     ▼
EventBridge
     │
     ▼
Step Functions
     │
     ├── Validate
     ├── Load Data
     ├── Prepare
     └── Lambda
           │
           ▼
          SES
```

La separazione permette di gestire retry e failure senza mantenere aperta la richiesta API originale.

---

# Concurrency and Backpressure

SQS introduce un livello di buffering tra producer e consumer.

Questo è particolarmente importante quando il producer genera messaggi più rapidamente di quanto il consumer possa processarli.

```text id="z6n1ps"
Fast Producer
     │
     ▼
SQS Queue
     │
     │ Buffer
     ▼
Controlled Consumers
```

La capacità dei consumer deve essere configurata tenendo conto della capacità dei sistemi downstream.

Ad esempio, una Lambda Worker non deve poter generare un numero di connessioni Aurora superiore a quello supportabile dal database.

Per questo motivo concurrency e database connection management devono essere progettati insieme a **Amazon RDS Proxy**.

---

# Security

La messaging infrastructure deve utilizzare **IAM Least Privilege**.

Ogni componente deve avere solamente i permessi necessari.

Esempio:

```text id="s5f7qd"
Producer Lambda
    │
    └── events:PutEvents

EventBridge
    │
    └── sqs:SendMessage

Lambda Worker
    │
    └── sqs:ReceiveMessage
        sqs:DeleteMessage
        sqs:GetQueueAttributes
```

Le permission devono essere specifiche per:

* resource;
* action;
* environment.

Non devono essere utilizzati wildcard permissions non necessari.

---

## Encryption

Le queue SQS devono utilizzare encryption at rest secondo i requisiti di sicurezza definiti.

Quando viene utilizzato **AWS KMS**, dovranno essere configurati:

* KMS Key;
* key policy;
* IAM permissions;
* accesso da EventBridge;
* accesso dalle Lambda.

Anche gli eventuali dati sensibili contenuti nei payload devono essere minimizzati.

Gli eventi non dovrebbero contenere dati sensibili quando è sufficiente trasmettere un identificatore.

Esempio preferibile:

```json id="j7s3cx"
{
  "eventType": "PropertyCreated",
  "data": {
    "propertyId": "uuid"
  }
}
```

invece di inserire nell'evento l'intero record dell'immobile.

---

# Observability

La messaging infrastructure deve essere monitorata tramite **Amazon CloudWatch** e gli strumenti di observability dell'architettura.

Metriche importanti includono:

* numero di messaggi;
* queue depth;
* age of oldest message;
* Lambda errors;
* Lambda duration;
* Lambda throttles;
* DLQ messages;
* Step Functions failures;
* workflow duration;
* EventBridge invocation failures.

Gli alert devono essere configurati soprattutto per:

* crescita anomala delle queue;
* messaggi presenti nelle DLQ;
* aumento degli errori;
* consumer throttling;
* workflow failure.

---

# Failure Isolation

Un principio importante è evitare che il failure di un consumer blocchi l'intero sistema.

Esempio:

```text id="u4m8jw"
EventBridge
    │
    ├──► Search Queue ──► Search Worker
    │
    ├──► Media Queue ──► Media Worker
    │
    └──► Notification Workflow
```

Se il search worker presenta un problema, il workflow di notification non deve necessariamente essere bloccato.

La separazione tra queue e workflow permette quindi di ottenere una maggiore **failure isolation**.

---

# Deployment

La messaging infrastructure verrà gestita tramite Terraform.

Le principali risorse future includeranno:

```text id="b9k2hf"
EventBridge
├── Event Bus
└── Rules

SQS
├── Queues
└── Dead-Letter Queues

Step Functions
└── State Machines
```

Le Lambda Event Source Mappings saranno configurate in coordinamento con la compute infrastructure.

---

# Terraform Dependencies

Le principali dipendenze saranno:

```text id="q7m3vx"
IAM
 │
 ├──────────────┐
 ▼              ▼
EventBridge     SQS
 │              │
 │              └── DLQ
 │
 └──────► Step Functions
                 │
                 ▼
               Lambda
```

La messaging layer dipende quindi principalmente da:

* IAM;
* Lambda;
* EventBridge;
* SQS;
* Step Functions;
* KMS, quando utilizzato;
* CloudWatch.

---

# Environment Isolation

Ogni environment deve avere una messaging infrastructure isolata.

```text id="k6p1wr"
dev
 ├── Event Bus
 ├── SQS Queues
 ├── DLQs
 └── Step Functions

staging
 ├── Event Bus
 ├── SQS Queues
 ├── DLQs
 └── Step Functions

prod
 ├── Event Bus
 ├── SQS Queues
 ├── DLQs
 └── Step Functions
```

Un evento prodotto in `dev` non deve poter essere consumato dai componenti `staging` o `prod`.

L'isolamento può essere ulteriormente rafforzato utilizzando AWS Accounts distinti.

---

# Open Decisions

Prima dell'implementazione Terraform dovranno essere definiti:

* Event Bus strategy;
* event naming convention;
* event schema standard;
* event versioning strategy;
* queue naming convention;
* Standard vs FIFO queues;
* queue visibility timeout;
* batch size;
* Lambda concurrency;
* retry policy;
* DLQ retention;
* idempotency strategy;
* Step Functions workflow boundaries;
* workflow timeout;
* retry e compensation strategy;
* KMS strategy;
* CloudWatch alarms;
* retention dei messaggi;
* cross-account event routing, se necessario;
* gestione degli eventi falliti;
* schema evolution;
* eventuale event replay strategy.

---

# Related Documentation

* [Architecture Overview](../architecture/README.md)
* [Events Architecture](../architecture/events.md)
* [Data Architecture](../architecture/data.md)
* [Security Architecture](../architecture/security.md)
* [Compute Infrastructure](./compute.md)
* [Database Infrastructure](./database.md)
* [Storage Infrastructure](./storage.md)
* [Infrastructure Overview](./README.md)
