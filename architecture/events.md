# Event-Driven Architecture

## Overview

La piattaforma utilizza un'architettura **Event-Driven** per disaccoppiare i componenti applicativi e gestire in modo asincrono le operazioni che non richiedono una risposta immediata al client.

L'obiettivo è separare:

* produzione degli eventi;
* routing degli eventi;
* elaborazione asincrona;
* orchestrazione dei workflow;
* gestione degli errori;
* retry e recovery.

Amazon EventBridge costituisce il principale event routing layer della piattaforma.

Amazon SQS viene utilizzato per creare code affidabili tra producer e consumer.

AWS Step Functions viene utilizzato per orchestrare workflow composti da più passaggi.

## Architecture Diagram

![Event-Driven Architecture](./diagrams/events.jpeg)

## Event-Driven Model

Il modello generale è:

```text
Producer
   │
   ▼
EventBridge
   │
   ├───────────────┐
   │               │
   ▼               ▼
 SQS          Step Functions
   │               │
   ▼               ▼
Lambda          Workflow
Worker             │
   │               ├── Lambda
   │               └── SES
   │
   ▼
Application Services
```

Il sistema distingue quindi tra **event routing**, **message processing** e **workflow orchestration**.

## Event Producers

Gli eventi possono essere prodotti da diversi componenti della piattaforma.

I principali producer sono:

* AWS Lambda;
* application services;
* processi asincroni;
* Amazon S3;
* altri servizi AWS compatibili con EventBridge.

Gli eventi applicativi devono rappresentare cambiamenti o fatti significativi del dominio.

Esempi:

* `UserCreated`;
* `PropertyCreated`;
* `PropertyUpdated`;
* `PropertyPublished`;
* `PropertyDeleted`;
* `MediaUploaded`.

## Domain Events

Gli eventi applicativi devono essere definiti in modo esplicito e avere un significato indipendente dal consumer.

Un evento dovrebbe descrivere **qualcosa che è accaduto**, anziché rappresentare un comando.

Esempio:

```text
PropertyCreated
```

è un evento.

```text
CreateProperty
```

rappresenta invece un comando e non deve essere trattato come un domain event.

## Event Structure

Gli eventi dovrebbero utilizzare una struttura consistente.

Un esempio concettuale è:

```json
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

La struttura definitiva degli eventi verrà definita durante l'implementazione.

Gli eventi dovrebbero contenere esclusivamente i dati necessari ai consumer e non dovrebbero includere informazioni sensibili quando non necessarie.

## Amazon EventBridge

Amazon EventBridge costituisce il punto centrale di routing degli eventi applicativi.

Il suo ruolo principale è:

* ricevere eventi;
* applicare event rules;
* filtrare gli eventi;
* inoltrare gli eventi verso i target appropriati;
* disaccoppiare producer e consumer.

Concettualmente:

```text
                    ┌── SQS
                    │
Producer ──► EventBridge ──► Step Functions
                    │
                    └── Lambda / other targets
```

I producer non devono conoscere direttamente tutti i consumer degli eventi.

Questo permette di aggiungere nuovi consumer senza modificare necessariamente il producer.

## Event Rules

Le EventBridge Rules determinano quali eventi devono essere inoltrati a determinati target.

Esempio:

```text
PropertyCreated
      │
      ▼
EventBridge Rule
      │
      ▼
SQS
```

Un'altra regola potrebbe essere:

```text
PropertyPublished
      │
      ▼
EventBridge Rule
      │
      ▼
Step Functions
```

Le regole devono essere specifiche e mantenere una responsabilità chiara.

## Amazon SQS

Amazon SQS viene utilizzato per le elaborazioni asincrone che richiedono:

* buffering;
* retry;
* disaccoppiamento;
* controllo della velocità di elaborazione;
* gestione dei picchi di traffico.

Un consumer Lambda può elaborare i messaggi presenti nella coda:

```text
EventBridge
     │
     ▼
    SQS
     │
     ▼
Lambda Worker
```

Il producer non deve attendere il completamento dell'elaborazione del consumer.

## Queue Isolation

Quando necessario, ogni tipologia di workload può avere una coda dedicata.

Esempi:

```text
Property Events
      │
      ▼
Property Index Queue
      │
      ▼
OpenSearch Worker
```

```text
Notification Events
      │
      ▼
Notification Queue
      │
      ▼
Notification Worker
```

Questo permette di isolare workload differenti e di gestire separatamente scaling, retry e failure handling.

## Dead-Letter Queues

Le code SQS dovrebbero utilizzare una **Dead-Letter Queue (DLQ)** per i messaggi che non possono essere elaborati correttamente dopo un numero configurato di tentativi.

Il flusso è:

```text
EventBridge
    │
    ▼
Main Queue
    │
    ▼
Lambda Worker
    │
    ├── success ──► processed
    │
    └── failure
          │
          ▼
        retry
          │
          ▼
         DLQ
```

La DLQ consente di isolare i messaggi problematici senza bloccare indefinitamente la coda principale.

I messaggi presenti nella DLQ devono essere monitorati e analizzati.

## Retry Strategy

I retry devono essere utilizzati per gestire errori temporanei.

Esempi:

* temporary network failures;
* service throttling;
* transient database errors;
* temporary dependency failures.

Gli errori permanenti non devono invece generare retry infiniti.

La strategia definitiva dovrà definire:

* numero massimo di retry;
* visibility timeout;
* backoff;
* DLQ;
* alerting;
* modalità di replay.

## Idempotency

I consumer devono essere progettati tenendo conto della possibilità che uno stesso evento venga elaborato più di una volta.

Un consumer dovrebbe quindi essere **idempotent** quando possibile.

Esempio:

```text
PropertyUpdated
      │
      ▼
