# Domora — Osservabilità e piano operativo

Questa parte definisce come misurare i [requisiti di qualità](07-carico-e-requisiti-qualita.md), individuare guasti e ripristinare il servizio. Applica i vincoli di [sicurezza](12-sicurezza-e-protezione-dati.md) e i percorsi di [persistenza](09-persistenza-e-ricerca.md), [worker](10-media-worker-e-notifiche.md) e [rete](11-regione-e-rete.md).

**Stato:** piano progettato, non monitoraggio attivo o prove già svolte. Fonti AWS consultate il **7 ottobre 2026**. Le responsabilità sono ipotetiche per il progetto scolastico; l'RTO non è ottenuto soltanto scrivendo una procedura.

## 1. Strumenti e responsabilità

| Strumento | Scopo | Motivazione |
| --- | --- | --- |
| CloudWatch Logs e metriche | Esiti e tempi applicativi, stato dei servizi e lavoro pendente | Un riferimento operativo integrato con i componenti AWS |
| CloudWatch Synthetics | Controlli periodici dei percorsi utente | Rilevare problemi anche senza traffico reale |
| CloudWatch Alarms e SNS | Allarmi e avvisi al personale operativo | Percorso distinto da outbox e SES del prodotto |
| Tracing con OpenTelemetry e destinazione AWS | Seguire un campione di richieste fra frontend, API e dati | Distinguere latenza applicativa e dipendenze senza tracciare ogni richiesta |
| CloudTrail | Audit delle operazioni AWS | Separare attività infrastrutturale e azioni degli utenti del portale |
| VPC Flow Logs | Metadati del traffico privato | Diagnosticare connessioni rifiutate o percorsi errati |

CloudWatch raccoglie i log delle Lambda con i permessi necessari. Si definiscono log group e retention per ambiente; non si assume che i log siano sempre consultabili immediatamente dopo un errore. [Log Lambda](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html).

Per nuova strumentazione si preferisce OpenTelemetry, supportato dalle soluzioni AWS, senza adottare automaticamente un SDK X-Ray storico. Non si introduce un cluster di raccolta autonomo: runtime, layer o esportatore saranno scelti nel rilascio per il linguaggio effettivo. Il servizio X-Ray può essere destinazione delle tracce; i correlation identifier restano utilizzabili anche quando una traccia non attraversa tutto il percorso asincrono. [Strumentazione OpenTelemetry in AWS](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-migration.html).

**Motivazione:** log, metriche, tracce e audit rispondono a domande diverse. Un solo grande file di log non fornisce né una misura della disponibilità né la procedura da eseguire quando qualcosa fallisce.

## 2. Misura della disponibilità

La disponibilità mensile viene rendicontata separatamente per **catalogo/ricerca**, **accesso autenticato** e **lettura/invio dei contatti**, con obiettivo del 99,9%. Ogni funzione ha la propria serie di esiti; la media di tutte le richieste non nasconde il guasto di una funzione poco usata.

Le frequenze seguenti riguardano la produzione prevista. Staging usa controlli principali ogni cinque minuti, riportati al minuto durante le prove rappresentative, come precisato in [Dimensionamento e costi](15-dimensionamento-e-costi.md).

Si prevedono controlli sintetici esterni alla VPC applicativa:

| Controllo | Frequenza iniziale | Evidenza |
| --- | --- | --- |
| Pagina pubblica e ricerca con un filtro noto | Ogni minuto | HTML corretto, risposta API valida e contenuto coerente |
| Login gestito con TOTP e richiesta protetta | Ogni minuto | Login completo, credenziale accettata e profilo autorizzato |
| Lettura di un contatto sintetico | Ogni minuto | Dati accessibili al partecipante corretto |
| Invio di un messaggio sintetico e rilettura | Ogni quindici minuti | Salvataggio e recupero del messaggio, con identificativo di invio |

