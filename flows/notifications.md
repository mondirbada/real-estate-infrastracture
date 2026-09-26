# Notifications Flow

## Overview

Il **Notifications Flow** descrive il processo utilizzato per generare e inviare notifiche applicative, con particolare riferimento alle notifiche email.

L'architettura separa:

* generazione dell'evento applicativo;
* routing dell'evento;
* orchestrazione del workflow;
* preparazione del contenuto;
* invio della comunicazione;
* gestione dei retry;
* osservabilità e audit.

L'invio delle notifiche non deve essere parte della transazione HTTP principale quando non è necessario.

Il sistema deve quindi utilizzare un modello asincrono basato su **Amazon EventBridge**, **AWS Step Functions**, **AWS Lambda** e **Amazon SES**.

---

## Goals

Il flow deve garantire:

* separazione tra business operation e notification delivery;
* elaborazione asincrona;
* retry automatici;
* gestione degli errori;
* idempotenza;
* tracciabilità;
* isolamento dei failure;
* Least Privilege;
* possibilità di aggiungere nuovi canali in futuro.

Il primo canale previsto è l'email tramite Amazon SES.

---

## Trigger

Una notifica può essere generata in seguito a un evento applicativo.

Esempi:

* PropertyCreated;
* PropertyPublished;
* PropertyUpdated;
* PropertyDeleted;
* UserCreated;
* CRM event;
* Media processing completed;
* workflow completion;
* business event specifico.

Il trigger non deve necessariamente essere una richiesta HTTP diretta.

Esempio:

```text id="4xv9qn"
Business Operation
       │
       ▼
Domain Event
       │
       ▼
EventBridge
       │
       ▼
Notification Workflow
```

---

## Components

I principali componenti coinvolti sono:

* User;
* Next.js;
* API Gateway;
* Lambda;
* Amazon EventBridge;
* AWS Step Functions;
* Lambda Notification Worker;
* Amazon SES;
* Amazon Aurora PostgreSQL;
* Amazon SQS, quando necessario;
* Amazon Cognito;
* CloudWatch;
* X-Ray;
* CloudTrail.

Non tutti i componenti devono essere coinvolti in ogni tipo di notifica.

---

## High-Level Flow

Il modello principale è:

```text id="q8z0xx"
Application
    │
    ▼
Domain Event
    │
    ▼
EventBridge
    │
    ▼
Event Rule
    │
    ▼
Step Functions
    │
    ▼
Lambda
    │
    ├── Load data
    ├── Build notification
    └── Send email
            │
            ▼
          SES
            │
            ▼
          User
```

Per workload che richiedono buffering indipendente, Amazon SQS può essere inserito tra EventBridge e il consumer.

---

## Notification Types

Le notifiche possono essere classificate in base alla loro natura.

### Transactional Notifications

Notifiche legate direttamente a un'operazione applicativa.

Esempi:

* conferma creazione account;
* conferma operazione;
* aggiornamento di una proprietà;
* completamento di un workflow.

### Business Notifications

Notifiche generate da eventi di business.

Esempi:

* nuova proprietà pubblicata;
* nuova richiesta CRM;
* modifica di una proprietà;
* evento rilevante per un agente immobiliare.

### Operational Notifications

Notifiche relative allo stato operativo della piattaforma.

Queste notifiche possono essere gestite separatamente dal normale notification flow applicativo e devono evitare di utilizzare lo stesso canale delle notifiche destinate agli utenti finali.

---

## Event Generation

L'evento viene generato dall'application layer.

Esempio:

```json id="0y9m3x"
{
  "eventType": "PropertyPublished",
  "eventId": "uuid",
  "occurredAt": "timestamp",
  "source": "property-service",
  "version": 1,
  "data": {
    "propertyId": "uuid"
  }
}
```

L'evento deve contenere le informazioni necessarie per identificare il contesto senza includere dati sensibili non necessari.

Quando possibile, il consumer può recuperare i dati aggiornati da Aurora PostgreSQL tramite il relativo application service.

---

## EventBridge Routing

Amazon EventBridge riceve l'evento e applica le regole di routing.

Esempio:

```text id="8o2p8x"
PropertyPublished
       │
       ▼
EventBridge
       │
       ├──► Search Indexing
       │
       ├──► Analytics
       │
       └──► Notification Workflow
```

La notification rule deve essere specifica rispetto agli eventi che devono produrre una comunicazione.

Questo evita che ogni evento applicativo generi automaticamente una notifica.

---

## Step Functions Workflow

AWS Step Functions viene utilizzato quando la notifica richiede più passaggi o decisioni.

Un workflow concettuale può essere:

```text id="0v4qu5"
Start
  │
  ▼
Load Notification Data
  │
  ▼
Check Recipient
  │
  ▼
Build Notification
  │
  ▼
Send Email
  │
  ▼
Record Result
  │
  ▼
Success
```

In caso di errore:

```text id="knb1xg"
Send Email
    │
    ▼
  Error
    │
    ▼
 Retry
    │
    ├──► Success
    │
    └──► Failure
             │
             ▼
        Error Handling
```

Step Functions consente di rappresentare esplicitamente lo stato del workflow.

---

## Simple Notifications

Non tutte le notifiche richiedono necessariamente Step Functions.

Per notifiche semplici può essere sufficiente:

```text id="w4x6tc"
EventBridge
    │
    ▼
Lambda
    │
    ▼
SES
```

La scelta dipende dalla complessità del workflow.

Step Functions deve essere introdotto quando porta un beneficio concreto in termini di orchestrazione, retry, branching o gestione dello stato.

---

## Recipient Resolution

Il destinatario può essere determinato in base all'evento e ai dati applicativi.

Esempio:

```text id="spq8ai"
PropertyPublished
      │
      ▼
Property / Owner / Agent
      │
      ▼
Recipient Resolution
      │
      ▼
Email Address
```

Il sistema deve verificare che il destinatario sia valido e autorizzato a ricevere la specifica comunicazione.

Quando necessario, possono essere considerate preferenze di comunicazione memorizzate nel dominio applicativo.

---

## Notification Preferences

Gli utenti possono avere preferenze relative alle comunicazioni.

Esempi:

```text id="0e5wqo"
emailNotificationsEnabled
propertyNotificationsEnabled
crmNotificationsEnabled
```

Il workflow deve poter verificare queste preferenze prima dell'invio.

Una possibile sequenza è:

```text id="l1q9tx"
Event
 │
 ▼
Resolve Recipient
 │
 ▼
Check Preferences
 │
 ├── Disabled ──► Skip
 │
 └── Enabled
        │
        ▼
    Send Email
```

Le regole effettive devono essere definite a livello applicativo.

---

## Email Composition

La composizione dell'email deve essere separata dalla logica di business.

Il Worker può:

1. recuperare i dati necessari;
2. determinare il template;
3. costruire il payload;
4. inviare la richiesta ad Amazon SES.

Esempio concettuale:

```text id="1uqvag"
Event
 │
 ▼
Notification Worker
 │
 ├── Template
 ├── Recipient
 ├── Subject
 └── Variables
 │
 ▼
Amazon SES
```

I template non dovrebbero essere hard-coded direttamente nella logica di gestione degli eventi quando il numero di notifiche cresce.

---

## Amazon SES

Amazon SES è il servizio utilizzato per l'invio delle email.

L'application layer non deve gestire direttamente la connessione SMTP quando l'utilizzo delle API di Amazon SES è sufficiente.

Il modello preferito è:

```text id="25ff6m"
Lambda
  │
  ▼
Amazon SES
  │
  ▼
Email Provider Infrastructure
  │
  ▼
Recipient
```

La configurazione di:

* verified identities;
* domains;
* DKIM;
* SPF;
* DMARC;
* sandbox/production access;
* sending limits

deve essere gestita separatamente dall'application flow.

---

## Retry Strategy

Gli errori temporanei devono poter essere ritentati.

Esempio:

```text id="o9u4q8"
Send Email
   │
   ▼
Temporary Error
   │
   ▼
Wait
   │
   ▼
Retry
```

Il retry deve utilizzare un backoff appropriato.

Il numero massimo di tentativi deve essere limitato.

Dopo il superamento della soglia, il workflow deve terminare in uno stato di errore gestibile.

---

## Amazon SQS

Amazon SQS può essere utilizzato quando è necessario separare ulteriormente la produzione degli eventi dalla loro elaborazione.

Esempio:

```text id="x8f3hl"
EventBridge
    │
    ▼
SQS
    │
    ▼
Lambda Worker
    │
    ▼
SES
```

SQS è particolarmente utile quando:

* il volume delle notifiche può aumentare;
* è necessario buffering;
* si vuole isolare il producer dal consumer;
* sono richiesti retry indipendenti;
* è necessaria una DLQ.

---

## Dead Letter Queue

I messaggi che non possono essere elaborati correttamente dopo i retry devono poter essere isolati.

```text id="dyqg7k"
SQS
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

La DLQ permette di:

* analizzare gli errori;
* evitare retry infiniti;
* effettuare reprocessing;
* mantenere isolato il failure.

---

## Idempotency

La gestione delle notifiche deve essere idempotente.

Un evento duplicato non dovrebbe causare automaticamente l'invio multiplo della stessa comunicazione.

Esempio:

```text id="d9u2g1"
Event ID
   │
   ▼