Search Worker
      │
      ▼
OpenSearch
```

Se lo stesso evento viene ricevuto nuovamente, il worker deve evitare di produrre uno stato incorretto o duplicato.

La strategia specifica di idempotency verrà definita a livello applicativo.

## AWS Step Functions

AWS Step Functions viene utilizzato per workflow che richiedono più passaggi e una gestione esplicita dello stato.

È particolarmente adatto quando un processo comprende:

* più Lambda;
* condizioni;
* retry;
* timeout;
* branching;
* attese;
* gestione degli errori;
* stato del workflow.

Esempio:

```text
Event
 │
 ▼
Step Functions
 │
 ├── Validate
 │
 ├── Process
 │
 ├── Persist
 │
 └── Notify
```

Step Functions non sostituisce SQS.

I due servizi hanno responsabilità differenti:

* **SQS** → message queue e decoupling;
* **Step Functions** → workflow orchestration.

## Notifications

Gli eventi possono attivare processi di notifica.

Un esempio è:

```text
PropertyPublished
       │
       ▼
EventBridge
       │
       ▼
Step Functions
       │
       ▼
Lambda
       │
       ▼
Amazon SES
```

In questo modello SES viene utilizzato come servizio di delivery email, mentre la logica applicativa e l'orchestrazione rimangono nei componenti precedenti.

## Search Indexing

L'aggiornamento degli indici OpenSearch può essere gestito tramite eventi.

Esempio:

```text
PropertyUpdated
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
      ▼
OpenSearch
```

Questo permette di separare il workload transazionale dal workload di indexing.

Aurora PostgreSQL rimane la source of truth.

## Media Processing

Il caricamento di un file su Amazon S3 può generare un evento che avvia un processo asincrono.

Esempio:

```text
User
 │
 ▼
S3
 │
 ▼
MediaUploaded
 │
 ▼
EventBridge
 │
 ▼
Processing Queue
 │
 ▼
Lambda Worker
```

Il worker può eseguire operazioni come:

* validazione del file;
* aggiornamento dei metadata;
* elaborazioni successive;
* aggiornamento dello stato applicativo.

Le specifiche elaborazioni verranno definite nella fase applicativa.

## Event Ordering

Gli eventi non devono assumere implicitamente un ordine globale di elaborazione.

Quando l'ordine è rilevante per un determinato workload, dovrà essere introdotto un meccanismo esplicito per gestirlo.

Le esigenze di ordering dovranno essere valutate caso per caso.

## Event Versioning

Gli eventi devono essere versionabili.

Un campo di versione consente di evolvere gradualmente il formato degli eventi.

Esempio:

```json
{
  "eventType": "PropertyCreated",
  "version": 1
}
```

Modifiche incompatibili al contratto di un evento dovranno introdurre una nuova versione.

## Event Contracts

I consumer devono dipendere da contratti di evento espliciti.

La documentazione degli eventi dovrebbe definire almeno:

* event type;
* version;
* producer;
* payload;
* required fields;
* optional fields;
* expected consumer behavior;
* error handling.

La definizione formale dei contratti verrà introdotta durante la fase di implementazione.

## Observability

L'architettura Event-Driven deve essere osservabile end-to-end.

Devono essere monitorati almeno:

* numero di eventi pubblicati;
* numero di messaggi nelle code;
* processing latency;
* error rate;
* retry count;
* DLQ messages;
* workflow failures;
* Lambda errors;
* EventBridge delivery failures.

Amazon CloudWatch costituisce il principale sistema di monitoring.

AWS X-Ray può essere utilizzato per il tracing delle richieste e dei processi supportati.

## Failure Handling

Gli errori devono essere classificati in:

### Transient Errors

Errori temporanei che possono essere risolti tramite retry.

### Permanent Errors

Errori che richiedono intervento applicativo o dati corretti e che non devono essere ritentati indefinitamente.

### Poison Messages

Messaggi che continuano a fallire durante l'elaborazione.

Questi devono essere indirizzati verso una DLQ dopo il numero massimo di retry configurato.

## Event Security

Gli eventi devono essere protetti tramite:

* IAM permissions;
* EventBridge resource policies quando necessarie;
* SQS queue policies;
* encryption;
* least privilege;
* logging e monitoring.

I producer devono poter pubblicare solo gli eventi necessari.

I consumer devono poter leggere esclusivamente le code necessarie al proprio workload.

## Event Flow Example

Un esempio completo di aggiornamento di un immobile è:

```text
User
 │
 ▼
API Gateway
 │
 ▼
Lambda
 │
 ├── Update Property
 │        │
 │        ▼
 │     Aurora
 │
 └── Publish PropertyUpdated
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
              ▼
         OpenSearch
```

Il client riceve la risposta dell'operazione transazionale senza dover attendere il completamento dell'indicizzazione.

## Open Decisions

Le principali decisioni ancora da definire sono:

* naming convention degli eventi;
* event schema definitivo;
* event versioning strategy;
* EventBridge Event Bus strategy;
* numero e responsabilità delle SQS queues;
* DLQ strategy;
* retry policies;
* visibility timeout;
* idempotency strategy;
* ordering requirements;
* replay strategy;
* retention;
* monitoring e alerting;
* workflow Step Functions;
* eventuale schema registry;
* gestione degli eventi tra ambienti.

## Related Documentation

* [Architecture](./README.md)
* [High-Level Architecture](./high-level.md)
* [AWS Services](./aws-services.md)
* [Networking](./networking.md)
* [Data Architecture](./data.md)
* [Security Architecture](./security.md)