CloudWatch Synthetics supporta controlli schedulati e percorsi browser. Gli account e i record usati sono sintetici e controllati: non generano contatti verso agenzie reali, appuntamenti reali o avvisi a utenti esterni. Non si crea un'eccezione ai controlli di permesso per far passare il monitor. Credenziali e fattore dell'account di controllo sono protetti come segreti tecnici, non memorizzati nei suoi record applicativi. [Controlli sintetici](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html).

Screenshot, log e artefatti dei controlli non conservano password, QR TOTP, token o messaggi personali. Le fixture devono restare riconoscibili come dati di verifica; il loro uso e la loro pulizia saranno parte delle procedure di rilascio. Una sessione già valida non sostituisce il controllo del login completo.

Come primo indicatore si usa `campioni riusciti / campioni attesi × 100`, sul mese per funzione. I campioni mancanti sono **stato non verificato**, non successo: il rapporto li evidenzia e non consente di dichiarare il target raggiunto senza analisi. Incidenti e richieste reali integrano la misura, distinguendo un guasto della sonda da un guasto del servizio.

Una sonda al minuto dà una risoluzione indicativa di un minuto; non prova continuità fra tutti i campioni. Le scritture ogni quindici minuti hanno copertura inferiore, compensata dagli esiti delle richieste reali e dalle prove funzionali. In assenza di traffico, questa limitazione viene riportata, senza dichiarare una misura più precisa di quella ottenuta.

**Motivazione:** controlli e traffico reale coprono casi diversi. La lettura frequente evita di creare un messaggio a ogni minuto, mentre la prova periodica verifica anche il salvataggio. I circa 96 messaggi sintetici giornalieri e le invocazioni delle sonde sono conteggiati separatamente nel dimensionamento e nei costi.

La regione applicativa resta Francoforte. Si aggiunge soltanto una sonda pubblica da un'altra regione europea, per esempio Irlanda, che verifica pagina e ricerca ogni cinque minuti senza credenziali utenti. È monitoraggio ausiliario, non un sito di recupero o una replica dei dati. I dati privati dei controlli autenticati restano nel percorso regionale scelto.

Se Francoforte non può inviare allarmi o le sonde interne non pubblicano più risultati, la sonda esterna offre un riscontro distinto. Non dimostra la disponibilità da ogni paese europeo e non elimina il rischio di guasti comuni al fornitore.

## 3. Latenza, errori e completamento

| Obiettivo | Misura |
| --- | --- |
| API letture entro 1 secondo al percentile 95 | Latenza dell'intera risposta per metodo e classe di operazione, con esiti separati |
| API modifiche entro 2 secondi al percentile 95 | Latenza comprendente autenticazione, controllo e commit |
| HTML pubblico entro 2 secondi al percentile 95 | Durata della risposta dinamica dal percorso web; tempo esterno delle sonde riportato separatamente |
| Email accettata entro 5 minuti nel 99% dei casi validi ordinari | Differenza fra operazione che genera l'avviso e accettazione SES confermata |
| Immagine pronta o errore esplicito entro 2 minuti nel 95% dei casi ordinari | Differenza fra upload completato e stato finale, inclusa scansione |
| Annullamenti materializzati entro 5 minuti ordinari | Età delle visite invalidate ancora da aggiornare |
| Recupero arretrato entro 30 minuti dopo il picco | Ritorno dell'età del lavoro recuperabile alle condizioni ordinarie |

I percentili sono calcolati sulle durate delle richieste o su metriche che conservino la distribuzione, non sulla media di medie. Si distinguono periodo ordinario, intervallo del picco e recupero. Una serie con pochi campioni viene indicata come insufficiente per una valutazione affidabile del percentile, senza nasconderne gli errori.

Una risposta HTTP positiva con contenuto errato non è un controllo riuscito. Gli errori tecnici e le limitazioni del traffico legittimo sono riportati; errori di input, permessi correttamente negati e firme scadute non sono indisponibilità, ma restano segnali diagnostici. Non si classifica automaticamente ogni 4xx come responsabilità dell'utente.

L'email con esito incerto non è accettata. Una lavorazione fallita velocemente soddisfa eventualmente il tempo di esito dell'immagine, ma non ne dimostra la riuscita: si riporta anche il rapporto di errori tecnici sui file validi, distinto da contenuti rifiutati per policy.

