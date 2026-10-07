# Domora — Sicurezza e protezione dei dati

Questo documento applica i controlli ai percorsi già progettati, in **Francoforte (`eu-central-1`)**. Completa [permessi](02-attori-e-permessi.md), [accesso](08-accesso-frontend-e-api.md), [persistenza](09-persistenza-e-ricerca.md), [media](10-media-worker-e-notifiche.md) e [rete](11-regione-e-rete.md).

**Stato:** scelte tecniche di base e proposte operative di conservazione, distinte nelle sezioni. Fonti consultate il **7 ottobre 2026**. Non è una dichiarazione di conformità legale o di controlli già implementati; ruoli privacy, basi del trattamento e informative richiedono validazione prima di un servizio reale.

## 1. Rischi e controlli corrispondenti

| Rischio concreto | Controllo principale | Limite residuo |
| --- | --- | --- |
| Accesso ai contatti di un'altra agenzia | Contesto verificato nel backend, vincoli coerenti e proiezioni esplicite | Da verificare anche query e percorsi amministrativi |
| Credenziale rubata o ruolo revocato | MFA, stato account e permessi correnti, invalidazione applicativa delle sessioni | Un browser compromesso può agire durante una sessione valida |
| Annuncio o immagine accessibili dopo un blocco | Query autorevole senza cache dati; nuove firme vietate | URL media già emessi validi fino a cinque minuti |
| Upload dannoso o modificato dopo i controlli | Area di ingresso, scansione, validazione e versione fissata | Nessun controllo rileva ogni minaccia possibile |
| Abuso di invii o caricamenti | Limiti applicativi, quote e WAF | Falsi positivi e traffico ammesso da monitorare |
| Segreti o messaggi nei log | Logging per metadati e mascheramento | Verificare anche librerie, errori e log dei servizi |
| Cancellazione accidentale o ripristino incoerente | Backup, permessi limitati e riconciliazione | Un backup non sostituisce la procedura di recupero |

**Motivazione:** ogni controllo risponde a un rischio presente nei flussi. WAF, cifratura e subnet private non sostituiscono la verifica che una persona possa leggere uno specifico contatto.

## 2. Account, MFA e recupero dell'accesso

Si usa un unico Cognito User Pool con email verificata, password e **MFA TOTP obbligatoria per gli account del portale**. TOTP è il codice temporaneo generato da un'app autenticatrice, distinto dalla password. Non si aggiunge un canale SMS.

**Motivazione:** l'account può acquisire in seguito un ruolo professionale; una politica uniforme evita eccezioni fra utenti, operatori e amministratori e mantiene il login gestito. Il compromesso è un passaggio di configurazione e autenticazione in più anche per chi vuole soltanto salvare preferiti o contattare un'agenzia. Il catalogo pubblico rimane accessibile senza account.

La MFA richiesta a livello pool e la configurazione TOTP sono supportate dal login gestito Cognito. Il primo accesso può però emettere token durante l'onboarding prima che il secondo fattore sia configurato: il backend non interpreta il solo token come prova di completamento. [MFA Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html), [TOTP e onboarding](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html).

Il profilo applicativo resta in abilitazione fino alla verifica lato server dell'email e della configurazione TOTP presso Cognito. Si consente soltanto il percorso necessario a completare il profilo; contatti, preferiti e privilegi professionali richiedono poi un nuovo login successivo alla verifica. Il backend registra l'istante minimo di autenticazione ammesso. Non accetta un flag “MFA completata” fornito dal browser. [Dati verificabili con AdminGetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUser.html).

Il recupero della password usa il percorso Cognito sull'email verificata. La perdita dell'autenticatore richiede una procedura assistita: blocco temporaneo delle azioni riservate, verifica della titolarità, ripristino del fattore nel provider, invalidazione delle sessioni e nuova configurazione. La sola conoscenza dell'email non autorizza il reset della MFA. Il [piano operativo](13-osservabilita-e-piano-operativo.md) assegna responsabilità ipotetiche; evidenze ammesse e procedura eseguibile del supporto restano da validare; nessun operatore dell'agenzia può reimpostare il fattore dei colleghi.

Gli account amministrativi del portale non sono creati tramite un invito aziendale. L'assegnazione del privilegio è un'operazione riservata, tracciata e separata dalla registrazione ordinaria. Per accesso alla console AWS e deployment si usano identità operative federate, MFA e credenziali temporanee; l'account root non è utilizzato nel lavoro ordinario. [Pratiche IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

## 3. Sessioni nel browser e revoca

Il browser resta un client pubblico con authorization code e PKCE. I token applicativi sono conservati **solo nella memoria della pagina**, non in localStorage, sessionStorage o cookie leggibili dal JavaScript. Gli elementi temporanei necessari al redirect PKCE sono minimizzati e cancellati dopo il callback; non comprendono token già utilizzabili per le API.

