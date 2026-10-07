# Domora — Scenario di carico e requisiti di qualità

Questo documento stabilisce le ipotesi quantitative e gli obiettivi con cui valutare l'architettura. Derivano dal [perimetro](01-prodotto-e-perimetro.md), dai flussi e dal [modello dei dati](06-modello-dati.md).

**Stato:** scenario di progetto scelto per la documentazione scolastica. Non è una previsione commerciale, una misura di un servizio esistente o una garanzia AWS. Gli obiettivi dovranno essere verificati con dimensionamento e, in un'eventuale implementazione, test.

## 1. Dimensione del servizio

| Grandezza | Ipotesi di riferimento | Motivazione |
| --- | --- | --- |
| Agenzie attive | 1.000 | Portale condiviso di dimensioni significative, senza assumere copertura dell'intero mercato europeo |
| Account professionali | 5.000 | Media di cinque persone per agenzia, compresi i responsabili |
| Account registrati complessivi | 100.000 | Include interessati e personale; non coincide con gli utenti collegati contemporaneamente |
| Schede degli immobili | 60.000 | Catalogo interno più ampio delle offerte pubbliche correnti |
| Annunci pubblicati | 50.000 | Media di cinquanta offerte attive per agenzia |
| Annunci complessivi | 100.000 | Include bozze, ritirati, conclusi e sospesi; consistenza iniziale, non limite perpetuo |
| Sessioni giornaliere | 20.000 | Comprende visitatori e utenti autenticati |
| Nuovi contatti giornalieri | 1.000 | Ipotesi del 5% delle sessioni; le visite possono riutilizzare questi contatti |
| Messaggi giornalieri | 3.000 | Comprende messaggi iniziali e risposte, non tre messaggi aggiuntivi per ogni contatto |
| Pubblicazioni e aggiornamenti giornalieri | 500 | Attività ordinaria delle agenzie sul catalogo pubblico |

Il dato di 100.000 annunci comprende lo storico disponibile nello scenario iniziale. Contatti e messaggi crescono nel tempo: a ritmo costante, 1.000 contatti e 3.000 messaggi al giorno producono circa 365.000 contatti e 1,1 milioni di messaggi in un anno, prima di applicare una politica di conservazione.

**Motivazione:** il catalogo giustifica la valutazione di ricerca dedicata e gestione delle transazioni, ma non obbliga da solo a scegliere OpenSearch o Aurora. Le alternative sono confrontate nella [persistenza](09-persistenza-e-ricerca.md) e nel [conto economico](15-dimensionamento-e-costi.md), con verifiche prestazionali ancora necessarie. Non si introduce un requisito multi-regione per sostenere questi numeri.

## 2. Traffico API e picchi

Si assumono in media dieci richieste API per sessione: circa **200.000 richieste in una giornata ordinaria**, equivalenti a 2,3 richieste al secondo se distribuite sulle 24 ore. La media non rappresenta il carico delle ore frequentate.

| Condizione | Carico da progettare | Significato |
| --- | --- | --- |
| Giornata ordinaria | 200.000 richieste API | Base per volumi giornalieri e stima economica |
| Picco ordinario | 50 richieste/s per 10 minuti | Circa 30.000 richieste concentrate, compatibili con la giornata ordinaria |
| Picco straordinario | 200 richieste/s per 15 minuti | Circa 180.000 richieste nel solo intervallo, aggiuntive alla giornata ordinaria |

Il picco straordinario rappresenta una campagna o un aumento improvviso dell'interesse. Non è incluso implicitamente nel volume ordinario. Per stimare il costo si valuteranno una giornata ordinaria e una giornata con questo picco, senza assumere già una frequenza mensile delle campagne.

Come prima distribuzione del carico si usa **90% letture e 10% operazioni di modifica**. Nel picco straordinario corrisponde a 180 letture e 20 modifiche al secondo. Le modifiche comprendono anche preferiti e altre operazioni degli utenti, non soltanto nuovi annunci e messaggi.

Le letture sono suddivise inizialmente in parti uguali fra ricerca e consultazione di schede o pannelli. Una pagina di ricerca mostra venti risultati; il limite massimo API sarà cinquanta. Con novanta ricerche al secondo e venti risultati vengono restituiti fino a 1.800 annunci al secondo. La [ricerca PostgreSQL](09-persistenza-e-ricerca.md) combina filtri e visibilità nella stessa query: non richiede un controllo separato per ogni risultato, ma deve comunque esaminare righe e indici secondo il piano di esecuzione.