**Motivazione:** un target temporale non deve premiare il servizio che risponde rapidamente con errori. Successo, tempo e qualità dell'esito vanno letti insieme.

## 4. Segnali tecnici e applicativi

Si definisce una dashboard per ambiente con quattro viste: percorsi utente, capacità dati, lavoro in background e protezione/recupero.

| Area | Segnali necessari |
| --- | --- |
| API e hosting | Richieste per classe, latenza, errori, throttling, rendering falliti |
| Lambda | Durata, errori, timeout, concorrenza, limitazioni e avvii rilevanti |
| Aurora e proxy | Capacità usata e limite, CPU/memoria, query lente, lock, connessioni e attese, eventi di failover |
| Outbox | Record non consegnati, record senza esito applicativo e loro età |
| SQS e DLQ | Messaggi disponibili/in lavorazione, età, errori e messaggi isolati |
| Media e scanner | Upload senza esito, scansioni fallite, rifiuti, età della lavorazione e file mancanti |
| SES | Accettazione, esiti incerti, bounce permanenti, complaint e limiti di invio |
| Rete | Errori NAT, connessioni rifiutate, fallimenti S3 e risoluzione endpoint |
| Sicurezza e backup | Revoche, anomalie dei permessi, cambi di configurazione, backup falliti e punto recuperabile |

Le metriche SQS sono approssimate e descrivono la coda, non l'anzianità dell'operazione originaria. Dopo retry, consegne duplicate o passaggio in DLQ si deve conservare e misurare anche il momento applicativo del lavoro. [Metriche SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html), [Metriche Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/MonitoringAurora.html).

Le Lambda emettono log strutturati con ambiente, versione, area funzionale, tipo operazione, esito, durata e identificativi tecnici di richiesta/lavoro. Gli identificativi di utenti e risorse, quando necessari alla diagnostica, restano dati ad accesso ristretto; non vengono usati come dimensioni delle metriche, per evitare crescita incontrollata del numero di serie.

CloudTrail registra attività AWS, mentre lo storico applicativo registra ruoli, assegnazioni e interventi sul portale. VPC Flow Logs descrive metadati delle connessioni, non il contenuto dei messaggi. [CloudTrail](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html), [Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html).

## 5. Allarmi con azioni

Le soglie sotto sono **valori operativi iniziali**, da verificare con traffico e test. Un allarme non corrisponde automaticamente al superamento mensile dello SLO: serve a intervenire prima o durante il deterioramento.

| Segnale | Attivazione iniziale | Azione e responsabile |
| --- | --- | --- |
| Percorso principale non funzionante | Due controlli consecutivi al minuto falliti | Reperibile tecnico verifica API, hosting, identità e dati; apre incidente critico |
| Telemetria attesa assente | Tre intervalli consecutivi senza campioni | Verificare sonda e canale di raccolta; stato non verificato, non verde |
| Latenza API oltre target | Tre finestre da cinque minuti, con campioni sufficienti | Verificare query, connessioni, avvii e throttling; non ridurre controlli di sicurezza |
| Errori tecnici API | Oltre 1% per cinque minuti con almeno cento richieste, oppure percorso sintetico fallito | Verificare deployment e dipendenza coinvolta; correlare con frequenza degli errori |
| Outbox senza consegna o esito | Età oltre due minuti: avviso; oltre quattro: urgente | Verificare dispatcher, coda, worker e limite della dipendenza |
| Visite invalidate ancora pendenti | Età oltre due minuti: avviso; oltre quattro: urgente | Priorità al worker di servizio; validità già negata dai controlli applicativi |
| Nuovi record in DLQ | Almeno un messaggio | Analisi e classificazione; nessun replay automatico cieco |
| Lavorazione immagine oltre target | Crescita persistente del lavoro oltre due minuti ordinari | Verificare scanner e worker; non promuovere file non verificati |
| Email con esito incerto o complaint | Nuovo caso | Esaminare il feedback; sospendere avvisi al recapito quando richiesto dalla policy |
| Ultimo backup file utilizzabile troppo vecchio | Oltre diciotto ore: avviso; oltre ventiquattro: critico | Verificare job, permessi e vault; dichiarare il rischio sull'RPO |
| Punto recuperabile database oltre target | Ritardo maggiore di quindici minuti rispetto al presente | Verificare protezione e stato database; distinguere guasto da punto scelto per corruzione |
| Accesso privato incoerente o controllo di isolamento fallito | Un caso verificato | Bloccare il percorso interessato, preservare evidenze e coinvolgere referente sicurezza |

