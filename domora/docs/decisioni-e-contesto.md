# Domora — Decisioni e contesto

Aggiornato il **7 ottobre 2026**.

## Mandato e metodo

Il referente ha autorizzato una nuova documentazione locale in `domora/docs`, con libertà di progettazione entro un livello di complessità vicino al materiale di `main`. Il materiale precedente è un riferimento consultabile, non il progetto da proseguire.

Le priorità espresse sono organizzazione delle idee, pulizia della nuova cartella e giustificazione di ogni scelta. Si procede per parti documentate, discutendo i passaggi successivi.

Durante la stesura Git è stato usato solo in lettura. Successivamente il referente ha autorizzato un branch dedicato alla nuova versione: `domora-nuova-versione`, derivato da `main`, con un commit locale della documentazione Domora al posto dei vecchi contenuti. Il materiale precedente rimane su `main` e nella storia Git. Nessun merge, push o nuova inizializzazione della repository.

I nomi dei branch non usano il prefisso `codex/`, secondo la preferenza globale del referente.

## Come distinguere gli stati

- **Vincolo confermato:** richiesta esplicita del referente.
- **Scelta di base:** adottata nell'ambito della libertà di progettazione concessa; resta rivedibile durante il confronto.
- **Orientamento:** direzione iniziale che richiede ancora motivazioni e verifica.
- **Aperto:** problema non ancora risolto; non va trattato come decisione acquisita.

## Scelte della prima parte

Il dettaglio e le motivazioni sono nel documento [Prodotto e perimetro](01-prodotto-e-perimetro.md).

| Scelta | Stato | Motivo principale | Limite o conseguenza |
| --- | --- | --- | --- |
| Progettazione documentale, senza implementazione AWS | Vincolo confermato | Costruire una base per la presentazione | Le proprietà operative non sono dimostrate da test reali |
| Portale per più agenzie con vendita e affitto | Scelta di base | Dare un contesto concreto al catalogo e alla gestione professionale | Richiede separazione dei dati riservati fra agenzie |
| Ricerca pubblica e account per preferiti e richieste | Scelta di base | Accesso semplice al catalogo e storico delle richieste associato a un'identità | La registrazione introduce un passaggio prima del contatto |
| Cinque attori con responsabilità distinte | Scelta di base | Mantenere il modello dei permessi comprensibile | Matrice definita nella seconda parte; realizzazione tecnica successiva |
| Immobile distinto dall'annuncio | Scelta di base | Separare il bene dall'offerta e dalle richieste ricevute | Regole funzionali definite nella seconda parte; modello dati successivo |
| Pubblicazione da agenzie abilitate, senza approvazione preventiva di ogni annuncio | Scelta di base | Limitare la complessità del processo di pubblicazione | Richiede un percorso di gestione dei contenuti problematici |
| CRM limitato a richieste, assegnazione e stato | Scelta di base | Coprire il contatto senza costruire un gestionale commerciale | Nessun calendario o processo contrattuale |
| Immagini e documenti, email come canale di notifica | Scelta di base | Limitare elaborazioni e integrazioni iniziali | Video e altri canali esclusi dalla base |

## Orientamenti architetturali da sviluppare

Lo stack iniziale proposto includeva Next.js, Cognito, API Gateway, Lambda, Aurora PostgreSQL con RDS Proxy, S3, OpenSearch, EventBridge/SQS e SES. Le scelte ora documentate sono Next.js su Amplify Hosting, Cognito User Pools, API Gateway REST regionale, Lambda, Aurora PostgreSQL Serverless v2 con RDS Proxy, S3 e CloudFront per i media, SQS, SES ed EventBridge per gli eventi dei servizi. Si aggiungono Malware Protection for S3, Scheduler e AWS Backup per controlli, lavoro periodico e recupero; CodeBuild è un esecutore temporaneo delle migrazioni, non un servizio del percorso utente. La ricerca usa PostgreSQL: **OpenSearch non è nella base adottata**. Step Functions non è adottato per i processi attuali.