**Motivazione:** limitare la persistenza riduce il furto di credenziali conservate sul dispositivo senza aggiungere un server intermedio per le sessioni. Non elimina XSS: un codice dannoso eseguito nella pagina può usare la sessione corrente. Al ricaricamento o alla riapertura della pagina può essere necessario ripassare dal login gestito. [Rischi di gestione delle sessioni](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Si sceglie una durata iniziale di **un'ora per access e ID token** e **otto ore per il refresh token**, con rotazione abilitata. Il refresh token resta anch'esso in memoria. Durata della cookie session del login gestito e durata dei token sono distinte: ridurre la scadenza del token non forza da solo una nuova immissione delle credenziali. [Access token Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html), [Rotazione refresh token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html).

API Gateway verifica la credenziale; le Lambda verificano inoltre account attivo, onboarding completo, client atteso e autenticazione non precedente al limite registrato nel profilo. Il confronto usa `auth_time`, cioè il momento dell'autenticazione, non semplicemente l'istante di emissione di un token aggiornato. La firma e gli scope non costituiscono una verifica dei ruoli correnti.

Il comando **Esci** nella base termina tutte le sessioni Domora dell'account: prima invalida sul backend le autenticazioni precedenti, poi revoca le credenziali aggiornabili, svuota la memoria del browser e termina il login gestito. È una scelta più semplice della gestione separata di ogni dispositivo, ma disconnette anche le altre schede o sessioni. Se il backend non conferma il logout, il client cancella comunque la copia locale e segnala che la revoca remota non è confermata.

Blocchi dell'account, recuperi sensibili e cambi di fattore aggiornano lo stesso limite di autenticazione. Una revoca Cognito non rende automaticamente inutilizzabile un JWT per qualsiasi sistema che verifichi soltanto firma e scadenza: il controllo applicativo resta necessario. [Revoca Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html).

Per assegnare ruoli, modificare il recapito di accesso o eseguire interventi amministrativi si richiede un'autenticazione negli ultimi **cinque minuti**. Se troppo vecchia, si forza un nuovo login e si verifica di nuovo il risultato; non basta aggiornare il token. Il progetto usa il login gestito compatibile con `prompt=login`, da verificare sul piano Cognito Essentials adottato nel [dimensionamento](15-dimensionamento-e-costi.md). [Riautenticazione Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html).

Non si impiega un cookie del portale come credenziale API: le richieste riservate usano l'header Authorization. Si controllano redirect autorizzati, `state` del flusso di login e destinazioni successive; non si accetta un ritorno arbitrario verso domini esterni.

## 4. Permessi AWS, database e segreti

Ogni funzione ha un ruolo IAM limitato alla propria responsabilità. I permessi sono circoscritti a risorse, operazioni e ambiente. Il browser non riceve chiavi AWS permanenti e un worker media non ottiene automaticamente diritto di inviare email o cambiare i ruoli degli utenti.

| Identità del workload | Accessi previsti |
| --- | --- |
| Catalogo pubblico | Lettura della proiezione pubblica sul database; segreto del firmatario CloudFront |
| Gestione agenzia e annunci | Dati aziendali autorizzati, preparazione upload, metadati e outbox |
| Contatti e visite | Pratiche autorizzate, messaggi, transizioni e outbox |
| Profilo e preferiti | Dati personali dell'account, controlli onboarding e lista personale |
| Amministrazione del portale | Abilitazioni, segnalazioni e blocchi; niente lettura ordinaria delle conversazioni |
| Dispatcher | Presa in carico dell'outbox e invio alle tre code previste |
| Worker media | Versioni del bucket ingresso, esiti scansione, contenuti verificati e stato media |
| Worker notifiche | Contesto necessario agli avvisi, SES e registro delle notifiche |
| Worker di servizio | Visite invalidate, riconciliazione e cleanup autorizzato |

IAM controlla i servizi AWS, non le righe PostgreSQL. Nel database si usano utenze per responsabilità con permessi SQL distinti; il catalogo pubblico non usa un'utenza capace di leggere messaggi o documenti interni. La selezione dell'agenzia e dei partecipanti resta responsabilità dei moduli applicativi.

Si sceglie autenticazione IAM da Lambda verso RDS Proxy e credenziali database in Secrets Manager per il collegamento proxy–Aurora. Il ruolo Lambda può connettersi soltanto come utenza prevista. Il proxy riceve i permessi per i segreti necessari; password e account amministrativo del database non sono condivisi fra tutte le funzioni. Rotazione e compatibilità vanno verificate con driver e versione del motore. [Configurazione IAM del proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-iam-setup.html).

Secrets Manager conserva anche la chiave privata del firmatario CloudFront. Non si mette il valore nei file di configurazione pubblici o nel codice; il backend lo riusa per un periodo limitato e gestisce rotazione e sovrapposizione delle chiavi. Cambiare una chiave non deve produrre indisponibilità per tutte le firme legittime senza una procedura pianificata. [Rotazione dei segreti](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html).

Per i dati a riposo si richiede cifratura sui servizi che li conservano; la chiave personalizzata KMS non viene aggiunta per ogni risorsa senza un'esigenza di gestione separata. TLS protegge browser–servizi e connessioni database. La cifratura non concede automaticamente accesso: un ruolo deve essere autorizzato anche a leggere la risorsa.

## 5. Ingressi, contenuti e antiabuso

WAF protegge frontend e REST API come già progettato. Si aggiunge un'associazione regionale al User Pool Cognito, separata dal frontend, per i percorsi di login supportati. Si scelgono regole compatibili con il provider e si evita un CAPTCHA indiscriminato che possa interrompere registrazione e configurazione TOTP. WAF non protegge genericamente tutte le operazioni amministrative IAM sul pool. [WAF per Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-waf.html).

L'applicazione usa query parametrizzate, serializzazione esplicita e testo senza HTML arbitrario in descrizioni e messaggi. L'interfaccia non inserisce contenuto ricevuto come codice eseguibile. Header di sicurezza e Content Security Policy saranno configurati con le origini effettive di hosting, login, API e media, verificando che non blocchino il percorso legittimo.

Si fissano come limiti applicativi iniziali **venti nuovi contatti al giorno per account**, **sessanta messaggi in un'ora per account** e **dieci intenti di upload al minuto per account professionale**. Si applicano sul backend con conteggi consistenti; messaggi ripetuti con lo stesso identificativo di invio non consumano nuovamente il limite. Una richiesta di visita su un contatto esistente non viene contata come un nuovo contatto, ma resta soggetta al vincolo di visita attiva e ai controlli di invio.

**Motivazione:** questi limiti contrastano invii massivi senza aggiungere un sistema commerciale di quote. Sono soglie operative iniziali, non garanzie del provider; possono limitare un uso intenso legittimo e saranno verificate con i casi del personale. Il limite di messaggi vale anche al personale, il cui uso massivo non è nel perimetro iniziale.

Le regole per IP partono con osservazione prima del blocco: un indirizzo può rappresentare un'intera agenzia. Limiti globali di API Gateway, quote account e concorrenza devono sostenere il picco previsto; i rate limit per singolo account non sono un tetto al costo del portale. Un errore di sicurezza non va registrato con payload o credenziali completi.

Gli inviti aziendali scadono dopo **settantadue ore** e vengono conservati come digest del token, cioè un valore che permette la verifica senza memorizzare il collegamento utilizzabile. Si verifica destinatario con email confermata, stato, scadenza e uso precedente. Una nuova emissione revoca quella pendente. Settantadue ore permettono un'accettazione non immediata, limitando la durata della credenziale.

## 6. Interventi straordinari e incidenti

Un amministratore del portale non usa le proprie schermate ordinarie per leggere conversazioni private. Un accesso straordinario richiede una pratica con scopo, risorse coinvolte, autorizzazione e durata; viene eseguito tramite un ruolo operativo temporaneo con accessi mirati e audit. Il referente operativo che autorizza è distinto da chi esegue, anche se queste responsabilità sono ipotetiche nel progetto scolastico.

**Motivazione:** separare il percorso straordinario evita un privilegio permanente su tutti i contatti. Non impedisce tecnicamente ogni abuso da parte di identità infrastrutturali molto privilegiate: restrizioni IAM, approvazioni e audit devono coprire anche quelle identità.

In caso di sospetta compromissione si bloccano account o workload coinvolti, invalidano le sessioni o firme secondo il caso, preservano le evidenze necessarie e verificano gli effetti su dati e outbox prima della riapertura. Ripristinare un backup non rimuove una credenziale compromessa. Il [piano operativo](13-osservabilita-e-piano-operativo.md) definisce presa in carico, responsabilità e recupero; copertura effettiva ed escalation restano da organizzare.

## 7. Dati personali: finalità e responsabilità

Si raccolgono solo dati necessari a account, annunci, contatti, abilitazione delle agenzie e protezione del servizio. Il proprietario dell'immobile non diventa automaticamente un'entità con documenti identificativi da acquisire; non si aggiungono scansioni di documenti personali per la verifica dell'agenzia prima di averne motivato la necessità.

Il catalogo espone i soli contenuti selezionati; contatti e conversazioni restano privati. Test e presentazione usano dati sintetici. Non si copiano dati di produzione negli ambienti inferiori come operazione ordinaria.

Prima di un servizio reale occorre definire chi decide finalità e trattamento dei dati del portale e delle singole agenzie, quali basi si applicano, quali informative consegnare e quali accordi servano con i fornitori. Non si considera la scelta di Francoforte o la cifratura come prova di conformità. Il principio da applicare è limitare dati e durata alla finalità dichiarata. [Principi della Commissione europea](https://commission.europa.eu/law/law-topic/data-protection/reform/rules-business-and-organisations/principles-gdpr/overview-principles/what-data-can-we-process-and-under-which-conditions_en).

**Motivazione:** la separazione tecnica fra agenzie non risolve da sola le responsabilità sul trattamento. La documentazione scolastica deve rappresentare questi punti senza inventare una qualifica giuridica o una durata obbligatoria per tutti i dati.

## 8. Conservazione proposta e cancellazione

Le durate sotto sono **proposte operative**, non scadenze imposte dalla normativa. Dovranno essere validate rispetto a finalità e obblighi applicabili prima di essere adottate in un servizio reale.

| Dato | Proposta iniziale | Motivo e condizione |
| --- | --- | --- |
| Contatti, messaggi e visite | Dodici mesi dall'ultima attività, per contatti chiusi e senza visite attive | Consentire consultazione recente evitando storico personale illimitato; riapertura rinvia la scadenza |
| Annunci conclusi e immobili non più utilizzati | Revisione dopo ventiquattro mesi dall'uscita dal mercato | Rimuovere dati non più necessari; conservare soltanto quanto motivato dai riferimenti residui |
| Preferiti | Fino alla rimozione o cancellazione dell'account | Dato personale controllato dall'utente |
| Inviti non più validi | Trenta giorni dopo uso, revoca o scadenza | Diagnostica breve; lo storico dell'assegnazione rimane separato |
| Esiti delle notifiche e outbox concluse | Trenta giorni dal completamento, dopo verifica del recupero | Non eliminare lavoro pendente, in DLQ o con esito incerto |
| Log applicativi | Trenta giorni | Diagnostica ordinaria, senza contenuti privati |
| Audit di sicurezza e interventi amministrativi | Dodici mesi | Ricostruzione degli accessi e delle operazioni sensibili |
| Backup database e file | Sette giorni, secondo i documenti di persistenza e media | Finestra di recupero, distinta dai tempi delle copie operative |

Non si cancella una relazione in cascata senza esaminare i dati condivisi: un messaggio può appartenere alla storia della richiesta di entrambe le parti. Una cancellazione dell'account blocca subito accesso e nuovi avvisi e avvia la verifica dei dati da eliminare, anonimizzare o conservare con motivazione. Preferiti e credenziali dell'account vengono rimossi quando il percorso è completato; l'eventuale attribuzione storica usa un riferimento non direttamente identificativo solo dove ancora necessario.

Quando una richiesta di cancellazione è accolta, il job elimina le copie operative interessate, i riferimenti ricercabili e i file non più necessari. L'anonimizzazione non consiste nel solo cambio del nome: testo libero, indirizzi e allegati possono ancora identificare una persona. Esportazione e rettifica richiedono verifica dell'identità e controllo dei dati relativi ad altri partecipanti. [Diritti e gestione delle richieste — EDPB](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en).

Le copie di backup non sono utilizzate per la consultazione ordinaria e scadono nella finestra prevista. Si conserva un registro operativo minimo delle cancellazioni accolte, distinto dalle copie da ripristinare e privo del contenuto eliminato: dopo un restore si riapplicano le cancellazioni prima di riaprire l'accesso. Protezione, durata e collocazione di questo registro saranno parte della procedura di recupero.

**Motivazione:** cancellazione operativa e ripristino devono essere progettati insieme, altrimenti un backup può far ricomparire dati già eliminati. Il registro minimo è a sua volta un dato da proteggere; non giustifica conservazione indefinita dell'identità.

## 9. Verifiche e confini del lavoro

Le verifiche successive includeranno onboarding con token iniziali, login MFA, logout da più schede, refresh e revoca, ruolo cambiato durante una richiesta, accesso a risorse di altre agenzie, download con firma residua, regole WAF compatibili con TOTP, log privi di segreti e cancellazioni dopo restore.

Restano da completare prove dei flussi Cognito sul piano scelto, configurazioni effettive CSP/WAF/IAM, evidenze per il recupero MFA e per l'abilitazione delle agenzie, responsabilità privacy e validazione delle durate proposte. Non si marca il progetto come conforme o sicuro soltanto perché usa servizi gestiti.

Il [piano di osservabilità e gestione operativa](13-osservabilita-e-piano-operativo.md) collega i requisiti a misure, allarmi e procedure di recupero, con responsabilità ipotetiche per la presentazione. Le procedure includono la riapplicazione delle cancellazioni e delle revoche prima di riaprire il servizio.
