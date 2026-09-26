# Storage Infrastructure

## Overview

Lo storage applicativo è basato principalmente su **Amazon S3**, utilizzato per la gestione di contenuti binari e file che non devono essere memorizzati direttamente nel database relazionale.

Amazon S3 viene utilizzato per:

* immagini degli immobili;
* documenti;
* allegati;
* file generati dall'applicazione;
* eventuali asset applicativi che richiedano object storage;
* contenuti temporanei associati a workflow asincroni.

La separazione tra dati strutturati e file permette di mantenere **Amazon Aurora PostgreSQL** focalizzato sui dati transazionali e **Amazon S3** sullo storage degli oggetti.

Il principio generale è:

```text
Application
    │
    ├── Structured Data ──► RDS Proxy ──► Aurora PostgreSQL
    │
    └── Binary Content ──► Amazon S3
```

Il database conserva quindi principalmente i **metadata** degli oggetti, mentre il contenuto binario viene mantenuto in S3.

---

## Amazon S3

Amazon S3 costituisce il principale object storage dell'infrastruttura.

Le responsabilità principali sono:

* storage di immagini e documenti;
* gestione degli oggetti tramite bucket e key;
* controllo degli accessi;
* encryption;
* versioning;
* lifecycle management;
* integrazione con EventBridge;
* supporto a upload e download tramite presigned URLs.

S3 deve essere considerato uno storage persistente e scalabile per contenuti non relazionali.

---

## Bucket Strategy

La configurazione dei bucket dovrà essere definita per environment e responsabilità applicativa.

Un possibile modello è:

```text
Development
    ├── application-media
    ├── application-documents
    └── application-generated

Staging
    ├── application-media
    ├── application-documents
    └── application-generated

Production
    ├── application-media
    ├── application-documents
    └── application-generated
```

Il naming definitivo verrà stabilito durante l'implementazione Terraform.

La separazione può essere effettuata:

* tramite bucket distinti;
* tramite prefix all'interno dello stesso bucket;
* oppure tramite una combinazione dei due approcci.

La scelta dipenderà dai requisiti di isolamento, lifecycle, retention e security.

Per dati con requisiti di sicurezza o retention differenti è preferibile evitare una struttura eccessivamente condivisa.

---

## Object Key Strategy

Gli oggetti dovranno utilizzare una struttura di key prevedibile e stabile.

Un esempio concettuale:

```text
properties/{propertyId}/images/{objectId}
properties/{propertyId}/documents/{objectId}
users/{userId}/documents/{objectId}
generated/{resourceType}/{resourceId}/{objectId}
```

La key non deve essere utilizzata come sostituto del database relazionale.

Il database mantiene i metadata necessari, ad esempio:

```text
objectId
propertyId
bucket
objectKey
contentType
size
createdAt
updatedAt
status
```

Questo permette di modificare la struttura applicativa senza rendere S3 la fonte primaria dei metadata di dominio.

---

## Access Model

L'accesso ai bucket deve seguire il principio di **Least Privilege**.

L'applicazione non dovrebbe utilizzare credenziali AWS statiche per accedere a S3.

L'accesso deve essere effettuato tramite:

* IAM Roles;
* Lambda execution roles;
* eventuali IAM policies dedicate;
* presigned URLs per accesso temporaneo da parte del client.

I bucket devono avere **Block Public Access** abilitato.

Non è previsto l'accesso pubblico diretto agli oggetti.

---

## Presigned URLs

Per upload e download direttamente dal frontend può essere utilizzato il meccanismo delle **presigned URLs**.

Il flusso concettuale per un upload è:

```text
Frontend
   │
   │ Request upload
   ▼
API Gateway
   │
   ▼
Lambda
   │
   │ Generate presigned URL
   ▼
Frontend
   │
   │ PUT object
   ▼
Amazon S3
```

Il backend mantiene il controllo sull'autorizzazione prima di generare la URL.

La presigned URL:

* ha una validità temporale limitata;
* permette l'accesso solo all'operazione prevista;
* non rende pubblico il bucket;
* può essere associata a uno specifico object key.

Per il download può essere utilizzato un flusso analogo.

L'applicazione deve verificare che l'utente abbia effettivamente diritto di accedere alla risorsa prima di generare la URL.

---

## Browser Uploads and CORS

Quando il browser comunica direttamente con S3 tramite presigned URLs, può essere necessaria una configurazione **CORS** sul bucket.

La configurazione dovrà essere limitata agli origin effettivamente utilizzati dall'applicazione.

Esempio concettuale:

```text
Frontend Origin
      │
      │ HTTPS
      ▼
Amazon S3
      │
      └── CORS rules
```