La regione operativa scelta è Francoforte (`eu-central-1`), con VPC privata su due zone e procedure di backup e recupero. NAT regionale e gateway endpoint S3 gestiscono l'uscita; i dettagli sono in [Regione e rete](11-regione-e-rete.md). Non è assunto un requisito di continuità durante la perdita di un'intera regione.

Gli orientamenti ancora aperti derivano dal materiale di riferimento e dalla proposta iniziale: **non costituiscono ancora una valutazione tecnica completata**. Ogni componente dovrà essere collegato a un'esigenza, confrontato con un'alternativa quando significativa e verificato prima di descriverne configurazione o garanzie. Le scelte già documentate non implicano prestazioni o disponibilità misurate.

## Scelte della seconda parte

Le seguenti sono **scelte di base** adottate nel mandato di progettazione. Il dettaglio è in [Attori e permessi](02-attori-e-permessi.md) e [Flusso di pubblicazione](03-flusso-pubblicazione.md).

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Un'agenzia per account professionale, ingresso tramite invito | Semplificare il contesto dei permessi | Appartenenza simultanea a più agenzie esclusa |
| Catalogo condiviso fra operatori; contatti limitati all'assegnatario e al responsabile | Facilitare il lavoro senza diffondere tutti i contatti | Revoca e riassegnazione devono aggiornare l'accesso |
| Abilitazione manuale dell'agenzia; segnalazioni esaminate dall'amministratore | Evitare integrazioni aggiuntive e sospensioni automatiche arbitrarie | Evidenze e tempi operativi ancora da definire |
| Contenuto pubblico dell'annuncio separato dalla scheda interna | Evitare modifiche ed esposizioni implicite | Aggiornamento pubblico esplicito |
| Bozza, pubblicato, ritirato, concluso e sospeso | Coprire il ciclo essenziale dell'offerta | Nessuno stato in trattativa o revisione editoriale parallela |
| Un annuncio non concluso per immobile e tipo di offerta | Evitare offerte duplicate e aggiramento del blocco sulla stessa scheda | Ritirato e sospeso restano nel vincolo |
| Conclusione definitiva; sospensione revocata verso ritirato | Conservare l'identità dell'offerta ed evitare ripubblicazione automatica | Ritorno sul mercato dopo conclusione con nuovo annuncio |
| Documenti interni, immagini pubbliche selezionate, indirizzo esatto facoltativo | Rendere esplicita la visibilità | Comune e paese come zona pubblica, precisati nella quarta parte |
| Controllo di versione sulle modifiche | Impedire sovrascritture fra colleghi | Conflitti risolti ricaricando i dati |
| Verifica corrente della visibilità anche per risultati di ricerca derivati | Non esporre offerte bloccate attraverso un indice obsoleto | Costo e meccanismo da valutare nell'architettura |

## Scelte della terza parte

Le seguenti sono **scelte di base**; comportamento e motivazioni sono nel [flusso di contatti e visite](04-contatti-e-visite.md).

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Un contatto per utente e annuncio | Evitare pratiche duplicate e conservare la conversazione | Un nuovo annuncio genera una pratica distinta |
| Nuovi contatti assegnati manualmente dal responsabile | Restare coerenti con il catalogo condiviso | Nessuna distribuzione automatica; risposta dipendente dall'organizzazione |
| Messaggi nel portale e avvisi email generici | Conservare contenuti e stato in un unico luogo | Nessuna chat in tempo reale, allegati o risposta via email |
| Contatto nuovo, in gestione o chiuso; nuovo messaggio dell'interessato riapre | Rendere visibile il lavoro da riprendere | Stato distinto dall'assegnazione e dalla visita |
| Visita in attesa, accettata, rifiutata, annullata o completata | Rappresentare richiesta, accordo ed esito dell'appuntamento | Nessuna prenotazione di slot o verifica dei conflitti |
| Una visita attiva per contatto; cambio dell'accordo tramite annullamento e nuova richiesta | Evitare appuntamenti paralleli e modifiche implicite | Passaggio aggiuntivo per riprogrammare |
| Uscita dell'offerta dal catalogo annulla le visite attive | Evitare accordi rimasti validi su offerte non disponibili | Riattivazione dell'annuncio non ripristina gli appuntamenti |
| Contatti esistenti restano gestibili dopo ritiro o conclusione; sospensione blocca i messaggi | Consentire chiarimenti finali rispettando il blocco amministrativo | Storico privato conservato senza ripubblicare la scheda |