**Motivazione:** la prevalenza delle letture riflette il percorso di consultazione. Venti risultati mantengono la pagina leggibile; cinquanta limitano richieste eccessive. Considerare anche il controllo della visibilità impedisce di dimensionare soltanto il motore di ricerca trascurando il dato autorevole.

Questi conteggi escludono download delle immagini, asset del frontend, trasferimento diretto dei file e chiamate al sistema di identità. Concorrenza delle esecuzioni e connessioni database dovranno essere calcolate a partire da durata delle operazioni e accessi effettivi, non dal numero degli account registrati.

## 3. Media, limiti e crescita dello storage

| Elemento | Ipotesi o limite iniziale | Motivazione |
| --- | --- | --- |
| Immagini per immobile | Media 10, massimo 20 | Coprire un annuncio ordinario mantenendo un limite all'upload |
| Formati immagine | JPEG e PNG, massimo 10 MB ciascuna | Formati diffusi; il limite è verificato anche sul file effettivo |
| Immagine originale media | 2 MB | Ipotesi di dimensionamento, distinta dal limite massimo |
| Documenti interni | Media 2 per immobile, massimo 10 | Allegati essenziali senza gestione documentale completa |
| Formato documenti | PDF, massimo 20 MB ciascuno | Ridurre formati e percorsi di verifica iniziali |
| Documento medio | 5 MB | Ipotesi per lo storage, non dimensione obbligatoria |
| Nuovi file giornalieri | 300 immagini e 100 documenti | Carico separato dagli aggiornamenti del solo testo |

Su 60.000 immobili, la media ipotizzata produce circa **1,2 TB di immagini originali** e **0,6 TB di documenti**. Per miniature e varianti web si riservano inizialmente altri 0,3 TB, ipotizzando 0,5 MB complessivi per immagine: circa **2,1 TB di file** prima di copie protettive, file temporanei e sostituzioni. Si usano unità decimali per queste stime.

I nuovi upload aggiungono circa 1,1 GB di originali al giorno e 0,15 GB di varianti immagini, prima di pulizia e conservazione. Il riuso delle immagini fra vendita e affitto dello stesso immobile non duplica automaticamente il file. Le copie protettive e le versioni precedenti devono essere conteggiate separatamente.

Per un primo scenario di traffico immagini si assumono 30 immagini effettivamente scaricate per sessione, fra risultati e dettagli, con variante media da 150 KB: circa **90 GB al giorno verso i client**. Una scheda da venti risultati non obbliga a scaricare tutte le immagini se non vengono visualizzate. Questa è un'ipotesi sul trasferimento ai visitatori; il traffico verso l'origine dipenderà dalla cache e non è automaticamente lo stesso.

La dimensione di database e indice richiede una stima separata dei record, degli indici e dello storico. Non si deduce dai terabyte dei file e il [dimensionamento](15-dimensionamento-e-costi.md) propone volume iniziale e range ACU senza dedurli dai terabyte dei file.

**Motivazione:** separare file, record e traffico evita di presentare il serverless come privo di costi persistenti. Limiti su formati e dimensioni rendono progettati anche i controlli, non soltanto il percorso di upload.

## 4. Obiettivi di prestazioni e aggiornamento

| Operazione | Obiettivo di progetto |
| --- | --- |
| API di ricerca e consultazione | Entro 1 secondo per almeno il 95% delle richieste riuscite |
| API di modifica, invio messaggio o richiesta | Entro 2 secondi per almeno il 95% delle richieste riuscite |
| Risposta HTML pubblica generata dal server | Entro 2 secondi per almeno il 95% delle richieste riuscite; obiettivo aggiunto con la scelta dell'hosting |
| Aggiornamento della ricerca | Campi pubblici e rappresentazione testuale aggiornati nella stessa transazione; nuove query vedono il commit già confermato |
| Avviso email ordinario | Richiesta di invio accettata dal servizio email entro 5 minuti per almeno il 99% degli avvisi validi |
| Verifica e preparazione ordinaria di un'immagine | Stato pronto o esito di errore entro 2 minuti per almeno il 95% dei caricamenti completati |

Il percentile 95 significa che almeno 95 richieste su 100 rispettano il tempo indicato. La latenza API si misura all'ingresso del servizio fino alla risposta completa, includendo dipendenze e avvii delle funzioni; non include la rete dell'utente, il caricamento completo della pagina o il trasferimento dei file. Le operazioni fallite sono misurate separatamente e non devono sparire dalla valutazione di qualità.