Idempotency Check
   │
   ├── Already processed ──► Skip
   │
   └── New event
           │
           ▼
        Send Email
```

La strategia può utilizzare:

* event ID;
* notification ID;
* application-level idempotency record;
* stato del workflow.

La strategia definitiva dipende dai requisiti di delivery.

---

## Delivery Semantics

Il sistema deve considerare che la consegna di un evento e la consegna di una email sono operazioni differenti.

Non deve essere assunto che:

```text id="0k7z5x"
Event processed = Email received
```

Il sistema può determinare che la richiesta di invio è stata accettata da Amazon SES senza poter garantire immediatamente la ricezione finale da parte dell'utente.

Eventuali eventi di delivery, bounce o complaint possono essere gestiti separatamente tramite Amazon SES e i relativi meccanismi di event publishing.

---

## Notification Status

Per notifiche che richiedono audit o tracciamento applicativo può essere utile mantenere uno stato.

Esempio:

```text id="yd4p7u"
PENDING
   │
   ▼
PROCESSING
   │
   ▼
SENT
```

In caso di errore:

```text id="h2q4bn"
PROCESSING
   │
   ▼
FAILED
```

Lo stato deve rappresentare ciò che il sistema conosce realmente.

`SENT`, ad esempio, non dovrebbe essere interpretato automaticamente come conferma della ricezione da parte dell'utente.

---

## Error Handling

### Invalid Recipient

Se il destinatario non è valido:

```text id="8n2m9e"
Resolve Recipient
      │
      ▼
Invalid
      │
      ▼
Do Not Send
```

Il sistema deve registrare l'errore senza generare retry inutili.

### Temporary SES Failure

Un errore temporaneo può essere ritentato:

```text id="4x7lq3"
SES Error
   │
   ▼
Retry
```

### Permanent Failure

Un errore permanente deve terminare il workflow e, quando necessario, essere registrato per analisi successive.

---

## Security

Il notification flow deve rispettare **Least Privilege**.

Lambda deve avere esclusivamente i permessi necessari per:

* leggere i dati richiesti;
* eseguire il workflow;
* invocare Amazon SES;
* accedere alle risorse strettamente necessarie.

L'accesso ai dati applicativi deve essere controllato tramite IAM e authorization applicativa.

---

## Sensitive Data

Le notifiche possono contenere dati personali o informazioni relative alle proprietà.

Il sistema deve evitare di inserire nei log:

* email complete quando non necessarie;
* token;
* credenziali;
* contenuti sensibili;
* dati personali non necessari;
* payload completi delle comunicazioni.

I log devono contenere principalmente informazioni utili alla diagnostica.

---

## Secrets

Le credenziali e i secret non devono essere hard-coded.

Quando un componente necessita di secret applicativi, questi devono essere gestiti tramite AWS Secrets Manager.

Per Amazon SES tramite API AWS, l'obiettivo deve essere utilizzare IAM authorization invece di credenziali statiche.

---

## Observability

Il flow deve essere osservabile end-to-end.

### CloudWatch

Devono essere monitorati almeno:

* Lambda errors;
* Lambda duration;
* Step Functions failures;
* SQS messages;
* SQS age;
* DLQ messages;
* notification processing failures;
* eventuali metriche Amazon SES rilevanti.

### X-Ray

X-Ray può essere utilizzato per tracciare le chiamate tra le componenti applicative quando supportato.

### Correlation ID

Il correlation ID deve essere propagato attraverso:

```text id="n5u0lo"
Application
   │
   ▼
EventBridge
   │
   ▼
Step Functions / SQS
   │
   ▼
Lambda
   │
   ▼
SES
```

L'event ID deve permettere di risalire all'origine della notifica.

---

## Audit

Per operazioni che richiedono tracciabilità, il sistema deve poter determinare:

* quale evento ha generato la notifica;
* quale workflow è stato eseguito;
* quale destinatario è stato selezionato;
* quando è stato effettuato il tentativo;
* quale risultato è stato ottenuto;
* eventuali retry;
* eventuali failure.

AWS CloudTrail rimane dedicato all'audit delle operazioni AWS, mentre i log applicativi e gli eventuali record di notification status descrivono il comportamento applicativo.

---

## Performance

L'invio delle notifiche deve essere disaccoppiato dalla richiesta HTTP quando possibile.

Esempio:

```text id="u6kz2w"
HTTP Request
    │
    ▼
Business Transaction
    │
    ▼
Response
    │
    ▼
Event
    │
    ▼