## Scelte della quarta parte

Le seguenti sono **scelte di base**; comportamento e motivazioni sono in [Ricerca e preferiti](05-ricerca-e-preferiti.md).

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Vendita e affitto separati; euro e canone mensile per l'affitto | Rendere confrontabili prezzi e filtri | Nessuna mescolanza delle due offerte nella stessa ricerca |
| Paese e comune da elenco controllato, senza mappa o raggio | Limitare integrazioni e precisione geografica pubblica | Fonte dell'elenco da scegliere; ricerca meno precisa nei grandi comuni |
| Filtri essenziali e testo su titolo e descrizione pubblica | Coprire il percorso di scoperta | Nessuna ricerca nei documenti o nei dati interni |
| Data di prima pubblicazione per l'ordinamento più recente | Evitare risalite in lista dopo correzioni minime | Ripubblicare lo stesso annuncio non rinnova la data |
| Pagine successive senza conteggio totale esatto | Limitare lavoro aggiuntivo e complessità | Nessun salto a pagine arbitrarie o fotografia immutabile della ricerca |
| Dettaglio corrente e verifica della visibilità prima dell'esposizione | Proteggere il catalogo anche con indice obsoleto | Cache, immagini e costo del controllo da progettare |
| Preferito riferito all'annuncio, con segnaposto se non disponibile | Conservare l'interesse senza esporre contenuti rimossi | Nessun trasferimento automatico a nuove offerte |
| Nessuna ricerca salvata o email sui preferiti | Limitare preferenze e processi periodici | Avvisi email riservati ai flussi di contatto e gestione già definiti |

## Scelte della quinta parte

Le seguenti sono **scelte di base**; relazioni, vincoli e motivazioni sono nel [modello dati](06-modello-dati.md). Lo schema fisico non è ancora definito.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Identità applicativa distinta da credenziali e appartenenza professionale | Separare autenticazione, profilo e autorizzazione | Collegamento al sistema di identità da realizzare |
| Campi pubblici copiati esplicitamente nell'annuncio | Evitare esposizione automatica di modifiche interne | Duplicazione controllata dei dati descrittivi |
| Media stabili e selezione delle immagini separata per annuncio | Evitare sovrascritture di contenuti già pubblicati | Sostituzione tramite nuovo media; pulizia dei file con verifica dei riferimenti |
| Messaggi direttamente collegati al contatto | Evitare una seconda entità di conversazione senza autonomia | Un solo insieme di partecipanti per contatto |
| Autore e contesto del messaggio conservati; assegnazione riferita all'appartenenza | Ricostruire l'attività anche dopo revoche e trasferimenti | Conservazione e cancellazione da definire |
| Tipologie limitate e catalogo geografico con identificativi stabili | Rendere filtri e dati coerenti | Fonte geografica e paesi coperti ancora aperti |
| Vincoli verificati anche durante operazioni concorrenti | Proteggere unicità e transizioni effettive | Realizzazione nel database e nelle API da progettare |
| Storico delle operazioni senza versionamento completo automatico | Tracciare le responsabilità con complessità contenuta | Nessun ripristino di ogni versione precedente |
| Rappresentazione ricercabile dei soli dati pubblici | Evitare ricerca nei dati riservati | Realizzata nella stessa persistenza PostgreSQL nella ottava parte |

## Scelte della sesta parte

