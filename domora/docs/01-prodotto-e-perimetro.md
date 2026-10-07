# Domora — Prodotto e perimetro

## 1. Obiettivo

Domora permette alle agenzie immobiliari di pubblicare annunci e gestire le richieste ricevute dagli interessati. Chi cerca casa può consultare un catalogo pubblico, individuare un immobile e contattare l'agenzia per informazioni o una visita.

Il percorso termina alla gestione del contatto e della richiesta di visita. Il portale non conclude la compravendita o il contratto di affitto.

Il progetto è scolastico e riguarda la progettazione di una soluzione su AWS. La documentazione deve spiegare il comportamento del servizio, collegarlo all'infrastruttura e rendere difendibili le scelte. Un'implementazione o una demo richiedono una fase successiva.

## 2. Attori

| Attore | Responsabilità di base |
| --- | --- |
| Visitatore | Cerca immobili e consulta gli annunci pubblicati senza account |
| Utente registrato | Usa le funzioni pubbliche, salva preferiti e invia richieste di contatto o visita |
| Operatore dell'agenzia | Gestisce immobili, annunci e media della propria agenzia; segue le richieste assegnate |
| Responsabile dell'agenzia | Gestisce gli operatori, supervisiona gli annunci e assegna o riassegna le richieste |
| Amministratore del portale | Gestisce l'abilitazione delle agenzie e può sospendere annunci problematici |

Un operatore o un responsabile può usare anche le funzioni dell'utente registrato. I privilegi professionali si applicano nel contesto dell'agenzia; non concedono accesso ai dati interni delle altre agenzie.

Gli account completano verifica email e configurazione del secondo fattore prima di usare le funzioni riservate, secondo la [politica di sicurezza](12-sicurezza-e-protezione-dati.md). La ricerca pubblica rimane accessibile senza account.

**Motivazione:** pochi attori, con responsabilità comprensibili, permettono di progettare autorizzazioni verificabili senza introdurre un'organizzazione complessa. La matrice dei permessi e le regole di appartenenza sono definite in [Attori e permessi](02-attori-e-permessi.md).

## 3. Funzionalità incluse

### Catalogo e ricerca

- Annunci di vendita e affitto con descrizione, prezzo, caratteristiche, zona e immagini.
- Ricerca pubblica distinta per vendita e affitto, con filtri per paese e comune, prezzo e caratteristiche dell'immobile e ricerca testuale.
- Consultazione della scheda dell'annuncio e preferiti per gli utenti registrati.

**Motivazione:** queste funzioni coprono il percorso essenziale di scoperta dell'immobile. La base usa paese e comune senza mappa o ricerca per raggio, evitando un'integrazione cartografica. Filtri, ordinamento e gestione dei preferiti sono definiti in [Ricerca e preferiti](05-ricerca-e-preferiti.md).

### Gestione dell'offerta

- Inserimento e aggiornamento delle schede degli immobili da parte delle agenzie.
- Creazione di annunci in bozza e pubblicazione da parte degli operatori autorizzati.
- Caricamento di immagini e documenti associati all'immobile o all'annuncio.
- Ritiro o conclusione dell'annuncio quando l'offerta non è più disponibile.
- Sospensione amministrativa di annunci problematici.

Non è prevista una revisione manuale obbligatoria dell'amministratore prima di ogni pubblicazione. L'abilitazione delle agenzie e la sospensione sono controlli distinti, descritti nel [flusso di pubblicazione](03-flusso-pubblicazione.md); le evidenze della verifica restano da precisare.

**Motivazione:** la pubblicazione diretta delle agenzie abilitate riduce i passaggi operativi. Il limite è la necessità di definire responsabilità sui contenuti e un percorso di segnalazione e intervento.

### Contatti e richieste di visita

- Invio di richieste da parte degli utenti registrati, riferite a un annuncio.
- Consultazione delle richieste ricevute da parte dell'agenzia competente.
- Assegnazione a un operatore e aggiornamento dello stato della richiesta.
- Registrazione della risposta e dell'esito della gestione.
- Richiesta di visita, con dettagli da concordare con l'agenzia.
- Email per avvisare i partecipanti degli aggiornamenti rilevanti.

Questo è il perimetro del **CRM**, cioè la gestione delle relazioni con i clienti: richieste, assegnazione e avanzamento. Non comprende un gestionale commerciale completo.