Gli origin consentiti dovranno essere differenti per environment quando necessario.

La configurazione definitiva verrà gestita tramite Terraform.

---

## Encryption

Gli oggetti S3 devono essere encrypted at rest.

La configurazione dovrà utilizzare una delle strategie supportate da AWS:

* **SSE-S3**;
* **SSE-KMS**.

La scelta tra SSE-S3 e SSE-KMS è un'open decision legata ai requisiti di compliance, audit e controllo delle encryption keys.

Quando verrà utilizzato **AWS KMS**, dovranno essere definiti:

* KMS Key;
* key policy;
* IAM permissions;
* accesso delle Lambda Roles;
* eventuali requisiti di key rotation.

L'encryption in transit deve essere garantita tramite HTTPS/TLS.

---

## Versioning

Il **S3 Versioning** dovrà essere valutato per i bucket che contengono dati per i quali è importante poter recuperare versioni precedenti degli oggetti.

Il versioning può essere utile per:

* protezione da overwrite accidentali;
* recupero da cancellazioni accidentali;
* gestione di documenti versionati;
* supporto a strategie di recovery.

Il versioning non deve però essere considerato automaticamente una strategia completa di backup.

La retention delle versioni precedenti dovrà essere definita tramite Lifecycle Rules.

---

## Lifecycle Management

I bucket dovranno utilizzare **S3 Lifecycle Rules** quando appropriato.

Possibili policy:

```text
Object Created
      │
      ├── Active
      │
      ├── Transition
      │
      ├── Expiration
      │
      └── Delete
```

Le regole possono essere utilizzate per:

* eliminare file temporanei;
* eliminare multipart uploads incompleti;
* gestire versioni precedenti;
* effettuare transition verso storage class differenti;
* applicare retention sui contenuti temporanei.

Le policy devono essere definite in base alla natura del dato e non applicate indiscriminatamente a tutti i bucket.

---

## Object Ownership

La configurazione dei bucket dovrà utilizzare **Bucket owner enforced** quando compatibile con i pattern di accesso previsti.

L'obiettivo è mantenere una gestione centralizzata della ownership degli oggetti e ridurre la complessità derivante da ACL legacy.

Le autorizzazioni devono essere gestite principalmente tramite IAM policies e bucket policies.

---

## Event Integration

Amazon S3 può integrarsi con **Amazon EventBridge** per notificare eventi relativi agli oggetti.

Un esempio è:

```text
Amazon S3
    │
    │ Object Created
    ▼
Amazon EventBridge
    │
    ├── SQS
    ├── Lambda
    └── Step Functions
```

Questo meccanismo può essere utilizzato per workflow come:

* elaborazione immagini;
* indicizzazione metadata;
* generazione di thumbnail;
* document processing;
* aggiornamento di sistemi downstream;
* avvio di workflow asincroni.

Gli eventi S3 non devono essere utilizzati come sostituto dello stato transazionale mantenuto da Aurora PostgreSQL.

---

## Media Processing

Per le immagini degli immobili può essere introdotto un workflow asincrono.

Esempio:

```text
Frontend
    │
    ▼
Presigned URL
    │
    ▼
Amazon S3
    │
    │ Object Created
    ▼
Amazon EventBridge
    │
    ▼
Amazon SQS
    │
    ▼
Lambda Worker
    │
    ├── Image Processing
    ├── Metadata Extraction
    └── Search / Domain Updates
```

L'implementazione effettiva dei worker verrà definita nella documentazione relativa a compute e messaging.

---

## Storage and Database Responsibilities

La separazione delle responsabilità è:

| Resource          | Responsibility                |
| ----------------- | ----------------------------- |
| Aurora PostgreSQL | Structured transactional data |
| Amazon S3         | Binary objects                |
| OpenSearch        | Search indexes                |
| EventBridge       | Event routing                 |
| SQS               | Asynchronous buffering        |

Per un'immagine associata a un immobile, ad esempio:

```text
Aurora PostgreSQL
    │
    └── property_media
          ├── propertyId
          ├── objectKey
          ├── contentType
          ├── size
          └── metadata

Amazon S3
    │
    └── properties/{propertyId}/images/{objectId}
          └── Binary Content
```

Aurora rimane quindi la fonte primaria per le informazioni di dominio.

---

## Security

La security dello storage deve seguire il modello **Defense in Depth**.

Controlli principali:

* Block Public Access;
* IAM Least Privilege;
* Bucket Policies restrittive;
* encryption at rest;
* TLS in transit;
* presigned URLs con TTL limitato;
* separazione degli environment;
* audit tramite CloudTrail;
* logging e monitoring tramite CloudWatch quando necessario;
* eventuale VPC Endpoint per accesso privato da risorse VPC.

Non devono essere utilizzate ACL pubbliche per rendere disponibili gli oggetti.

---

## VPC Integration

Amazon S3 è un managed service e non viene deployato all'interno della VPC.

Le risorse presenti nella VPC possono tuttavia accedere a S3 tramite:

* NAT Gateway;
* **Amazon S3 VPC Endpoint**, quando appropriato.

Un VPC Endpoint può permettere alle risorse private di raggiungere S3 senza utilizzare un percorso Internet pubblico.

La scelta definitiva verrà definita nella configurazione Networking.

---

## Backup and Recovery

S3 offre un'elevata durabilità, ma la strategia di recovery deve essere definita in funzione del tipo di dato.

Possibili meccanismi:

* S3 Versioning;
* Lifecycle Rules;
* backup o copia degli oggetti;
* S3 Replication;
* eventuali strategie cross-region;
* retention specifica per documenti critici.

La strategia definitiva dipenderà dai requisiti di:

* RPO;
* RTO;
* retention;
* compliance;
* disaster recovery;
* costi.

Il backup di S3 deve essere considerato separatamente dal backup di Aurora PostgreSQL.

---

## Monitoring

Lo storage deve essere osservabile tramite gli strumenti AWS appropriati.

Possibili controlli:

* metriche S3;
* CloudWatch;
* CloudTrail;
* access logging dove necessario;
* monitoring degli errori di accesso;
* monitoring dei workflow che consumano gli eventi S3.

Per evitare costi eccessivi, il logging dettagliato deve essere abilitato in funzione dei requisiti di audit.

---

## Cost Management

I principali elementi da considerare per il controllo dei costi sono:

* quantità di dati memorizzati;
* numero di richieste;
* data transfer;
* storage class;
* versioning;
* retention;
* lifecycle policies;
* incomplete multipart uploads;
* eventuale replication.

Particolare attenzione deve essere prestata alle versioni precedenti degli oggetti, che possono continuare a generare costi anche dopo la sostituzione dell'oggetto corrente.

---

## Environment Isolation

Ogni environment deve avere storage logicamente separato.

Esempio:

```text
dev
 │
 └── S3 resources for development

staging
 │
 └── S3 resources for staging

prod
 │
 └── S3 resources for production
```

Un environment non deve avere accesso diretto alle risorse S3 di un altro environment.

La separazione può essere ulteriormente rafforzata tramite AWS Accounts distinti.

---

## Terraform Dependencies

Durante l'implementazione Terraform, la configurazione S3 dipenderà principalmente da:

```text
Security
   │
   ├── IAM
   └── KMS
        │
        ▼
Storage
   │
   ├── S3 Buckets
   ├── Bucket Policies
   ├── Lifecycle Rules
   ├── CORS
   └── EventBridge Integration
```

Le risorse dovranno essere organizzate in modo modulare.

Un possibile modulo futuro:

```text
terraform/modules/storage/
```

Il modulo potrà gestire:

* bucket;
* versioning;
* encryption;
* lifecycle;
* public access blocking;
* bucket policies;
* CORS;
* EventBridge integration;
* tagging.

---

## Naming and Tagging

Le risorse dovranno seguire una naming convention coerente con gli altri componenti AWS.

I tag comuni potranno includere:

```text
Environment
Project
ManagedBy
Component
Owner
```

I valori definitivi saranno centralizzati nella configurazione Terraform.

---

## Open Decisions

Prima dell'implementazione Terraform dovranno essere definite:

* numero e responsabilità dei bucket;
* naming convention;
* bucket per environment vs shared bucket;
* SSE-S3 vs SSE-KMS;
* KMS Key strategy;
* S3 Versioning;
* Lifecycle Rules;
* storage classes;
* CORS policy;
* presigned URL TTL;
* S3 → EventBridge integration;
* VPC Endpoint strategy;
* retention;
* backup e disaster recovery;
* eventuale cross-region replication;
* logging requirements;
* gestione degli oggetti temporanei;
* gestione degli incomplete multipart uploads.

---

## Related Documentation

* [Architecture Overview](../architecture/README.md)
* [Data Architecture](../architecture/data.md)
* [Events Architecture](../architecture/events.md)
* [Security Architecture](../architecture/security.md)
* [Networking Architecture](../architecture/networking.md)
* [Infrastructure Overview](./README.md)
* [Compute Infrastructure](./compute.md)
* [Database Infrastructure](./database.md)