Scenario e obiettivi sono in [Carico e requisiti di qualità](07-carico-e-requisiti-qualita.md). Sono **ipotesi e target di progetto**, adottati nel mandato di progettazione: non dati osservati o garanzie già ottenute.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| 1.000 agenzie, 100.000 account e 50.000 annunci pubblicati | Scenario significativo ma contenuto | Storico, messaggi e file crescono separatamente |
| 200.000 richieste API al giorno; picchi a 50 e 200 richieste/s | Distinguere volume medio e carico concentrato | Picco straordinario aggiuntivo al volume ordinario |
| 90% letture; venti risultati per pagina, massimo cinquanta | Dimensionare anche i controlli sui candidati | Concorrenza e accessi al database da calcolare |
| Limiti su immagini JPEG/PNG, documenti PDF e testi | Rendere controllabili trasferimento e dati | Circa 2,1 TB di file nello scenario prima di copie protettive |
| API entro 1 secondo per letture e 2 per modifiche al percentile 95 | Mantenere reattivo il percorso essenziale | Risultato da verificare ai picchi previsti |
| Avvisi entro 5 minuti in condizioni ordinarie; ricerca inizialmente proposta entro 60 secondi | Dare obiettivi misurabili | Il target di sincronizzazione della ricerca è superato dalla scelta transazionale dell'ottava parte |
| Disponibilità mensile del 99,9% per funzione principale | Obiettivo proporzionato senza promessa di continuità assoluta | 43,2 minuti per funzione in trenta giorni; guasti delle dipendenze conteggiati |
| Recupero locale entro 10 minuti; recupero database entro 4 ore con RPO di 15 minuti | Distinguere ridondanza ed errori sui dati | Un recupero da corruzione può violare la disponibilità del mese |
| Recupero file entro 24 ore con RPO di 24 ore; nessun target regionale nella base | Limitare complessità della protezione geografica | Recupero completo distinto dal ripristino delle sole API |

## Scelte della settima parte

Le seguenti sono **scelte di base** motivate in [Accesso, frontend e API](08-accesso-frontend-e-api.md), con fonti AWS e Next.js consultate il 7 ottobre 2026. Rete e dipendenze dati devono ancora essere completate.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Next.js su Amplify Hosting | Eseguire le pagine pubbliche dinamiche senza gestire un servizio container | Servizio aggiuntivo, compute SSR e compatibilità del framework da verificare |
| HTML pubblico generato alla richiesta; pannelli privati caricati via API nel browser | Rendere leggibili le schede pubbliche senza duplicare il backend | Nessuna garanzia commerciale SEO; hosting incluso nel percorso di disponibilità |
| Nessuna cache del contenuto degli annunci o dei dati privati; asset versionati in cache | Evitare esposizione di offerte rimosse e dati personali | Maggior carico; immagini con strategia separata |
| API Gateway REST regionale con WAF diretto | Proteggere l'ingresso API senza aggiungere un proxy solo per WAF | Costo superiore alla variante HTTP API, da stimare |
| Cognito User Pool e login gestito con authorization code e PKCE | Separare credenziali e logica immobiliare | Sessione, MFA e protezione del login ancora da dettagliare |
| Access token e scope per API; ruoli e assegnazioni controllati sui dati correnti | Rendere effettive revoche anche con credenziale ancora valida | Authorizer e permessi applicativi sono controlli distinti |
| Lambda per aree funzionali, moduli condivisi e transazioni senza chiamate fra servizi | Scalare operazioni brevi mantenendo un nucleo comprensibile | Limiti di concorrenza, avvii e connessioni da verificare |
| WAF separato su hosting e stage REST | Evitare una protezione solo apparente delle chiamate dirette | Due associazioni e protezione Cognito da valutare separatamente |
| Target HTML di 2 secondi al percentile 95; letture SSR pari al 30% del totale delle richieste API | Misurare anche l'esecuzione del frontend | Ipotesi aggiuntiva di carico; target da verificare |

## Scelte dell'ottava parte

