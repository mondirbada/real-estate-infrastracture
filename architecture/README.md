# Architettura

Questa directory contiene la documentazione dell'architettura infrastrutturale della piattaforma.

L'obiettivo è fornire una rappresentazione chiara e condivisa dei componenti che costituiscono il sistema, delle loro responsabilità e delle modalità con cui comunicano tra loro.

La documentazione è organizzata per livelli di dettaglio, partendo dalla visione generale fino ad arrivare agli aspetti specifici dell'infrastruttura.

---

## Contenuti

| Documento                       | Descrizione                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| [High Level](high-level.md)     | Vista generale dell'intera piattaforma                             |
| [Servizi AWS](aws-services.md)  | Servizi AWS utilizzati e relative responsabilità                   |
| [Networking](networking.md)     | Struttura della rete e comunicazioni tra i componenti              |
| [Data Architecture](data.md)    | Gestione, persistenza e flusso dei dati                            |
| [Event Architecture](events.md) | Architettura event-driven e comunicazione asincrona                |
| [Security](security.md)         | Autenticazione, autorizzazione e principali controlli di sicurezza |

---

## Diagrammi

I diagrammi architetturali sono raccolti nella directory [`diagrams/`](diagrams/).

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

I diagrammi saranno realizzati principalmente tramite **Mermaid**, così da poter essere versionati insieme alla documentazione e modificati tramite Pull Request.

---

## Come leggere l'architettura

La documentazione segue un approccio progressivo.

Si parte dalla vista **High Level**, che mostra i principali componenti della piattaforma e le loro relazioni.

Successivamente vengono approfonditi:

1. i servizi AWS utilizzati;
2. la struttura di rete;
3. la gestione dei dati;
4. la comunicazione tramite eventi;
5. gli aspetti di sicurezza.

Questo permette di comprendere prima il funzionamento generale del sistema e successivamente i singoli aspetti infrastrutturali.

---

## Principio di aggiornamento

La documentazione architetturale deve rimanere coerente con l'architettura effettivamente adottata.

Quando una modifica infrastrutturale cambia in modo significativo:

* un componente;
* una relazione tra componenti;
* un flusso di dati;
* un flusso di eventi;
* un confine di sicurezza;
* una scelta architetturale;

devono essere aggiornati anche i documenti e i diagrammi interessati.

Per decisioni architetturali significative è inoltre previsto l'utilizzo degli **Architecture Decision Records (ADR)** presenti nella directory [`decisions/`](../decisions/).