Notification
```

L'utente non deve necessariamente attendere la conclusione dell'invio email per ricevere la risposta relativa all'operazione principale.

Questo migliora la latenza percepita e riduce l'accoppiamento tra business operation e notification delivery.

---

## Failure Isolation

Il fallimento del sistema di notifiche non deve compromettere automaticamente la transazione di business che ha generato l'evento.

Esempio:

```text id="w2b8o6"
Property Published
       │
       ├────────► Transaction succeeds
       │
       └────────► Notification processing fails
```

La proprietà può quindi rimanere pubblicata mentre la notifica viene:

* ritentata;
* messa in DLQ;
* analizzata;
* eventualmente riprocessata.

---

## Complete Sequence

```text id="5wq8vp"
User
 │
 ▼
Next.js
 │
 ▼
API Gateway
 │
 ▼
Lambda
 │
 ▼
Aurora PostgreSQL
 │
 ▼
Domain Event
 │
 ▼
EventBridge
 │
 ▼
Notification Rule
 │
 ▼
Step Functions
 │
 ├── Resolve Recipient
 ├── Check Preferences
 ├── Build Notification
 │
 ▼
Lambda
 │
 ▼
Amazon SES
 │
 ▼
Recipient
```

Con buffering tramite Amazon SQS:

```text id="1l4xg0"
EventBridge
    │
    ▼
SQS
    │
    ▼
Lambda Worker
    │
    ▼
Step Functions
    │
    ▼
Amazon SES
```

---

## Failure Scenarios

### EventBridge Failure

L'evento non viene correttamente instradato.

Il sistema deve prevedere monitoring e meccanismi di recovery coerenti con la configurazione adottata.

### SQS Failure

Il messaggio non viene consumato correttamente.

La queue gestisce retry e, dopo il numero massimo di tentativi configurato, DLQ.

### Lambda Failure

L'invocazione fallisce.

Il meccanismo di retry deve essere configurato in funzione del consumer utilizzato.

### Step Functions Failure

Il workflow entra in uno stato di errore.

Devono essere configurati retry e catch appropriati.

### SES Failure

La richiesta di invio fallisce.

Gli errori temporanei devono poter essere ritentati, mentre quelli permanenti devono essere gestiti senza retry infinito.

---

## Future Channels

L'architettura deve permettere l'aggiunta di ulteriori canali senza modificare necessariamente la business transaction.

Possibili evoluzioni:

* push notifications;
* SMS;
* in-app notifications;
* webhook;
* notification center;
* digest email.

Un modello possibile è:

```text id="n4wq8e"
Domain Event
     │
     ▼
EventBridge
     │
     ├──► Email
     ├──► Push
     ├──► SMS
     └──► In-App
```

Ogni consumer può avere il proprio processing e le proprie policy di retry.

---

## Future Enhancements

Possibili evoluzioni:

* notification templates centralizzati;
* notification preferences avanzate;
* retry policies per tipologia;
* notification history;
* delivery tracking;
* bounce handling;
* complaint handling;
* rate limiting;
* digest notifications;
* multi-channel delivery;
* template versioning;
* AWS Step Functions per workflow complessi;
* Amazon SQS per workload ad alto volume;
* Transactional Outbox per maggiore affidabilità tra transazione e pubblicazione degli eventi.

---

## Open Decisions

Restano da definire:

* quali eventi generano notifiche;
* quali notifiche sono transactional;
* quali notifiche sono business;
* struttura definitiva degli eventi;
* utilizzo di Amazon SQS;
* utilizzo di AWS Step Functions;
* retry policy;
* DLQ strategy;
* idempotency strategy;
* notification status model;
* template storage;
* template versioning;
* notification preferences;
* email delivery tracking;
* bounce handling;
* complaint handling;
* retention dei dati di audit;
* rate limits;
* eventuali canali aggiuntivi;
* strategia di Transactional Outbox.

---

## Related Documentation

* [Architecture Overview](../architecture/high-level.md)
* [AWS Services](../architecture/aws-services.md)
* [Event-Driven Architecture](../architecture/events.md)
* [Security Architecture](../architecture/security.md)
* [Messaging Infrastructure](../infrastructure/messaging.md)
* [Compute Infrastructure](../infrastructure/compute.md)
* [Security Infrastructure](../infrastructure/security.md)
* [Observability Infrastructure](../infrastructure/observability.md)
* [Property Creation Flow](./property-creation.md)
* [Property Search Flow](./property-search.md)
* [Media Upload Flow](./media-upload.md)

---

## Implementation Status

**Status:** Documentation only.

Questo documento descrive il comportamento architetturale previsto per il notification system.

L'implementazione effettiva tramite Amazon EventBridge, Amazon SQS, AWS Step Functions, AWS Lambda e Amazon SES verrà definita in una fase successiva.

---