Le seguenti sono **scelte di base** motivate in [Persistenza e ricerca](09-persistenza-e-ricerca.md), con fonti AWS e PostgreSQL. Sostituiscono gli orientamenti verso ricerca separata e sincronizzazione dell'indice esterno.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Aurora PostgreSQL Serverless v2, writer e reader in zone diverse | Capacità variabile e istanza pronta al subentro | Range ACU e costo da verificare; RDS Multi-AZ resta un'alternativa da confrontare economicamente |
| RDS Proxy e letture applicative sul writer | Gestire connessioni Lambda e consultare stato autorevole | Reader di riserva, non capacità aggiuntiva ordinaria |
| Schema condiviso con contesto di agenzia e vincoli relazionali | Evitare mille database conservando isolamento logico | Query e collegamenti da verificare; row-level security non ancora adottata |
| Ricerca testuale e filtri PostgreSQL, senza OpenSearch | Eliminare un sistema e la sua sincronizzazione per i requisiti attuali | Ricerca e contatti condividono capacità; test misti indispensabili |
| Rappresentazione testuale aggiornata nella stessa transazione | Rendere le modifiche visibili alle nuove query dopo il commit | Nessun target di ritardo dell'indice esterno; query in corso e schermate già aperte possono avere dati precedenti |
| Vincoli univoci, controllo di versione e protezione dei record nelle transazioni | Gestire operazioni simultanee senza duplicati | Schema fisico, lock e timeout da definire |
| Outbox transazionale per avvisi e lavoro successivo | Non perdere il lavoro quando la consegna fallisce | Consumer idempotenti e trasporto da completare; nessuna promessa exactly-once |
| Contatori di disponibilità distinti dalla versione delle modifiche | Impedire che una riattivazione faccia rivivere visite invalidate | Materializzazione degli annullamenti recuperabile in background |
| PITR con sette giorni iniziali di backup | Recuperare errori riconosciuti entro una settimana | Non è retention dei dati personali; RTO e costo da verificare |

## Scelte della nona parte

Le seguenti sono **scelte di base** motivate in [Media, worker e notifiche](10-media-worker-e-notifiche.md), con fonti AWS e limiti espliciti.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Bucket di ingresso distinto dai contenuti verificati | Non esporre file prima dei controlli | Policy, cleanup e versioni da gestire |
| Upload diretto con POST firmato di dieci minuti e versione fissata | Limitare trasferimento e sovrascritture durante un accesso riutilizzabile | Firma non monouso; contenuto reale verificato successivamente |
| Malware Protection for S3 e validazione del worker | Controllare i file senza gestire antivirus nelle Lambda | Servizio e costo aggiuntivi; nessuna garanzia assoluta di sicurezza |
| Varianti immagini preparate in background, massimo quaranta megapixel | Limitare memoria e lavoro ripetuto nelle visite | Target di due minuti include anche scansione e coda |
| CloudFront media con OAC e firme di cinque minuti | Distribuire immagini con origine privata e cache CDN | Accesso residuo fino alla scadenza; nessuna revoca istantanea o proxy Next.js |
| Originali e PDF interni con URL S3 di cinque minuti | Separare documenti e catalogo pubblico | URL già emessi restano validi dopo revoca per il tempo residuo |
| Dispatcher outbox ogni minuto e tre code Standard con DLQ | Separare file, email e annullamenti senza processi sempre accesi | Consegna ripetibile e riconciliazione; Scheduler non garantisce puntualità al secondo |
| EventBridge per scanner e feedback SES; niente Step Functions | Usare i servizi solo per percorsi concreti | Nessuna orchestrazione ulteriore per i processi attuali |
| Esiti email incerti da riconciliare senza reinvio cieco | Limitare duplicati nel confine database–fornitore | Avviso potenzialmente ritardato o mancante; portale autorevole |
| Versioning e AWS Backup ogni dodici ore, recovery point per sette giorni | Progettare recupero distinto dal solo storage operativo | Verifica del RPO di ventiquattro ore e riconciliazione delle versioni ripristinate |

## Scelte della decima parte