Durante un picco riconosciuto, ritardi di immagini e avvisi si confrontano con il limite straordinario di quindici minuti; non si sopprimono i segnali, gli annullamenti prioritari o gli errori di sicurezza. Un evento di picco non è un'etichetta che giustifica qualunque degrado.

Gli allarmi inviano notifiche a topic SNS dedicati al personale operativo, con destinazioni confermate prima del servizio. Il canale non usa SES e outbox di Domora; avvisi critici richiedono presa in carico verificata ed escalation se il primo referente non risponde. L'integrazione con un servizio di reperibilità resta da scegliere prima di un uso reale, senza introdurla nella base scolastica. [Allarmi CloudWatch e SNS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html).

**Motivazione:** un'email di allarme da sola non garantisce un intervento. Si testa sia il cambio di stato dell'allarme sia la ricezione e la presa in carico, con destinatari operativi separati dagli utenti.

## 6. Responsabilità e presa in carico

| Responsabilità ipotetica | Compito |
| --- | --- |
| Referente tecnico di turno | Riceve allarmi, verifica impatto e avvia mitigazione |
| Responsabile dell'incidente | Coordina decisioni, tempi e riapertura; mantiene il registro |
| Referente dati/sicurezza | Autorizza interventi sensibili, valuta esposizione e correttezza del recupero |
| Referente applicativo | Verifica regole, messaggi, visite e coerenza degli esiti |

Nel progetto scolastico queste responsabilità possono essere descritte anche se non esiste una squadra reale. L'obiettivo di recupero locale di dieci minuti presuppone automazione dei servizi e copertura operativa per verificare eventuali fallimenti; una gestione soltanto in orario scolastico non dimostrerebbe quel target.

Il percorso è: rilevare → verificare impatto → contenere → recuperare → controllare → riaprire. Il registro annota inizio stimato del guasto, rilevazione, presa in carico, azioni, punto di recupero, ripresa e verifica finale. Mantiene separati tempo tecnico e tempo di attesa dell'intervento.

Per indisponibilità o rischio sui dati si limita il servizio in modo esplicito, preservando i dati già salvati. Le comunicazioni pubbliche evitano dettagli sensibili; destinatari e modalità sono un'attività operativa futura, non messaggi autorizzati da questa documentazione.

## 7. Procedure essenziali di recupero

### Guasto locale del database o della rete

1. Verificare funzione coinvolta, eventi Aurora/proxy, connessioni e stato delle due zone.
2. Lasciare agire il failover progettato; evitare riavvii o promozioni manuali ripetuti che confondano il recupero.
3. Verificare nuovo writer, connessione proxy e uscite NAT/S3; una connessione riuscita non prova un contatto salvato.
4. Controllare transazioni con esito incerto attraverso identificativi di invio, senza ripeterle come operazioni nuove.
5. Verificare catalogo, login, lettura e scrittura e misurare l'interruzione rispetto ai dieci minuti obiettivo.

### Arretrato, DLQ o guasto del worker

1. Identificare il lavoro più vecchio e distinguere outbox non consegnata, errore a monte e consumer fallito.
2. Correggere permessi, codice o dipendenza; aumentare concorrenza solo se il sistema a valle ha capacità.
3. Riprendere per gruppi limitati, rispettando identificativi, versioni e stati finali; verificare gli esiti email incerti separatamente.
4. Confermare annullamenti delle visite prima di dichiarare terminato il recupero; controllare età e nuovi arrivi, non soltanto profondità della coda.

