# Domora — Ricerca, consultazione e preferiti

Questo documento completa il percorso pubblico del [prodotto](01-prodotto-e-perimetro.md): trovare un annuncio, consultarlo, salvarlo e avviare un [contatto](04-contatti-e-visite.md). Le regole valgono anche per operatori e amministratori quando utilizzano il catalogo come interessati.

## 1. Percorso di ricerca

1. Il visitatore sceglie vendita oppure affitto; la scelta resta esplicita nella schermata e nei risultati.
2. Può restringere la ricerca per località, caratteristiche, prezzo e testo.
3. Il backend valida i parametri e costruisce la ricerca su PostgreSQL secondo la [scelta di persistenza](09-persistenza-e-ricerca.md).
4. La stessa query applica filtri, testo e verifica che gli annunci siano pubblicati e le agenzie attive.
5. Mostra una lista paginata di schede sintetiche, da cui aprire il dettaglio.
6. Per salvare un preferito o inviare una richiesta, il visitatore accede o crea un account; dopo l'accesso può riprendere dall'annuncio, verificandone nuovamente la disponibilità.

La ricerca e il dettaglio non richiedono autenticazione. Una ricerca senza filtri aggiuntivi mostra gli annunci più recenti del tipo di offerta scelto. Risultati, schede e immagini pubbliche non espongono dati operativi dell'agenzia.

**Motivazione:** il catalogo pubblico facilita la scoperta; l'account è richiesto solo per attività personali. Separare vendita e affitto evita di confrontare il prezzo di acquisto con un canone mensile.

## 2. Filtri e ordinamento

| Parametro | Regola di base |
| --- | --- |
| Tipo di offerta | Vendita o affitto, una scelta per ricerca |
| Località | Paese e, facoltativamente, comune selezionati da un elenco controllato |
| Tipo di immobile | Una tipologia alla volta: appartamento, casa indipendente, ufficio, locale commerciale, terreno o magazzino |
| Prezzo | Minimo e massimo facoltativi, in euro |
| Superficie | Minimo e massimo facoltativi, in metri quadrati |
| Locali | Numero minimo facoltativo, dove applicabile alla tipologia |
| Testo | Ricerca nel titolo e nella descrizione pubblica |

I filtri si combinano: un risultato deve soddisfare tutte le condizioni selezionate. Nella base iniziale il canone degli annunci di affitto è mensile; spese aggiuntive sono descritte separatamente e non incluse implicitamente nel valore usato per il filtro.

La località viene selezionata usando identificativi controllati, non confrontando nomi digitati liberamente. Il [modello dati](06-modello-dati.md) definisce la struttura del catalogo geografico; fonte iniziale e paesi coperti restano da scegliere. Non si assume un servizio esterno a ogni ricerca.

Gli ordinamenti disponibili sono più recenti, prezzo crescente e prezzo decrescente. Con una query testuale è disponibile anche la pertinenza, cioè quanto il contenuto corrisponde al testo cercato. A parità del criterio principale si usa un criterio stabile, fino all'identificativo dell'annuncio.

“Più recenti” si riferisce alla prima pubblicazione dell'annuncio. Modificare il prezzo o ripubblicare un annuncio ritirato non rinnova quella data; un nuovo annuncio dopo una conclusione ha una nuova data di pubblicazione.

**Motivazione:** questi criteri coprono la ricerca essenziale e rendono confrontabili le offerte. Non aggiornare la data a ogni modifica evita che correzioni minime riportino continuamente l'annuncio in cima alla lista. La pertinenza non introduce raccomandazioni personalizzate o promozioni a pagamento.

Il backend rifiuta intervalli invertiti, valori negativi, identificativi sconosciuti e ordinamenti non supportati. Limiti alla lunghezza del testo e alla complessità delle query saranno fissati con API e requisiti di carico. Il browser invia parametri applicativi: non può inviare direttamente istruzioni al motore di ricerca.

## 3. Geografia e indirizzo pubblico

La base iniziale usa ricerca per paese e comune, senza mappa, raggio o ricerca sull'area visibile. Non si introduce quindi un fornitore cartografico nel percorso essenziale.

Se l'agenzia mantiene riservato l'indirizzo esatto, il catalogo mostra solo il comune e il paese. Non pubblica via, numero civico, coordinate esatte o un punto ottenuto spostando leggermente la posizione. L'agenzia può pubblicare esplicitamente l'indirizzo; questo non cambia il filtro per comune.

**Motivazione:** una zona amministrativa dichiarata è semplice da capire e non suggerisce una precisione inesistente. Una mappa introdurrebbe coordinate pubbliche, rappresentazione della posizione approssimativa e un'integrazione da motivare. Il compromesso è una ricerca meno precisa, soprattutto nei grandi comuni.

L'operatore resta responsabile di non inserire volontariamente un indirizzo riservato nella descrizione o nelle immagini pubbliche. Separare i campi protegge il percorso normale, ma non garantisce che il testo libero o una fotografia non contengano indicazioni riconoscibili.

## 4. Risultati, paginazione e dettaglio

Ogni scheda sintetica contiene identificativo dell'annuncio, titolo, tipo di offerta, prezzo con unità coerente, tipologia, superficie, locali dove pertinenti, comune, immagine principale e agenzia. Non contiene documenti interni, recapiti dell'interessato o informazioni dei contatti.

Si procede per pagine con un comando “Mostra altri”, senza richiedere un conteggio totale esatto. Il backend restituisce un riferimento alla prosecuzione della ricerca; cambiare filtri o ordinamento avvia una nuova ricerca. Il [requisito di carico](07-carico-e-requisiti-qualita.md) fissa venti risultati ordinari e un massimo API di cinquanta; la realizzazione tecnica resta da definire.