Le seguenti sono **scelte di base** motivate in [Regione e rete](11-regione-e-rete.md), con riscontri regionali e alternative. Disponibilità e quote effettive dell'account non sono state provate.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Francoforte, eu-central-1, come regione operativa — vincolo confermato | Preferenza del referente e compatibilità con i componenti scelti | Nessuna promessa di minore prezzo o latenza migliore; paesi serviti ancora da definire |
| VPC di produzione su due zone, quattro subnet private | Separare accesso applicativo e dati senza livelli superflui | Zone e capacità IP da verificare nell'account |
| Aurora in subnet dati senza route generale esterna; proxy raggiunto dalle Lambda | Ridurre esposizione e percorsi di accesso | Nessun accesso diretto dal computer personale |
| NAT regionale, operativo su entrambe le zone prima dell'apertura | Uscita multi-AZ senza subnet pubbliche solo per NAT | Attivazione, supporto del provisioning e costi per zona da verificare |
| Gateway endpoint S3 nelle route applicative | Escludere il traffico file dal NAT | Policy compatibili anche con browser, CloudFront, scanner e backup |
| Nessun interface endpoint introdotto automaticamente | Limitare configurazione e costi fissi senza un beneficio dimostrato | NAT per API HTTPS dei servizi; rivalutazione nella stima economica |
| Security group per responsabilità e database non pubblico | Rendere esplicite le connessioni consentite | HTTPS generale non è un filtro completo per destinazione o esfiltrazione |
| Domini distinti e DNS Route 53 | Separare frontend, API e media | Dominio non acquistato; certificato CloudFront in regione di controllo distinta |

## Scelte dell'undicesima parte

La preferenza per **Francoforte, eu-central-1**, è confermata dal referente e sostituisce la proposta iniziale Irlanda. I riscontri regionali sono riallineati in [Regione e rete](11-regione-e-rete.md).

Le seguenti sono **scelte tecniche di base** motivate in [Sicurezza e protezione dei dati](12-sicurezza-e-protezione-dati.md). Le durate di conservazione nello stesso documento sono invece **proposte operative da validare**, non scadenze legali dichiarate.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| MFA TOTP obbligatoria su un solo pool | Politica uniforme anche per account che acquisiscono ruoli professionali | Configurazione aggiuntiva anche per interessati; token iniziali non bastano all'abilitazione |
| Token solo in memoria, durata un'ora e refresh otto ore con rotazione | Evitare credenziali persistenti nel browser senza un backend sessioni aggiuntivo | Possibile passaggio dal login al ricaricamento; XSS resta un rischio |
| Account attivo e limite auth_time verificati dal backend | Non affidare la revoca soltanto a firma e scadenza | Lettura del profilo necessaria alle operazioni riservate |
| Logout di tutte le sessioni dell'account | Gestione uniforme senza registro per dispositivo | Disconnette altre schede; revoca remota da confermare |
| Autenticazione recente per azioni sensibili e inviti di settantadue ore | Limitare l'uso di sessioni vecchie e collegamenti pendenti | Nuovo login e rinnovo dell'invito quando richiesti |
| IAM per responsabilità e utenze SQL separate | Distinguere permessi sui servizi e sui dati | Schema fisico e policy da realizzare e verificare |
| IAM Lambda–proxy e Secrets Manager proxy–database | Evitare password database distribuite alle funzioni | Rotazione, permessi e driver da verificare |
| WAF anche sul pool Cognito con regole compatibili | Proteggere il login oltre a frontend e API | Non bloccare il setup TOTP; nessuna copertura generica delle API amministrative |
| Limiti applicativi per contatti, messaggi e upload | Ridurre abuso senza quote commerciali | Soglie iniziali da verificare con uso legittimo e carico |
| Accessi straordinari temporanei, motivati e autorizzati | Evitare lettura privata permanente dell'amministratore | Responsabilità operative e evidenze ancora da precisare |

## Scelte della dodicesima parte