Gli obiettivi API e della risposta HTML valgono entro entrambi i picchi definiti. Quelli asincroni valgono in condizioni ordinarie. Gli avvisi email misurano l'accettazione dell'invio, non la consegna finale nella casella del destinatario. Per i PDF interni sono definiti scansione e validazione nel [percorso dei media](10-media-worker-e-notifiche.md), senza uno SLO temporale distinto nella base; non si applica implicitamente il target delle immagini.

La scelta di [hosting e API](08-accesso-frontend-e-api.md) aggiunge rendering lato server alle pagine pubbliche. Il relativo tempo si misura dall'ingresso web alla risposta HTML completa e include la lettura dell'API, senza rete dell'utente e trasferimento delle immagini. Come ipotesi di carico iniziale, il 30% delle richieste API è una lettura iniziale effettuata dal server: circa 60.000 rendering al giorno e 60 al secondo al picco, se la distribuzione rimane la stessa. Queste letture sono già incluse nelle richieste API; invocazioni SSR e richieste web sono conteggi separati per hosting e costi.

Durante il picco straordinario, elaborazione immagini e avvisi possono accumulare ritardo fino a 15 minuti. Dopo il ritorno al carico ordinario, il lavoro recuperabile deve tornare senza arretrati entro 30 minuti; errori permanenti devono essere isolati e segnalati. La ricerca interna non ha un arretrato di indicizzazione esterna. Il dimensionamento dovrà dimostrare che i processi hanno capacità per recuperare mentre continuano a ricevere nuovo lavoro.

**Motivazione:** ricerca e contatti richiedono risposte rapide; processi in background tollerano ritardi visibili. I target sono abbastanza concreti da guidare verifiche e allarmi, senza richiedere tempi estremi o consegna email garantita.

## 5. Disponibilità e comportamento durante i guasti

L'obiettivo è **99,9% di disponibilità mensile** per ciascuna funzione principale: catalogo e ricerca, accesso autenticato e lettura/invio dei contatti. In un mese di trenta giorni equivale a un budget di **43,2 minuti di indisponibilità per funzione**. Non si compensa una ricerca indisponibile contando soltanto le richieste del resto del portale.

La disponibilità sarà verificata con controlli periodici dei percorsi essenziali e con esiti delle richieste legittime. Latenze, errori e limitazioni del traffico ammesso completano la misura; finestra e frequenza dei controlli sono definite nel [piano di osservabilità](13-osservabilita-e-piano-operativo.md). Manutenzioni pianificate e problemi delle dipendenze del servizio concorrono al budget; errori dei parametri, operazioni correttamente vietate e guasti del dispositivo dell'utente no.

**Motivazione:** il 99,9% richiede ridondanza e gestione operativa, ma lascia un margine più proporzionato alla base scolastica rispetto a un obiettivo prossimo a zero disservizio. È un obiettivo dell'intero percorso, non la somma o la citazione delle garanzie dei singoli servizi AWS.

Durante sovraccarico hanno priorità consultazione, messaggi, richieste e controlli di permessi e visibilità. Nuove pubblicazioni e upload possono essere limitati temporaneamente con un'indicazione esplicita. Una richiesta non accettata non riceve conferma di salvataggio; una richiesta già confermata rimane registrata e il lavoro successivo deve essere recuperabile.

Un guasto dell'email non impedisce di leggere o inviare messaggi nel portale. Un guasto del database può rendere indisponibili insieme ricerca e contatti; un problema della sola query di ricerca non attiva un secondo motore di ripiego. Se non è possibile verificare permessi o visibilità, il servizio rifiuta temporaneamente l'operazione invece di esporre dati non verificati.

Ritiro, sospensione e disabilitazione bloccano nuove operazioni a partire dal salvataggio autorevole. Non rientrano nel ritardo ordinario ammesso per l'indice. Gli annullamenti massivi delle visite possono essere materializzati in background, con obiettivo entro 5 minuti in condizioni ordinarie: nel frattempo le visite invalidate risultano non confermate nei pannelli e non possono essere accettate o completate. Anche una riabilitazione rapida deve rispettare il blocco precedente.

Il recupero prioritario include questi annullamenti; il picco non autorizza a presentare come valido un appuntamento invalidato. La [distribuzione dei media](10-media-worker-e-notifiche.md) usa firme valide per cinque minuti: dopo un blocco non se ne emettono di nuove, ma quelle esistenti consentono di iniziare download nel tempo residuo. Trasferimenti già avviati possono terminare successivamente. La cache CDN non prolunga la firma; questo limite resta distinto dal blocco logico delle API.

## 6. Recupero e perdita dei dati

**RTO** è il tempo obiettivo entro cui ripristinare una funzione dopo un guasto. **RPO** è l'intervallo massimo obiettivo di dati recenti che si accetta di perdere durante un recupero. Ridondanza per continuare a operare e backup per recuperare dati corrotti risolvono problemi diversi.

