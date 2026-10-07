# Domora — Attori e permessi

Questo documento definisce chi può eseguire le operazioni del [perimetro del prodotto](01-prodotto-e-perimetro.md). Le regole sono funzionali; la realizzazione progettata è descritta in [Accesso e API](08-accesso-frontend-e-api.md), [Persistenza](09-persistenza-e-ricerca.md) e [Sicurezza](12-sicurezza-e-protezione-dati.md).

## 1. Account e appartenenza all'agenzia

Ogni persona utilizza un account personale. Nella base iniziale, un account professionale appartiene a una sola agenzia e ha un ruolo di operatore o responsabile. Può usare anche preferiti e richieste come utente interessato, senza trasferire i privilegi professionali su queste funzioni personali.

Il responsabile invita gli operatori tramite email. L'invito deve essere accettato con un account che abbia verificato lo stesso indirizzo e completato il percorso di sicurezza; il ruolo è assegnato dal sistema secondo l'invito, non scelto dal destinatario. Un invito già utilizzato, scaduto o revocato non concede accesso. Durata di settantadue ore e autenticazione recente per la gestione dei ruoli sono definite nella [sicurezza](12-sicurezza-e-protezione-dati.md).

**Motivazione:** un'appartenenza professionale unica evita selezione del contesto e combinazioni di ruoli fra agenzie. Il limite è l'esclusione iniziale degli operatori che lavorano contemporaneamente per più agenzie. Gli account personali e gli inviti evitano credenziali condivise.

Il responsabile può revocare un'appartenenza. L'account personale rimane, ma perde l'accesso professionale; immobili e annunci restano dell'agenzia. Le richieste assegnate alla persona revocata tornano da assegnare al responsabile.

L'amministratore abilita il primo responsabile; un responsabile può designarne un altro nella stessa agenzia. Non può essere rimosso l'ultimo responsabile di un'agenzia attiva senza una sostituzione. L'accesso amministrativo del portale è un privilegio separato, che non si ottiene tramite invito aziendale.

## 2. Matrice dei permessi

“Propri” indica i dati personali dell'account; “agenzia” indica esclusivamente l'agenzia di appartenenza attiva. Il responsabile comprende i permessi dell'operatore. L'amministratore può usare il catalogo pubblico come chiunque, ma il suo ruolo non concede automaticamente i privilegi professionali.

| Operazione | Visitatore | Utente registrato | Operatore | Responsabile | Amministratore |
| --- | --- | --- | --- | --- | --- |
| Cercare e consultare annunci pubblicati | Sì | Sì | Sì | Sì | Sì |
| Gestire preferiti | No | Propri | Propri | Propri | Propri, con account |
| Inviare richieste | No | Proprie | Proprie | Proprie | Proprie, con account |
| Leggere richieste e risposte come interessato | No | Proprie | Proprie | Proprie | Proprie, con account |
| Creare e modificare immobili e bozze | No | No | Agenzia | Agenzia | No |
| Caricare immagini e documenti | No | No | Agenzia | Agenzia | No |
| Pubblicare, aggiornare, ritirare e concludere annunci | No | No | Agenzia | Agenzia | No |
| Leggere e gestire richieste come personale | No | No | Assegnate | Tutte dell'agenzia | No ordinario |
| Assegnare e riassegnare richieste | No | No | No | Agenzia | No |
| Invitare, revocare e gestire ruoli professionali | No | No | No | Agenzia | Primo responsabile e interventi motivati |
| Abilitare o disabilitare un'agenzia | No | No | No | No | Sì |
| Leggere contenuti dell'annuncio per una segnalazione | No | Solo pubblici | Agenzia | Agenzia | Sì, nel caso in esame |
| Sospendere un annuncio e revocare la sospensione | No | No | No | No | Sì |

Gli operatori condividono la gestione del catalogo della propria agenzia: non esiste un proprietario individuale che impedisca ai colleghi di aggiornare un annuncio. Per le richieste, invece, l'assegnazione limita l'accesso dell'operatore al lavoro di cui è responsabile.

**Motivazione:** un catalogo condiviso facilita la sostituzione fra colleghi; l'accesso mirato ai contatti riduce la diffusione dei dati personali. Il responsabile mantiene una vista complessiva per coordinare il lavoro.

## 3. Controlli su ogni operazione

Per un'operazione professionale il backend verifica:

1. Identità del chiamante e appartenenza ancora attiva.
2. Ruolo necessario all'operazione.
3. Appartenenza della risorsa alla stessa agenzia.
4. Stato della risorsa e dell'agenzia, secondo il [flusso di pubblicazione](03-flusso-pubblicazione.md).
5. Assegnazione al chiamante, quando si tratta di una richiesta gestita da un operatore.

Il semplice possesso di un identificativo o di un token di accesso non autorizza l'operazione. L'agenzia competente viene ricavata dalla risorsa e dall'appartenenza verificata; non basta un identificativo di agenzia inviato dal browser.

**Motivazione:** nascondere pulsanti nell'interfaccia non protegge i dati. I controlli sul backend impediscono accessi a risorse altrui anche quando il client viene modificato. La revoca deve essere considerata dalle operazioni successive anche se il token di autenticazione non è ancora scaduto.

## 4. Dati pubblici e riservati

La zona pubblica indica comune e paese, senza coordinate o mappa nella base iniziale, come definito in [Ricerca e preferiti](05-ricerca-e-preferiti.md). L'indirizzo esatto rimane riservato per impostazione iniziale; l'agenzia può scegliere esplicitamente di pubblicarlo nell'annuncio oppure comunicarlo privatamente nella conversazione per la visita.

Le immagini diventano pubbliche solo se selezionate nel contenuto pubblicato e se hanno superato i controlli previsti. I documenti allegati rimangono interni all'agenzia nella base iniziale: non sono esposti nel catalogo o agli interessati.

**Motivazione:** la selezione esplicita evita che tutto ciò che viene caricato diventi pubblico. Tenere i documenti interni limita il rischio di esporre dati personali e riduce i percorsi di condivisione da progettare.

I dati riservati non devono finire nell'indice pubblico di ricerca, nelle risposte pubbliche o nelle email di avviso. L'amministratore può esaminare il contenuto contestato di un annuncio, ma non riceve accesso ordinario a documenti interni e conversazioni. Eventuali accessi straordinari devono essere autorizzati, motivati e tracciati; il percorso è definito nella [sicurezza](12-sicurezza-e-protezione-dati.md), con responsabilità ipotetiche nel [piano operativo](13-osservabilita-e-piano-operativo.md).

## 5. Tracciabilità e confini

Le operazioni rilevanti registrano almeno attore, agenzia o risorsa coinvolta, momento, azione ed esito. Sospensioni, revoche e interventi amministrativi includono la motivazione. Lo storico serve a ricostruire chi ha agito, senza copiare indiscriminatamente dati sensibili nei log.

La [sicurezza](12-sicurezza-e-protezione-dati.md) definisce durata degli inviti, MFA, sessioni e percorso degli accessi straordinari, distinguendo le proposte di conservazione dai controlli tecnici. Evidenze di recupero dell'accesso e responsabilità operative restano da precisare. Il [flusso di contatti e visite](04-contatti-e-visite.md) definisce transizioni e operazioni dei partecipanti entro i confini di accesso della matrice.