Le seguenti sono **scelte di base** motivate in [Osservabilità e piano operativo](13-osservabilita-e-piano-operativo.md). Soglie, responsabilità e tempi sono un piano da verificare, non una copertura operativa già attiva.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| CloudWatch per metriche, log e controlli sintetici; OpenTelemetry per tracce campionate | Misurare i percorsi e individuare le dipendenze lente | Strumentazione, copertura e costi da verificare nell'implementazione |
| Disponibilità distinta per catalogo, autenticazione e contatti | Non nascondere una funzione guasta nella media delle altre | Campioni mancanti restano sconosciuti; le sonde non dimostrano ogni caso utente |
| Controlli ogni minuto, invio sintetico ogni quindici minuti | Verificare accesso e persistenza senza generare traffico eccessivo | Dati e credenziali sintetici protetti; costi e richieste aggiuntivi |
| Sonda pubblica ausiliaria in Irlanda ogni cinque minuti | Distinguere alcuni guasti del monitoraggio regionale | Nessun sito di recupero e nessuna replica dei dati privati |
| Allarmi operativi SNS separati dalle notifiche SES del portale | Segnalare anche il guasto del canale email applicativo | Conferma delle destinazioni ed escalation ancora da configurare |
| Allarmi sull'età del lavoro e sugli esiti incerti, oltre alla lunghezza delle code | Rilevare lavoro bloccato anche con pochi messaggi | Timestamp applicativi e riconciliazione necessari |
| Procedure distinte per guasto locale, arretrato, corruzione e file | Collegare ogni incidente a un'azione verificabile | Backup da ripristinare in prova; effetti esterni e cancellazioni da riconciliare |
| Prove di recupero trimestrali e verifiche mensili degli allarmi | Mantenere le procedure utilizzabili nel tempo | Piano proposto; nessuna prova svolta nella fase documentale |

## Scelte della tredicesima parte

Le seguenti sono **scelte di base** motivate in [Ambienti e rilascio](14-ambienti-e-rilascio.md). Descrivono una futura implementazione; il versionamento locale dei documenti non realizza questa pipeline.

| Scelta | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Sviluppo locale, staging e produzione in due account distinti | Limitare copie cloud e separare collaudo e servizio | Gestione di due account; possibile dimostrazione solo staging, senza dichiararla produzione |
| Staging su due zone con gli stessi percorsi tecnici | Provare rete, failover e integrazioni rappresentative | Capacità ridotta non dimostra prestazioni o recupero ai volumi previsti |
| Moduli Terraform comuni e uno state per ambiente | Riproducibilità senza duplicare configurazioni | Bootstrap distinto e verifiche dell'account prima delle modifiche |
| Backend S3 privato/versionato e lock nativo | Proteggere state e modifiche concorrenti | Versione Terraform compatibile; state e plan sono sensibili |
| GitHub Actions con OIDC e ruoli temporanei | Coordinare i rilasci senza chiavi AWS permanenti nel runner | Protezioni del piano GitHub e trust policy da collaudare |
| Un proprietario Terraform per versioni e alias Lambda | Evitare modifiche concorrenti fuori dallo state | Rollback attraverso configurazione e plan di correzione |
| Amplify SSR collegato alla futura repository, build coordinate | Collegare frontend e backend alla stessa revisione candidata | Frontend ricostruito per ambiente; nessuna promessa di promozione ZIP SSR |
| CodeBuild temporaneo per migrazioni tramite proxy | Eseguire SQL nella rete privata senza bastion o database pubblico | Servizio aggiuntivo a consumo; ruolo SQL e comportamento DDL da verificare |
| Migrazioni compatibili prima del codice; rimozioni successive | Consentire transizione e ritorno precedente | Formati pendenti in code/DLQ/outbox da considerare prima della rimozione |
| Rollback del codice distinto dal restore dei dati | Preservare scritture valide ed effetti esterni | Corruzione gestita come incidente; nessun annullamento automatico di revoche |

## Scelte della quattordicesima parte

Capacità e conto sono in [Dimensionamento e costi](15-dimensionamento-e-costi.md). Le tariffe sono riscontri pubblici al 7 ottobre 2026; consumi medi, capacità e riserve rimangono **ipotesi da verificare**, non misure di un sistema operativo.