L'ordinamento stabile e il riferimento di prosecuzione devono evitare duplicazioni su dati invariati. Durante aggiornamenti del catalogo non si garantisce una fotografia immutabile dell'intera ricerca: l'utente può aggiornare per ricominciare. Una pagina svuotata dai controlli di visibilità non deve essere interpretata automaticamente come fine dei candidati.

**Motivazione:** leggere blocchi successivi è sufficiente per esplorare il catalogo. Evitare conteggi esatti e salti arbitrari a pagine lontane limita lavoro aggiuntivo; la garanzia di una ricerca immutabile richiederebbe una scelta tecnica ulteriore.

Il dettaglio pubblico legge il contenuto corrente dell'annuncio e verifica la sua visibilità, mostrando descrizione completa, caratteristiche, immagini selezionate e indirizzo secondo la scelta dell'agenzia. I recapiti pubblici dell'agenzia sono recapiti professionali dichiarati per il portale; non coincidono automaticamente con l'email personale degli operatori.

## 5. Aggiornamento e contenuti non disponibili

La ricerca usa il writer PostgreSQL: campi pubblici e rappresentazione testuale vengono aggiornati nella stessa transazione. Una nuova query vede le modifiche già confermate al proprio inizio; non esiste una finestra di sincronizzazione con un indice esterno. Una schermata già aperta non si aggiorna automaticamente e una query già in corso può aver letto lo stato precedente.

Il controllo della visibilità corrente resta obbligatorio per risultati e dettagli pubblici, come previsto nel [flusso di pubblicazione](03-flusso-pubblicazione.md), ed è realizzato nella query autorevole. Se il database non è disponibile, il sistema mostra un errore temporaneo invece di riusare risultati non verificati. Le risposte non sono conservate in una cache condivisa, secondo la [scelta di accesso](08-accesso-frontend-e-api.md).

Un annuncio ritirato, concluso, sospeso o appartenente a un'agenzia disabilitata non espone più il suo contenuto nel catalogo. Un collegamento diretto mostra una risposta generica di annuncio non disponibile, senza rivelare motivo amministrativo o dati nascosti. L'area delle conversazioni conserva solo il contesto privato previsto dal flusso dei contatti.

**Motivazione:** un unico motore per filtri e visibilità elimina il problema di una copia esterna obsoleta. La ricerca dipende dal database autorevole e ne condivide la capacità con i contatti; questo compromesso è incluso nel dimensionamento e nella disponibilità.

Le [immagini verificate](10-media-worker-e-notifiche.md) sono distribuite con URL CloudFront firmati per cinque minuti. Un blocco impedisce nuove firme; quelle già emesse restano utilizzabili per il tempo residuo, anche con una copia in cache CDN. Download già iniziati e contenuti ricevuti non possono essere ritirati dal dispositivo: questo limite è distinto dalla verifica corrente delle schede e delle richieste.

## 6. Preferiti

Un utente autenticato può aggiungere ai preferiti un annuncio attualmente visibile. Il preferito collega account e annuncio; lo stesso annuncio compare una sola volta nella lista personale. Aggiungere di nuovo o rimuovere un preferito già rimosso non genera errori né duplicati.

La lista mostra il contenuto pubblico corrente, non una copia del prezzo o della descrizione al momento del salvataggio. Quando un annuncio diventa non disponibile, resta un riferimento rimovibile con etichetta generica “Annuncio non disponibile”, senza vecchio titolo, immagini, prezzo o motivo del blocco.

Se lo stesso annuncio torna pubblicato, il preferito torna consultabile. Un nuovo annuncio dello stesso immobile non eredita il preferito precedente. Conservazione e rimozione dei riferimenti seguono le proposte della [politica dei dati](12-sicurezza-e-protezione-dati.md), da validare prima dell’uso reale.

**Motivazione:** il preferito esprime interesse per una specifica offerta. Conservare il riferimento evita sparizioni inspiegabili dalla lista; mostrare solo dati attualmente pubblicabili rispetta la rimozione dal catalogo. Non trasferirlo a nuove offerte evita di assumere un interesse che l'utente non ha espresso.

Nella base iniziale non sono previste ricerche salvate, avvisi per nuovi annunci o riduzioni di prezzo e riepiloghi periodici. Salvare un preferito non attiva email. Queste funzioni richiederebbero preferenze e processi periodici ulteriori rispetto agli avvisi dei contatti.

## 7. Errori e verifiche di coerenza

| Caso | Comportamento previsto |
| --- | --- |
| Nessun risultato | Lista vuota con filtri modificabili; non un errore di servizio |
| Parametri non validi | Indicazione del parametro da correggere, senza eseguire la query |
| Ricerca o controllo di visibilità indisponibili | Errore temporaneo e possibilità di riprovare; non una falsa lista vuota |
| Annuncio rimosso dopo la ricerca | Dettaglio non disponibile; nessun nuovo contatto |
| Prosecuzione non più utilizzabile | Invito a riavviare la ricerca, senza perdere i filtri |
| Accesso richiesto per un preferito | Login e nuova verifica della disponibilità prima del salvataggio |
| Annuncio rimosso durante l'aggiunta ai preferiti | Operazione rifiutata senza salvare un nuovo riferimento |

Le verifiche successive dovranno includere combinazione dei filtri, separazione vendita/affitto, ordinamento stabile, riservatezza dell'indirizzo, esclusione dei contenuti bloccati dalle nuove query e isolamento delle liste personali. Non viene introdotto un secondo motore come ripiego durante un guasto del database: sarebbe un secondo comportamento da dimensionare e verificare.

**Motivazione:** distinguere assenza di risultati e guasto evita indicazioni ingannevoli. Un unico percorso di ricerca limita la complessità; la sua disponibilità dovrà essere progettata insieme alle dipendenze effettive.