### Corruzione dei dati transazionali

1. Bloccare scritture coinvolte e contenere accessi sospetti; preservare evidenze e identificare il punto sano.
2. Autorizzare il ripristino PITR verso un cluster separato. Registrare punto scelto, punto effettivamente disponibile e operazioni successive da riconciliare.
3. Verificare schema, vincoli, account, contenuti e riferimenti file. Riapplicare cancellazioni accolte e revoche che non devono essere annullate dal restore.
4. Esaminare outbox, notifiche e visite: un effetto esterno già avvenuto non si annulla ripristinando il database e non va ripetuto alla cieca.
5. Collegare proxy e applicazione al cluster validato con percorso controllato; verificare ricerca e contatti prima di riaprire le scritture.
6. Misurare tempo dal riconoscimento alla ripresa e perdita rispetto al punto dell'incidente; confrontare RTO quattro ore e RPO quindici minuti con i limiti della corruzione rilevata in ritardo.

### Perdita o corruzione dei file

1. Identificare oggetti e versioni coinvolti; bloccare distribuzione o download non validabili.
2. Ripristinare dal versioning o dal recovery point corretto, mantenendo traccia della provenienza.
3. Confrontare checksum e aggiornare gli identificativi delle versioni ripristinate; verificare esiti di scansione e ricreare varianti mancanti.
4. Riconciliare i riferimenti Aurora; media assenti non sono pronti e annunci senza immagini obbligatorie restano non pubblicabili.
5. Verificare accessi CloudFront/OAC e documenti privati; misurare tempi e punto recuperato rispetto ai target di ventiquattro ore.

**Motivazione:** il recupero riguarda stato applicativo, effetti esterni e permessi, non soltanto il ritorno in stato “disponibile” di un servizio AWS. La perdita dell'intera regione mantiene il rischio residuo dichiarato: non esiste una procedura di failover verso un secondo portale già operativo.

## 8. Prove e criterio di riapertura

Staging ospiterà prove di guasto e restore con dati sintetici prima di un'eventuale produzione. Si eseguono dopo modifiche significative a rete, dati o worker; nella gestione ipotetica si ripetono prove di restore almeno ogni trimestre e controlli dei canali di allarme ogni mese. Le differenze fra ambienti sono definite in [Ambienti e rilascio](14-ambienti-e-rilascio.md).

Ogni prova produce un verbale con scenario, volumi, versione, sequenza, durata, punto recuperato e controlli superati/falliti. Un test su pochi record non dimostra automaticamente il recupero dei volumi previsti.

Il servizio viene dichiarato ripreso quando i percorsi utente sono verificati, le scritture confermate sono coerenti, contenuti bloccati e visite invalidate non tornano attivi, effetti esterni sono riconciliati e cancellazioni e revoche restano applicate. Una dashboard verde da sola non soddisfa questi criteri.

## 9. Conservazione, costi e stato

Si applicano le proposte di trenta giorni per log operativi e dodici mesi per audit, da validare con la politica dei dati. Gli artefatti delle sonde hanno una proposta più breve di sette giorni e conservano solo dati sintetici; le tracce sono campionate inizialmente al 10%, con aumento temporaneo motivato durante un'indagine. Il campionamento non sostituisce le metriche complete degli esiti.

I costi comprendono log ingeriti e conservati, metriche custom, allarmi, sonde, artefatti, tracce, SNS e audit selezionato. Non si abilita ogni evento dati S3 o ogni dettaglio di rete senza considerare volumi e finalità. La configurazione selettiva dovrà comunque coprire gli accessi straordinari e le operazioni sensibili previste.

Sono completati criteri di misura, allarmi iniziali, responsabilità e procedure. Restano da realizzare sonde, dashboard e integrazione della reperibilità e da eseguire test e prove: non sono evidenze già ottenute. Il percorso di [ambienti e rilascio](14-ambienti-e-rilascio.md) definisce come aggiornamenti e ripristini seguano un processo riproducibile, usando questi criteri per il collaudo.
