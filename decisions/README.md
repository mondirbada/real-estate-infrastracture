# Architecture Decisions

## Overview

La directory `decisions/` contiene le decisioni architetturali rilevanti per il progetto.

L'obiettivo degli **Architecture Decision Records (ADR)** è documentare non solo quale soluzione è stata scelta, ma anche:

* il problema che ha richiesto una decisione;
* il contesto tecnico;
* le alternative considerate;
* i trade-off;
* la decisione adottata;
* le conseguenze della decisione;
* eventuali decisioni future che potrebbero modificarla.

Gli ADR costituiscono una memoria tecnica del progetto e permettono di comprendere perché l'architettura è stata progettata in un determinato modo.

---

# ADR Principles

Gli ADR devono essere:

* **Short** — sufficientemente sintetici da essere consultabili facilmente;
* **Contextual** — devono spiegare il problema e il contesto;
* **Explicit** — la decisione deve essere chiaramente identificabile;
* **Traceable** — devono essere versionati tramite Git;
* **Immutable in history** — una decisione precedente non dovrebbe essere riscritta cancellandone la storia;
* **Revisitable** — una decisione può essere superata da una decisione successiva.

Gli ADR non devono contenere implementazioni Terraform dettagliate.

La configurazione concreta dell'infrastruttura deve essere documentata nella directory `infrastructure/` e successivamente implementata tramite Terraform.

---

# ADR Lifecycle

Ogni decisione segue concettualmente questo lifecycle:

```text
Proposed
   │
   ▼
Accepted
   │
   ▼
Implemented
   │
   ▼
Superseded
```

Non tutte le decisioni devono necessariamente attraversare ogni stato.

Una decisione può essere:

* **Proposed** — ancora in valutazione;
* **Accepted** — approvata come direzione architetturale;
* **Implemented** — implementata nell'infrastruttura;
* **Superseded** — sostituita da una decisione successiva.

Quando una decisione viene modificata, è preferibile creare un nuovo ADR piuttosto che modificare retroattivamente la decisione originale.

---

# ADR Structure

Ogni ADR deve seguire una struttura coerente.

Template:

```markdown
# ADR NNN — Title

## Status

Proposed

## Context

Describe the problem and the relevant context.

## Decision

Describe the selected architectural decision.

## Alternatives Considered

### Alternative 1

Description and trade-offs.

### Alternative 2

Description and trade-offs.

## Consequences

### Positive

- ...

### Negative

- ...

### Operational

- ...

## Security Considerations

Describe relevant security implications.

## Cost Considerations

Describe relevant cost implications.

## Related Decisions

- ADR ...

## Related Documentation

- ...
```

La struttura può essere adattata quando una decisione richiede sezioni aggiuntive.

---

# Naming Convention

Gli ADR utilizzano una numerazione progressiva.

Formato:

```text
NNN-short-description.md
```

Esempi:

```text
001-serverless-architecture.md
002-database-platform.md
003-event-driven-communication.md
004-search-engine.md
```

Il numero deve rimanere stabile nel tempo.

Il filename deve descrivere brevemente l'argomento della decisione.

---

# Current Decisions

Gli ADR attualmente previsti sono:

| ADR                                   | Decision                | Status   |
| ------------------------------------- | ----------------------- | -------- |
| [001](001-serverless-architecture.md) | Serverless Architecture | Accepted |

Ulteriori decisioni verranno aggiunte quando emergeranno scelte architetturali significative.

---

# What Requires an ADR

Non tutte le decisioni tecniche richiedono un ADR.

Un ADR è appropriato quando una scelta:

* influenza significativamente l'architettura;
* introduce un vincolo importante;
* ha alternative tecniche significative;
* ha conseguenze operative rilevanti;
* influenza security o compliance;
* influenza costi in modo significativo;
* è difficile da modificare successivamente;
* deve essere compresa anche da chi entrerà nel progetto in futuro.

Esempi:

* scelta Serverless vs container;
* scelta del database;
* scelta del search engine;
* strategia Event-Driven;
* strategia multi-account;
* strategia di networking;
* strategia di Disaster Recovery;
* strategia di deployment;
* strategia di authentication;
* strategia di data consistency.

---

# What Does Not Require an ADR

Le decisioni di dettaglio normalmente non richiedono un ADR quando sono semplici implementazioni di una decisione già documentata.

Esempi:

* naming di una singola Lambda;
* nome di un singolo S3 object prefix;
* valore specifico di una variabile Terraform;
* configurazione di un singolo CloudWatch alarm;
* scelta di una retention specifica già definita da una policy;
* modifica di un parametro che non cambia l'architettura.

Queste informazioni devono essere documentate nei rispettivi file di infrastruttura o direttamente nel codice Terraform quando verrà introdotto.

---

# Decision History

Gli ADR devono mantenere la storia delle decisioni.

Esempio:

```text
ADR 001
Serverless Architecture
       │
       │ superseded by
       ▼
ADR 012
Hybrid Compute Architecture
```

L'ADR originale non viene cancellato.

Il nuovo ADR deve indicare chiaramente quale decisione precedente sostituisce.

Esempio:

```markdown
## Supersedes

- ADR 001 — Serverless Architecture
```

L'ADR precedente può quindi essere marcato:

```markdown
## Status

Superseded by ADR 012
```

---

# Git Workflow

Gli ADR devono essere versionati tramite Git.

Il processo previsto è:

```text
Create ADR
    │
    ▼
Review
    │
    ▼
Commit
    │
    ▼
Pull Request
    │
    ▼
Merge
```

Le decisioni architetturali significative dovrebbero essere revisionate insieme al codice o alla documentazione che le implementa.

Esempio di commit:

```text
docs: add ADR for database architecture
```

Quando un ADR modifica una decisione precedente:

```text
docs: supersede ADR 001 with new architecture decision
```

---

# Decision Criteria

Quando vengono valutate alternative architetturali, i criteri possono includere:

* functional fit;
* scalability;
* availability;
* reliability;
* security;
* operational complexity;
* developer experience;
* maintainability;
* cost;
* observability;
* AWS integration;
* disaster recovery;
* performance;
* vendor dependency.

Non tutti i criteri devono essere applicati a ogni decisione.

I criteri devono essere scelti in base al problema specifico.

---

# Relationship with Other Documentation

Gli ADR non sostituiscono la documentazione architetturale.

Le responsabilità sono separate:

```text
decisions/
    │
    │ Why?
    ▼
Architecture
    │
    │ What?
    ▼
Infrastructure
    │
    │ How?
    ▼
Terraform
```

In particolare:

* `architecture/` descrive l'architettura complessiva;
* `infrastructure/` descrive come i componenti AWS devono essere organizzati;
* `flows/` descrive i flussi applicativi;
* `decisions/` documenta le decisioni e i trade-off;
* `terraform/` implementerà successivamente l'infrastruttura.

---

# Decision Review

Le decisioni possono essere riesaminate quando cambiano:

* business requirements;
* AWS services;
* scalability requirements;
* security requirements;
* cost constraints;
* compliance requirements;
* operational model;
* availability requirements.

Il fatto che un ADR sia stato accettato non significa che debba rimanere valido per sempre.

Quando il contesto cambia, deve essere possibile rivalutare la decisione mantenendo la storia delle scelte precedenti.

---

# Implementation Status

La directory contiene attualmente la struttura ADR e la prima decisione architetturale.

Le decisioni future verranno aggiunte progressivamente quando verranno definite scelte architetturali che richiedono una registrazione formale.