| Scelta o ipotesi | Motivo principale | Limite o conseguenza |
| --- | --- | --- |
| Aurora Standard, range 2–16 ACU per istanza e reader tier 1 | Minimo pronto, capacità variabile e subentro | Due istanze fatturate; scaling e novanta ricerche/s da provare |
| Staging 0,5–4 ACU per istanza, sempre due zone | Contenere costo senza cambiare il percorso tecnico | Prove prestazionali rappresentative richiedono capacità e dati adeguati |
| Cognito Essentials e 25.000 MAU nel conto centrale | Supportare login e rotazione previsti, distinguendo iscritti da attivi | Ipotesi MAU; franchigia non applicata al totale prudente |
| API 1 GB e 160 slot riservati complessivi | Punto iniziale e separazione della capacità per funzione | Limiti non preriscaldano né garantiscono connessioni o latenza |
| Budget di circa 2.131 USD/mese produzione e 355 staging | Rendere visibili tutte le voci persistenti e variabili | Imposte, lavoro umano e abbonamenti esterni esclusi; circa 3.000 con margine sul doppio ambiente |
| Monitoraggio distinto, circa 302 USD/mese produzione | Non nascondere costo delle sonde al minuto | Frequenze staging ridotte; precisione e costo da valutare insieme |
| CloudFront a consumo nel conto, confronto Business | Conservare controlli cache e intestazioni progettati | Bundle da verificare; non sostituisce protezioni regionali o Amplify |
| RDS PostgreSQL Multi-AZ come candidato economico concreto | Confrontare Aurora con una capacità fissa meno costosa | Nessuna equivalenza di prestazioni dedotta dalla tariffa |
| Dimostrazione eventualmente solo staging, con finestra limitata | Rendere sostenibile l'esercitazione | Non dichiararla produzione e verificare costi residui dopo chiusura |

## Chiusura della quindicesima parte

La [Sintesi e presentazione](16-sintesi-e-presentazione.md) chiude il percorso: caso utente completo, diagramma complessivo, compromessi, requisiti collegati alle prove, limiti residui e scaletta della presentazione. Non introduce nuovi servizi o funzionalità.

La revisione finale ha riallineato i rimandi dei documenti iniziali alle parti completate e chiarito che le firme media vengono incluse nelle risposte catalogo/dettaglio e rinnovate per gruppi, senza assumere una chiamata API aggiuntiva per ogni immagine. Ha mantenuto la distinzione fra blocco autorevole e URL già emessi, fra dato salvato e avviso esterno, fra target progettato e risultato misurato.

**Valutazione:** perimetro funzionale contenuto e motivato; infrastruttura completa più articolata di una semplice demo. Il costo e le alternative sono parte della valutazione, non motivi per omettere protezioni già assunte o presentare una demo ridotta come produzione.

## Punti aperti prioritari

1. Fonte geografica, paesi e lingue iniziali.
2. Evidenze per abilitazione agenzie e recupero MFA; tempi di gestione delle segnalazioni.
3. Validazione delle proposte di conservazione e realizzazione di cancellazione, storico e recupero.
4. Schema fisico, configurazioni IAM/WAF/CSP e prove di sessioni, MFA e onboarding sul piano Essentials.
5. Benchmark Aurora/RDS, quote, integrazioni dell’account e copertura operativa.

La sintesi documenta i limiti residui. In un’eventuale implementazione: completare schema fisico e validare capacità Aurora/RDS, connessioni e ricerca PostgreSQL, responsabilità sui dati personali e proposte di conservazione. Verificare quote e operatività regionale con l'account soltanto in una futura fase autorizzata di implementazione.

## Stato e prossimo passo

**Completate:** definizione di prodotto e perimetro, struttura della documentazione, attori e permessi, pubblicazione, contatti e visite, ricerca e preferiti, modello concettuale dei dati, scenario di carico e requisiti di qualità, accesso/frontend/API, persistenza e ricerca, media/worker/notifiche, regione/rete, sicurezza tecnica e proposte sui dati personali, osservabilità e piano operativo, ambienti e rilascio, dimensionamento iniziale e conto economico, sintesi finale con verifica di coerenza e scaletta espositiva, registro delle scelte. Schema fisico, benchmark, validazione privacy e configurazioni effettive restano aperti.

**Percorso Markdown concluso:** sedici documenti numerati, indice e registro delle decisioni. Non sono necessari altri capitoli per questa prima edizione. Le verifiche completate riguardano testo, rimandi e calcoli; non sono benchmark, test AWS o verifica grafica di tutti i diagrammi.

**Fase successiva:** preparare la presentazione a partire dalla sintesi, scegliendo durata e livello tecnico quando richiesto. Slide e implementazione non sono state avviate. Il versionamento della documentazione è stato autorizzato nel branch locale `domora-nuova-versione`; nessun merge o push.