**Motivazione:** un account per l'invio delle richieste semplifica identificazione e accesso al loro storico. Introduce però un passaggio di registrazione per il visitatore. Non progettiamo inizialmente contatti anonimi o accesso tramite collegamenti personali.

Le visite non sono prenotazioni automatiche di slot: il portale raccoglie e gestisce la richiesta. Conversazioni, assegnazioni e stati sono definiti nel [flusso di contatti e visite](04-contatti-e-visite.md), prima della progettazione di API ed eventi.

## 4. Immobile e annuncio

L'**immobile** rappresenta il bene gestito dall'agenzia: caratteristiche, ubicazione e riferimenti ai documenti. L'**annuncio** rappresenta una sua offerta di vendita o affitto e contiene il contenuto destinato al pubblico.

Esempio: un appartamento può essere offerto in affitto, uscire dal mercato e tornare disponibile in seguito. La scheda dell'immobile rimane; gli annunci e le richieste riferite alle diverse offerte devono poter essere distinti.

**Motivazione:** questa separazione evita che la chiusura di un'offerta cancelli l'identità dell'immobile e rende più chiaro il rapporto fra catalogo pubblico e dati operativi. Aggiunge una relazione al modello dati, ma riduce ambiguità nei flussi.

Le regole su annunci simultanei e riattivazione sono definite nel [flusso di pubblicazione](03-flusso-pubblicazione.md); entità e vincoli sono descritti nel [modello dati](06-modello-dati.md). Le proposte di conservazione dello storico sono in [Sicurezza e protezione dei dati](12-sicurezza-e-protezione-dati.md), da validare prima dell’uso reale. Non si assume un catalogo globale che riconosca automaticamente lo stesso bene inserito da agenzie differenti.

## 5. Dati e confini fra agenzie

Il servizio ospita più agenzie indipendenti. Gli annunci pubblicati appartengono al catalogo consultabile; schede interne, documenti riservati e richieste appartengono all'agenzia competente.

| Categoria | Visibilità di base |
| --- | --- |
| Annuncio pubblicato e immagini selezionate per la pubblicazione | Pubblica |
| Bozze, dati interni dell'immobile e documenti non pubblicati | Agenzia competente e soggetti esplicitamente autorizzati |
| Richieste e risposte | Utente interessato e personale autorizzato dell'agenzia competente |
| Preferiti | Utente che li ha salvati |

**Motivazione:** condividere il portale e il catalogo non deve comportare la condivisione dei dati operativi. La separazione deve essere verificata dal backend per ogni operazione riservata.

L'amministratore non riceve implicitamente accesso ordinario a tutte le richieste private. Eventuali accessi straordinari dovranno avere una motivazione e una traccia. Le regole di pubblicazione dell'indirizzo e di riservatezza dei documenti sono in [Attori e permessi](02-attori-e-permessi.md); zona pubblica e recapiti professionali sono precisati in [Ricerca e preferiti](05-ricerca-e-preferiti.md). Proposte di conservazione e percorso di cancellazione sono nella [sicurezza](12-sicurezza-e-protezione-dati.md); validazione e realizzazione restano necessarie.

## 6. Fuori ambito

- Pagamenti, abbonamenti, fatturazione e promozione a pagamento degli annunci.
- Contratti, firma elettronica e conclusione legale della transazione immobiliare.
- Pubblicazione autonoma da parte di privati.
- Calendari condivisi e prenotazione automatica delle visite.
- Importazioni da gestionali e pubblicazione su portali esterni.
- CRM commerciale completo, campagne e previsioni di vendita.
- Video ed elaborazioni multimediali complesse nella base iniziale.
- Raccomandazioni personalizzate, chat in tempo reale e canali di notifica diversi dall'email.
- Mappe, ricerca per raggio, ricerche salvate e avvisi automatici sui preferiti.

**Motivazione:** questi confini mantengono il progetto concentrato sul percorso annuncio–ricerca–contatto e limitano integrazioni e processi che richiederebbero una progettazione aggiuntiva.

## 7. Criterio di completamento della progettazione

La base sarà pronta per la presentazione quando sarà possibile seguire un caso completo: un operatore inserisce un immobile, pubblica un annuncio e riceve una richiesta da un utente che lo ha trovato tramite ricerca.

Per quel caso, la documentazione dovrà indicare attori e permessi, dati coinvolti, operazioni immediate e in background, componenti AWS, comportamento in caso di errore e motivazioni delle scelte. Dovrà inoltre esplicitare le ipotesi di carico e i limiti del progetto, senza presentare obiettivi teorici come risultati già misurati.
