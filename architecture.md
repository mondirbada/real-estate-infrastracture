## Soluzione

Per questa soluzione ho pensato la seguente modalità.

### FRONTEND

Il frontend sarà gestito interamente da 2 servizi aws.

- **CloudFront**
Servizio che permette di distribuire un sito web statico e dinamico agli utenti.
*CloudFront* inoltre gestisce la modalità per il trasporto del contenuto, cercando
di mantenere una latenza di rete più bassa possibile.

Se il contenuto è già presente nela località di richiesta, esso verrà spedito
nell'immediato, altrimenti recupera il contenuto dove è stato hostato.

- **S3 (Simple Storage Service)**
Come dice il nome S3 è un servizio per salvare file su cloud.
Nel nostro caso è utilizzato in coppia con CloudFront, per recuperare il sito.

Quindi *CloudFront* si occupa di rendere il sito accessibile dal web;
Invece *S3* ha il compito di mantenere disponibili i file del sito per *CloudFront*.

### BACKEND

Il backend ho deciso di dividerlo in 2 sezioni principali, visto che in realtà
gestiscono due sezioni ben definite.

#### ROUTING & AUTH

Il routing e l'auth utilizzano 3 servizi:

- **API Gateway**
Il gateway dirige il traffico e spedisce le richieste alle lambda corrette.

- **Cognito**
Cognito è utilizzato per gestire l'autenticazione degli utenti.

- **Lambda Authorizer**
Questa lambda viene utilizzata per la gestione di permessi e ownership delle proprietà.

*CloudFront* utilizza l'autenticazione tramite *Cognito*, mentre l'*API Gateway* utilizza
le chiavi di Cognito per validare i token JWT, mentre la *Lambda Authorizer* autorizza
l'accesso delle richieste alle varie lambde.

#### BUSINESS LOGIC

All'interno del **BACKEND** utilizziamo al momento 4 lambde, una per ogni *scope*
dell'applicativo, in questo caso *Proprietà*, *Utenti*, *Offerte* e *Media e File*.

All'interno di ogni lambda ci sarà un handler che farà da routing interno dello *scope*.
Per esempio, parlando della lambda degli utenti, all'interno ci sarà l'handler che
processerà l'evento arrivato, successivamente farà del routing interno e processerà
le informazioni nella maniera corretta, come eventi `UpdateUserInformation` o `DeleteUser`.

### DATABASE & STORAGE

Per il lato del database utilizziamo due servizi: *RDS Proxy* e *Aurora PostgreSQL*.
L'*RDS Proxy* serve per gestire le numerose connessioni che le lambda possono creare.

**NOTE**
Questo servizio non è strettamente necessario, visto che il traffico non sarà così
elevato da dover gestire una moltitudine di connessioni, ma per sicurezza abbiamo
deciso di implementarlo nella soluzione.

Il database scelto è *Aurora PostgreSQL*, visto che nell'applicazione ci sono relazioni
tra diverse entità e un quantitativo di dati possibilmente elevato.

Per lo storage di immagini, video o qualsiasi altro file direttamente caricato da un utente
è disponibile un ulteriore *S3*, eventualmente limitato per i file e le loro dimensioni.

### NOTIFICATION SYSTEM

Il sistema di notifiche è gestito in maniera molto semplice e diretta.
Ogni lambda, quando opportuno, invia un evento all'*EventBridge*, che lo invia ad
una coda *SQS (Simple Queue Service)*.

Ad ascoltare quel canale ci sarà una *Notification Lambda* che si affianca al servizio
*Amazon SES (Simple Email Service)*, che penserà ad inviare email quando necessario.
