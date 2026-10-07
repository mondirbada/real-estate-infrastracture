# Domora — Documentazione del progetto

Domora è un portale immobiliare per agenzie che pubblicano annunci di vendita e affitto. Questa documentazione descrive il progetto scolastico e le motivazioni delle scelte, con l'obiettivo di costruire una base coerente per la presentazione.

**Fase attuale:** prima edizione della progettazione completata, con sedici documenti numerati, indice e registro delle decisioni. La base è pronta per preparare la presentazione; non sono presenti implementazioni applicative o risorse AWS create per Domora.

Per una lettura complessiva, partire da [Sintesi e presentazione](16-sintesi-e-presentazione.md); usare poi il percorso sotto per approfondire i singoli temi.

Il [piano della demo AWS](../demo/README.md) descrive separatamente la versione semplificata da implementare per la presentazione. Per quella versione sostituisce la precedente proposta di riprodurre integralmente staging; il progetto completo resta descritto nei documenti sotto.

## Percorso di lettura

| Documento | Scopo |
| --- | --- |
| [Prodotto e perimetro](01-prodotto-e-perimetro.md) | Che cosa offre il portale, chi lo utilizza e quali sono i suoi confini |
| [Attori e permessi](02-attori-e-permessi.md) | Account, ruoli, accessi e separazione fra agenzie |
| [Flusso di pubblicazione](03-flusso-pubblicazione.md) | Abilitazione delle agenzie, annunci, stati e gestione degli errori |
| [Contatti e visite](04-contatti-e-visite.md) | Conversazioni, assegnazione, stati e appuntamenti senza calendario |
| [Ricerca e preferiti](05-ricerca-e-preferiti.md) | Catalogo pubblico, filtri, consultazione e lista personale |
| [Modello dei dati](06-modello-dati.md) | Entità, relazioni, vincoli e separazione dei dati autorevoli dalle copie |
| [Carico e requisiti di qualità](07-carico-e-requisiti-qualita.md) | Ipotesi quantitative, prestazioni, disponibilità, recupero e piano di verifica |
| [Accesso, frontend e API](08-accesso-frontend-e-api.md) | Hosting Next.js, identità, ingressi protetti, compute e alternative |
| [Persistenza e ricerca](09-persistenza-e-ricerca.md) | Aurora, connessioni, transazioni, ricerca PostgreSQL e recupero |
| [Media, worker e notifiche](10-media-worker-e-notifiche.md) | Upload, controlli, distribuzione, code, email e recupero del lavoro |
| [Regione e rete](11-regione-e-rete.md) | Francoforte, zone, subnet, percorsi privati, uscita e DNS |
| [Sicurezza e protezione dei dati](12-sicurezza-e-protezione-dati.md) | Account, sessioni, permessi, antiabuso, accessi straordinari e conservazione proposta |
| [Osservabilità e piano operativo](13-osservabilita-e-piano-operativo.md) | Misure, controlli, allarmi, responsabilità e procedure di recupero |
| [Ambienti e rilascio](14-ambienti-e-rilascio.md) | Sviluppo locale, isolamento cloud, Terraform, pipeline, migrazioni e rollback |
| [Dimensionamento e costi](15-dimensionamento-e-costi.md) | Capacità iniziali, tariffe, conto economico, alternative e dimostrazione scolastica |
| [Sintesi e presentazione](16-sintesi-e-presentazione.md) | Caso completo, architettura, compromessi, requisiti, rischi e scaletta espositiva |
| [Decisioni e contesto](decisioni-e-contesto.md) | Scelte di base, motivazioni, punti aperti e stato del lavoro |

## Stato della consegna

Il percorso dei Markdown è concluso: prodotto, flussi, dati, architettura, sicurezza, gestione operativa, rilascio e costi hanno un documento di riferimento. La sintesi collega i requisiti alle scelte e alle prove richieste e propone una scaletta per le future slide.

Restano da validare, prima dell'uso reale, paesi/lingue e fonte geografica, evidenze delle verifiche, politica dei dati, schema fisico, configurazioni e quote, capacità e procedure. I punti aperti non sono presentati come funzionalità già realizzate o risultati ottenuti. Nessun altro capitolo è obbligatorio per questa prima edizione.

La creazione delle slide e un'eventuale implementazione sono fasi successive. La documentazione resta locale; il materiale precedente rimane conservato.

## Regole della documentazione

- Ogni argomento ha un documento di riferimento; gli altri lo richiamano con un collegamento.
- Le scelte indicano problema, soluzione, motivazione e limite principale. Si confrontano alternative quando possono cambiare significativamente il progetto.
- Requisiti, ipotesi di dimensionamento e proposte ancora aperte sono distinguibili.
- Le configurazioni dettagliate sono documentate solo quando aiutano a comprendere o verificare il progetto.
- I diagrammi hanno sorgenti Mermaid modificabili e devono concordare con il testo. Il controllo documentale non equivale a una verifica grafica di tutti i diagrammi.
- Le funzionalità future restano separate dal perimetro progettato.

## Rapporto con il materiale esistente

`domora/docs` è la documentazione della nuova versione. Il materiale precedente è conservato su `main` e nella storia Git; non costituisce automaticamente una decisione di Domora.

Su richiesta del referente, la nuova versione viene salvata nel branch locale `domora-nuova-versione`, derivato da `main` e contenente la documentazione Domora al posto della struttura precedente. Nessun merge o push: `main` rimane invariato.