| Scenario | Obiettivo RTO | Obiettivo RPO | Confine |
| --- | --- | --- | --- |
| Guasto di un componente o di una zona nella regione operativa | 10 minuti per le funzioni principali | Nessuna perdita di scritture transazionali già confermate | Richiede ridondanza e verifica del comportamento delle dipendenze |
| Corruzione o cancellazione da recuperare nel database | 4 ore dal riconoscimento dell'incidente | 15 minuti rispetto al punto dell'incidente, se identificabile | Ripristino dei dati transazionali; scritture successive al punto scelto da riconciliare |
| Cancellazione o corruzione dei file | 24 ore dal riconoscimento dell'incidente | 24 ore | Protezione separata di immagini e documenti |
| Perdita dell'intera regione | Nessun tempo contrattuale assunto nella base | Nessun obiettivo numerico assunto nella base | Rischio residuo esplicito; non è prevista una seconda regione operativa |

Il recupero da corruzione può superare il budget mensile del 99,9%: quel mese l'obiettivo di disponibilità potrebbe non essere rispettato. L'RTO di emergenza non concede un'esenzione dalla misura. La perdita regionale rimane fuori dall'obiettivo di recupero garantibile dalla base, senza scomparire dal rischio o dal conteggio dell'indisponibilità.

L'RPO del database non promette di preservare tutte le operazioni compiute dopo l'inizio di una corruzione rimasta inosservata. Il punto corretto da ripristinare, il lavoro successivo da recuperare e la riconciliazione devono essere parte della procedura.

Il portale può tornare parzialmente utilizzabile prima di recuperare tutti i media: un annuncio privo delle immagini obbligatorie non deve essere ripubblicato automaticamente. Identità, configurazioni, segreti e file fanno parte del recupero completo; dati e indici di ricerca vengono recuperati insieme nel database, ma un backup del solo database non basta.

**Motivazione:** recupero locale rapido e backup per errori sui dati mantengono una strategia contenuta. Rinunciare al sito regionale alternativo limita costo e complessità, accettando un'interruzione potenzialmente lunga in quel caso. I tempi rimangono target da verificare su volumi, procedure e risorse effettive.

## 7. Limiti operativi e qualità dei dati

I messaggi hanno un massimo iniziale di 5.000 caratteri; le descrizioni pubbliche di 10.000. Si preserva testo sufficiente per il contatto e l'offerta, evitando contenuti illimitati. Limiti applicativi per account, protezione del traffico, durata degli inviti e proposte di conservazione sono definiti in [Sicurezza e protezione dei dati](12-sicurezza-e-protezione-dati.md).

Per il lavoro umano si propone una prima risposta dell'agenzia entro un giorno lavorativo, da presentare come obiettivo organizzativo senza garanzia tecnica. Orari lavorativi e responsabilità devono essere dichiarati dall'agenzia. Domora può registrare il ritardo e mostrare la pratica, ma non promette una risposta automatica o disponibilità degli operatori continuativa.

Ricerca, preferiti e contatti devono rispettare i confini fra utenti e agenzie anche durante picchi, revoche e guasti. La correttezza di questi controlli non viene ridotta per raggiungere un obiettivo di latenza.

## 8. Verifiche da prevedere

| Verifica | Evidenza richiesta in un'eventuale implementazione |
| --- | --- |
| Picchi di 50 e 200 richieste/s | Latenza, errori e limitazioni con la distribuzione di richieste dichiarata e dati di dimensioni realistiche |
| Ricerca e controllo della visibilità | Risultati pertinenti e contenuti bloccati esclusi dalle query iniziate dopo il blocco confermato |
| Invii simultanei e ripetuti | Nessun duplicato di contatti, visite attive o effetti della stessa operazione |
| Revoca, riassegnazione e sospensione | Nessun accesso residuo; visite invalidate anche dopo rapida riabilitazione |
| Arretrato e guasto email | Persistenza delle richieste, isolamento degli errori e recupero entro l'obiettivo |
| Guasto locale | Misura dell'interruzione e verifica delle scritture confermate |
| Ripristino database e file | Procedura eseguibile, durata misurata e verifica della coerenza fra riferimenti e contenuti |

In questa fase si documentano dimensionamento e piano di verifica, senza simulazioni presentate come test svolti. Le parti architetturali indicano come si intende soddisfare i requisiti; il [piano operativo](13-osservabilita-e-piano-operativo.md) definisce misure e prove ancora necessarie. Le scelte documentate non sostituiscono queste evidenze.
