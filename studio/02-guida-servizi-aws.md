# Guida di studio — i servizi del progetto e come si parlano

Come usarla: per ogni servizio trovi **cosa è**, **come funziona**, **concetti da sapere**, **come si collega agli altri**, **sicurezza/IAM**, **costi e limiti**, **domande da orale**. Ti aggancio dove posso a cose che conosci già (Spring Boot, Docker, Nginx, PostgreSQL).
Prima leggi la sezione 0 (mappa), poi i servizi nell'ordine del percorso di una richiesta. L'IAM ha il suo file (`03-iam-ruoli-policy-trust.md`): è la parte su cui il professore insisterà, studiala per ultima ma con calma.

---

## 0. La mappa: cosa succede quando un utente usa il sito

```
Browser
  │ 1. scarica la SPA (HTML/JS)
  ▼
CloudFront ──(OAC)──► S3 (bucket sito, privato)
  │
  │ 2. login: la SPA parla con Cognito → riceve JWT (ID, access, refresh token)
  ▼
Cognito User Pool
  │
  │ 3. chiamata API con header Authorization: Bearer <JWT>
  ▼
API Gateway ──(valida JWT)──► Lambda (Property / User / Offers / Files)
                                   │ (in VPC)            │ (altri servizi)
                                   ▼                      ├─► EventBridge ─► SQS ─► Notification Lambda ─► SES (email)
                              RDS Proxy ─► Aurora         └─► Presigned Lambda ─► URL firmato ─► Browser ─► S3 (bucket file)
                                   │
                              Secrets Manager (letto dal proxy)
```

Tre idee da avere in testa:
1. **Frontend statico** (CloudFront+S3): nessun server, la logica è nel browser.
2. **Backend serverless** (API Gateway+Lambda): paghi per richiesta, AWS gestisce i server.
3. **Dati stateful** (Aurora, S3): lo stato sta qui, non nelle Lambda (che sono effimere).

Concetti trasversali:
- **Regione**: area geografica (`eu-south-1` = Milano). **AZ** (Availability Zone): data center isolato dentro la regione; progettare su 2 AZ significa sopravvivere alla caduta di uno.
- **Servizio regionale vs globale vs in-VPC**: CloudFront e IAM sono globali; S3, SQS, SES, API Gateway, Cognito, Lambda sono regionali e vivono **fuori** dalla tua VPC; solo RDS, RDS Proxy, ENI delle Lambda e gli endpoint vivono **dentro** la VPC. Questa distinzione spiega quando servono security group, subnet, endpoint.
- **Modello di responsabilità condivisa**: AWS protegge l'infrastruttura (data center, hypervisor); tu proteggi configurazione, IAM, dati, codice.
- **Principio del minimo privilegio**: ogni componente ha solo i permessi che gli servono.

---

## 1. Rete: VPC, subnet, AZ, security group, endpoint

**Cosa è.** Una **VPC** (Virtual Private Cloud) è la tua rete privata isolata dentro AWS, con un intervallo di indirizzi (CIDR, es. `10.0.0.0/16`). Pensa a una rete Docker (`docker network`) ma con regole e routing molto più ricchi.

**Pezzi:**
- **Subnet**: porzione della VPC, **legata a una sola AZ**. È "pubblica" se la sua route table ha una rotta `0.0.0.0/0` → **Internet Gateway (IGW)**; altrimenti è "privata".
- **Route table**: dice dove va il traffico verso quale destinazione.
- **Internet Gateway**: porta tra la VPC e Internet (serve IP pubblico per usarlo).
- **NAT Gateway**: sta in una subnet pubblica e permette alle risorse private di **uscire** verso Internet senza essere raggiungibili da fuori. Costa (orario + traffico) ed è per AZ.
- **Security group (SG)**: firewall **stateful** attaccato a una ENI (Lambda in VPC, RDS, proxy, endpoint). Solo regole *allow*. Si può referenziare un SG come sorgente di un altro (`sg-rds` accetta 5432 solo da `sg-rds-proxy`): è più robusto degli IP.
- **Network ACL**: firewall **stateless** a livello di subnet, con allow e deny. Di solito si lascia il default.
- **ENI** (Elastic Network Interface): "scheda di rete virtuale". Una Lambda in VPC ottiene ENI nelle subnet scelte.
- **VPC endpoint**: accesso privato ai servizi AWS senza passare da Internet.
  - **Gateway endpoint**: solo S3 e DynamoDB, gratuito, funziona con una rotta nella route table.
  - **Interface endpoint** (AWS PrivateLink): una ENI con IP privato per il servizio (EventBridge, SQS, Secrets Manager, ecc.). Costo orario per AZ + per GB.

**Nel progetto.** Una VPC con due subnet private (una per AZ). Dentro: Aurora (writer AZ-1, replica AZ-2), RDS Proxy, Lambda che accedono al DB. Fuori dalla VPC: tutto il resto.

**Punti chiave per l'orale:**
- Perché subnet private per il DB? Non deve essere raggiungibile da Internet; l'accesso passa solo dal proxy.
- Perché 2 AZ? Il DB subnet group di RDS richiede ≥2 AZ; la resilienza ai guasti.
- Una Lambda in VPC ha accesso a Internet? **No**, nemmeno in subnet pubblica. O NAT, o endpoint.
- Perché niente NAT? Non si chiamano API esterne.
- Gli SG si possono mettere su S3/SQS/API Gateway? **No**: non hanno ENI nella tua VPC.

**Domande tipo:** differenza SG/NACL (stateful/stateless, livello ENI/subnet). Differenza endpoint gateway/interface. Cosa rende "pubblica" una subnet.

---

## 2. CloudFront

**Cosa è.** La **CDN** di AWS: una rete di punti di presenza (**edge location**) nel mondo che mettono in cache i contenuti vicino all'utente. Equivalente: un Nginx reverse proxy con cache, ma globale e gestito.

**Come funziona.** Crei una **distribuzione** con una o più **origin** (qui un bucket S3). Alla richiesta: l'edge guarda la cache; se c'è (**cache hit**) risponde subito; se no (**cache miss**) va all'origin, salva la risposta secondo le regole di cache (TTL) e risponde. Si può invalidare la cache (`/*`) quando pubblichi una nuova versione.

**Concetti:**
- **Behavior**: regole per path pattern (es. `/*` → bucket sito; `/files/*` → bucket file).
- **Cache policy / origin request policy**: cosa entra nella chiave di cache (header, query string, cookie).
- **OAC (Origin Access Control)**: CloudFront firma le richieste (SigV4) verso S3, e la bucket policy ammette solo quella distribuzione. Sostituisce il vecchio OAI.
- **HTTPS**: certificato gratuito in **ACM**; per CloudFront deve stare in **us-east-1**. Senza dominio custom si usa `xxxx.cloudfront.net`.
- **Default root object** (`index.html`) e **error pages** custom: per una SPA con routing lato client mappa 403/404 su `/index.html` con codice 200.
- **WAF** si può associare a CloudFront (firewall applicativo: rate limiting, regole OWASP).
- **Lambda@Edge / CloudFront Functions**: codice agli edge (non presente nel progetto).

**Collegamenti.** Origin = S3 (sito). Eventualmente anche per servire i file/immagini del secondo bucket. CloudFront **non** parla con Cognito né con le Lambda: l'API è su API Gateway, chiamata direttamente dal browser.

**Sicurezza/IAM.** Il permesso per leggere da S3 sta nella **bucket policy** (principal `cloudfront.amazonaws.com`, condizione `AWS:SourceArn` = ARN della distribuzione). Nessun ruolo IAM lato CloudFront.

**Costi.** Si paga il trasferimento verso Internet e le richieste; c'è un livello gratuito mensile.

**Orale:** perché CloudFront e non S3 pubblico? HTTPS con dominio, cache/latency, bucket privato, WAF. Cosa succede dopo un deploy? Invalidazione. Cosa è un edge?

---

## 3. S3 (Simple Storage Service)

**Cosa è.** **Object storage**: salvi *oggetti* (file + metadati) in *bucket*, accessibili via API HTTP. Non è un filesystem (non c'è cartella vera: la chiave è una stringa, `prefisso/nome.jpg`). Durabilità 99,999999999% (11 nove), dati replicati su più AZ (nelle classi standard).

**Concetti:**
- **Bucket**: nome univoco globale, legato a una regione. **Object key**: percorso logico.
- **Block Public Access**: interruttore di sicurezza; lasciatelo **attivo** sui bucket del progetto.
- **Bucket policy** (resource-based) e **ACL** (legacy, disabilitate di default: *Object Ownership: bucket owner enforced*).
- **Versioning**, **lifecycle rules** (spostare/cancellare oggetti dopo N giorni, anche cancellare upload incompleti), **classi di storage** (Standard, IA, Glacier…).
- **Cifratura a riposo**: SSE-S3 di default (gratis); SSE-KMS se vuoi controllo sulla chiave.
- **CORS**: serve se il browser carica/scarica direttamente da S3 da un'altra origin (caso degli upload presigned).
- **Eventi S3**: notifiche su `ObjectCreated` verso Lambda/SQS/EventBridge (per es. generare miniature).
- **Presigned URL**: URL temporaneo che dà accesso a *un* oggetto con i permessi di **chi lo ha firmato**, per un tempo limitato. Nel progetto serve per far caricare file **direttamente dal browser a S3** senza farli passare dalla Lambda (limite payload API Gateway 10 MB e Lambda 6 MB sincrona!).
  - Presigned **PUT**: semplice, ma non limita la dimensione.
  - Presigned **POST**: permette *conditions* come `content-length-range` e tipo di contenuto.

**Nel progetto: due bucket.**
1. **Sito** (privato, letto da CloudFront con OAC).
2. **File utente** (immagini/video/documenti degli immobili), scritti via presigned URL.

**Collegamenti.** CloudFront → S3 (OAC). Presigned Lambda firma l'URL → il browser fa PUT/POST su S3. Dal VPC, S3 si raggiunge con **gateway endpoint** gratuito.

**Sicurezza.** Block Public Access, bucket policy minima, cifratura, prefisso per utente, scadenza breve dei presigned, validazione tipo/dimensione, eventuale scansione antivirus (sviluppo futuro).

**Orale:** differenza oggetto/file; perché presigned invece di passare dalla Lambda; che permessi ha un presigned URL (quelli del firmatario); perché il bucket sito è privato.

---

## 4. Cognito (User Pool)

**Cosa è.** Servizio di **identità e autenticazione**: registrazione, login, verifica email, reset password, MFA. Equivalente: Spring Security + un authorization server (Keycloak) gestito.

**Due componenti, da non confondere:**
- **User pool**: directory utenti + emissione di token JWT. **È quello che usate.**
- **Identity pool** (federated identities): scambia un token con **credenziali AWS temporanee** per accedere direttamente a servizi AWS (es. upload su S3 dal browser). Non serve se usate presigned URL.

**Come funziona il login (OIDC/OAuth 2.0).** L'utente si autentica (hosted UI o chiamando l'SDK); Cognito risponde con 3 token:
- **ID token** (JWT): *chi è* l'utente (claim `sub`, `email`, `cognito:groups`).
- **Access token** (JWT): *cosa può fare* (scope), da mandare alle API.
- **Refresh token**: per ottenere nuovi token senza rifare il login.
Un JWT è `header.payload.firma`: la firma si verifica con la chiave pubblica del pool pubblicata nel **JWKS** (`.well-known/jwks.json`). Per questo API Gateway valida il token **senza chiamare Cognito a ogni richiesta**.

**Concetti:**
- **App client**: configurazione dell'app (SPA = client pubblico, **senza** secret) con flow consentiti; per le SPA si usa il code flow con **PKCE**.
- **Gruppi**: ruoli applicativi (`agent`, `buyer`, `admin`); finiscono nel claim `cognito:groups`.
- **Trigger Lambda** (pre-signup, post-confirmation, pre-token-generation…): per es. creare la riga utente nel DB dopo la conferma.
- **Attributi custom**, policy password, verifica email via SES.

**Collegamenti.** SPA ↔ Cognito per il login. Cognito → API Gateway: l'authorizer di API Gateway usa il pool (issuer + JWKS) per validare i JWT. Cognito può usare SES per le email di verifica (con le limitazioni di quota di default).

**Sicurezza/IAM.** Non servono ruoli per il solo user pool + JWT. I ruoli compaiono con le identity pool o con i trigger Lambda (che sono Lambda con permessi di invocazione dal servizio Cognito: resource-based policy sulla Lambda).

**Cosa sapere sulla rete.** Le Lambda in VPC non hanno bisogno di chiamare Cognito. PrivateLink per Cognito user pool esiste (dal 2025) ma ha limiti con hosted UI / domini: non è necessario qui.

**Orale:** differenza user pool / identity pool; ID token vs access token; come API Gateway valida il JWT; dove metti i ruoli utente; perché la SPA non ha client secret.

---

## 5. API Gateway

**Cosa è.** Il "portone" HTTP del backend: espone endpoint pubblici, applica autenticazione, throttling, validazione, e **inoltra** alla Lambda. Equivalente: un reverse proxy / Spring Cloud Gateway gestito.

**Tipi:**
- **HTTP API**: più semplice, più economica, con JWT authorizer nativo, CORS integrato, Lambda proxy payload 2.0. Meno funzioni.
- **REST API**: più ricca (API keys e usage plan, validazione richieste, WAF, cache, Cognito authorizer nativo, canary).
- (WebSocket API: non usata.)
Per questo progetto l'**HTTP API** è la scelta di default; la REST serve se volete usage plan/WAF diretto. Sapete motivare la scelta.

**Concetti:**
- **Route** (`GET /properties/{id}`) → **integration** (Lambda **proxy**: passa l'intero evento HTTP alla Lambda e la Lambda ritorna status/header/body).
- **Stage** (`prod`), **deployment**, variabili di stage.
- **Authorizer**: JWT (Cognito) oppure Lambda (token o request based, con cache dei risultati).
- **CORS**: va configurato perché la SPA (origin CloudFront) chiama l'API (altro dominio).
- **Throttling** (rate/burst), **access log** su CloudWatch, **custom domain** (certificato ACM nella stessa regione per le API regionali).
- Limiti: timeout integrazione ~29 secondi (30 s per HTTP API), payload 10 MB.

**Collegamenti.** Riceve richieste dal browser → valida JWT con Cognito (issuer/JWKS) → invoca la Lambda corretta.
**Sicurezza/IAM.** Per invocare la Lambda serve una **resource-based policy sulla Lambda** con principal `apigateway.amazonaws.com` (la crea la console quando aggiungi la route; in IaC va scritta). L'authorizer JWT non necessita di ruoli.

**Orale:** cosa è la Lambda proxy integration; perché il token non viene validato da Cognito a ogni chiamata; HTTP API vs REST API; come si gestisce CORS; cosa succede se la Lambda impiega più di 30 s.

---

## 6. Lambda

**Cosa è.** Funzioni **serverless**: carichi codice, AWS lo esegue **su evento** in ambienti isolati, scalando da 0 a molte istanze, e paghi per millisecondi di esecuzione e memoria. Equivalente: un singolo endpoint/metodo di un controller Spring, senza il server.

**Modello di esecuzione:**
- **Handler**: la funzione di ingresso (`event`, `context`).
- **Execution environment** (micro-VM): creato al primo uso (**cold start**: scarica codice, avvia runtime, esegue init), poi **riusato** (warm) per richieste successive. Variabili fuori dall'handler (es. connessione DB) sopravvivono tra invocazioni warm.
- **Concorrenza**: una istanza gestisce una richiesta alla volta; più richieste simultanee = più istanze. Si può limitare (*reserved concurrency*) o pre-scaldare (*provisioned concurrency*).
- **Configurazione**: memoria (128 MB–10 GB; la CPU scala con la memoria), timeout (max 15 min), variabili d'ambiente, layer, architettura (x86/ARM Graviton, più economica).
- **Modelli di invocazione**: *sincrona* (API Gateway), *asincrona* (EventBridge, S3, con retry e DLQ/destination), **event source mapping** (la Lambda *legge* da SQS/Kinesis/DynamoDB streams a batch).
- **Versioni e alias**: pubblichi versioni immutabili, un alias (`prod`) punta a una versione.

**Lambda in VPC.** Configurando subnet+security group, Lambda crea **ENI** (Hyperplane ENI, condivise: oggi l'impatto sul cold start è ridotto). Effetti: può raggiungere RDS Proxy; **perde l'accesso diretto a Internet e ai servizi AWS pubblici**, a meno di NAT o endpoint. Quindi: metti in VPC **solo chi parla con il DB**.

**Nel progetto.**
- Property / User / Offers / Files Lambda: business logic, router interno (stile controller).
- **Presigned Lambda**: firma gli URL S3.
- **Notification/Mailer Lambda**: consuma SQS e chiama SES.
- (Eventuale Lambda Authorizer.)

**Connessione al DB da Lambda: il problema.** Ogni istanza apre la sua connessione; con 200 invocazioni concorrenti si hanno 200 connessioni e PostgreSQL ha un limite (`max_connections`). → **RDS Proxy**. Inoltre: apri la connessione **fuori** dall'handler per riusarla.

**Sicurezza/IAM.** Ogni Lambda ha un **execution role** (trust `lambda.amazonaws.com`) con ciò che può fare; chi può **invocarla** è invece una **resource-based policy** (es. API Gateway, EventBridge). Sono due cose diverse: ruolo = cosa fa *la funzione*, resource policy = chi può *chiamare la funzione*.

**Costi.** Per richiesta + GB-secondo; livello gratuito generoso. Attenzione: Lambda in VPC senza NAT non ha costi di rete extra, ma gli interface endpoint sì.

**Orale:** cosa è un cold start e come lo mitigate; perché la connessione DB va aperta fuori dall'handler; che differenza c'è tra execution role e resource policy; perché non tutte le Lambda sono in VPC; cosa succede se la Lambda va in timeout sotto SQS (il messaggio torna visibile, quindi DLQ).

---

## 7. Aurora PostgreSQL

**Cosa è.** Database relazionale gestito, compatibile con PostgreSQL, con un'architettura propria: **calcolo e storage separati**. Lo storage è un volume distribuito su **3 AZ con 6 copie** dei dati, cresce da solo (fino a 128 TiB). Le istanze (writer e reader) sono solo il livello di calcolo.

**Concetti:**
- **Cluster**: 1 **writer** (istanza primaria) + 0..15 **reader** (repliche). Condividono lo stesso storage, quindi le repliche hanno un lag minimo.
- **Endpoint**: *cluster endpoint* (sempre il writer, anche dopo un failover), *reader endpoint* (bilancia tra i reader), *instance endpoint*.
- **Failover**: se il writer cade, una replica viene promossa in genere in decine di secondi; il cluster endpoint si aggiorna (DNS). Le app devono saper riconnettersi.
- **Backup**: automatici continui (PITR, retention 1–35 giorni) + snapshot manuali.
- **Cifratura**: a riposo con KMS (da scegliere alla creazione), in transito con TLS.
- **Subnet group**: elenco di subnet (≥2 AZ) in cui il cluster può stare.
- **Serverless v2**: capacità in ACU che scala (anche a riposo) invece di istanze a taglia fissa; utile con carichi variabili.
- **Parameter group**: i `postgresql.conf` gestiti.
- **Autenticazione**: password (con Secrets Manager) o **IAM database authentication**.

**Nel progetto.** Un cluster, writer in AZ-1 e replica in AZ-2, in subnet private, raggiungibile **solo dall'RDS Proxy** (SG `sg-rds` accetta 5432 da `sg-rds-proxy`). Dati relazionali: utenti, immobili, offerte (con FK).

**Perché Aurora e non RDS PostgreSQL normale?** Failover più veloce, storage multi-AZ automatico, repliche leggere economiche e rapide; costo più alto. Per un carico piccolo anche RDS PostgreSQL Multi-AZ andrebbe bene: saperlo dire.

**Sicurezza/IAM.** Il ruolo `AWSServiceRoleForRDS` (service-linked role, gestito da AWS) permette al servizio RDS di gestire le risorse di rete e simili: **non** dà accesso ai dati. I permessi sui dati sono `GRANT` SQL su utenti PostgreSQL: IAM non li sostituisce.

**Orale:** che cosa significa storage separato dal calcolo; che differenza c'è tra cluster endpoint e reader endpoint; che cosa succede in un failover; perché l'utente master non si usa nell'app.

---

## 8. RDS Proxy

**Cosa è.** Un **connection pooler** gestito (pensa a PgBouncer/HikariCP, ma come servizio) tra le applicazioni e il database. Mantiene un pool di connessioni verso il DB e le **multiplexa** tra moltissimi client.

**Perché con Lambda.** Molte invocazioni concorrenti × una connessione ciascuna = esaurimento di `max_connections` e DB sotto stress. Il proxy assorbe le connessioni effimere delle Lambda e ne mantiene poche, stabili, verso Aurora. Come bonus riduce il tempo di failover percepito (il proxy mantiene le connessioni dei client mentre si ricollega al nuovo writer).

**Concetti:**
- **Target group**: il cluster Aurora collegato.
- **Autenticazione client → proxy**: password oppure **IAM** (opzione "Require IAM authentication").
- **Autenticazione proxy → DB**: sempre tramite credenziali in **Secrets Manager** (nel modello del progetto), lette con il **ruolo del proxy**.
- **Require TLS**: connessioni cifrate.
- **Connection pinning**: certe operazioni (es. `SET`, prepared statement in certi casi) "attaccano" una connessione al client riducendo il multiplexing; da conoscere.
- **Dimensionamento del pool**: percentuale di `max_connections` che il proxy può usare.
- Vive **solo nella VPC**: non ha endpoint pubblico; richiede subnet in ≥2 AZ e un security group.

**Nel progetto.** Lambda (in VPC) → RDS Proxy (5432, TLS, IAM) → Aurora (password dal secret).

**Autenticazione IAM da Lambda, passo per passo:**
1. L'execution role della Lambda ha `rds-db:connect` su `dbuser:<prx-ID>/<utente>`.
2. Il codice genera un **token di autenticazione** (SDK: `generate-db-auth-token`, firmato con SigV4 con le credenziali del ruolo, valido **15 minuti**) specificando host del proxy, porta, utente.
3. Usa il token **come password** della connessione PostgreSQL via TLS.
4. Il proxy verifica il token con IAM, poi usa le credenziali del secret per parlare con Aurora.
Vantaggio: **nessuna password nel codice o nelle variabili d'ambiente della Lambda**.

**Orale:** perché serve il proxy con le Lambda; che differenza c'è tra autenticazione client→proxy e proxy→DB; a cosa serve il ruolo del proxy; cos'è il token IAM e quanto dura; perché non è strettamente necessario con poco traffico (ed è il motivo per cui lo dichiarate "per sicurezza").

---

## 9. Secrets Manager

**Cosa è.** Archivio **cifrato e versionato** di segreti (password DB, chiavi API) con **rotazione automatica**. Equivalente: Spring Cloud Vault / un file `.env` che però non sta mai nel repo.

**Concetti:**
- **Secret**: JSON (`{"username":"…","password":"…"}`), cifrato con **KMS** (chiave `aws/secretsmanager` oppure CMK).
- **Versioni e stage**: `AWSCURRENT`, `AWSPREVIOUS` (servono alla rotazione senza downtime).
- **Rotazione**: una **Lambda di rotazione** cambia la password nel DB e nel secret secondo una schedule; per RDS esistono template pronti.
- **Resource policy** sul secret (opzionale) per accessi cross-account.
- **Costo**: per secret al mese + per chiamata API. (Alternativa più economica per valori non segreti/semplici: SSM Parameter Store.)
- **Segreto gestito da RDS**: Aurora può creare e ruotare da sola la password master in Secrets Manager.

**Nel progetto.** Un secret per utente PostgreSQL applicativo. Lo legge **il ruolo del proxy** (`secretsmanager:GetSecretValue`), non le Lambda.

**Collegamenti.** Secrets Manager ↔ RDS Proxy; KMS per la cifratura; (futuro) Lambda di rotazione che ha bisogno di accesso di rete al DB e di permessi su secret e KMS.

**Sicurezza.** Nessuna password in Git; accesso con least privilege; per la CMK anche la **key policy** deve permettere l'uso, oltre all'identity policy (con KMS servono *entrambe*, a differenza di IAM ordinario dove nello stesso account può bastare una).

**Orale:** cosa differenza Secrets Manager / Parameter Store; chi legge il secret nel vostro progetto e perché non le Lambda; come funziona la rotazione.

---

## 10. KMS (nel progetto: sullo sfondo)

**Cosa è.** Servizio di gestione delle **chiavi di cifratura**. I servizi (S3, Aurora, Secrets Manager, SQS) cifrano i dati usando chiavi KMS.
- **Chiavi AWS managed** (`aws/s3`, `aws/secretsmanager`): gratis, gestite da AWS.
- **Customer managed key (CMK)**: le crei tu, con **key policy**, rotazione, audit su CloudTrail; ~1 $/mese.
- **Envelope encryption**: KMS cifra una *data key*, la data key cifra i dati.
Il progetto usa le chiavi di default; la CMK è una scelta consapevole (e il file `rds-proxy-decrypt-secrets.json` la prevede).

---

## 11. EventBridge → SQS → Lambda → SES (notifiche)

**EventBridge.** **Bus di eventi**: i produttori inviano eventi JSON (`PutEvents`), le **regole** con *event pattern* li filtrano e li inviano ai **target** (SQS, Lambda, Step Functions…). Disaccoppia chi produce da chi consuma. Equivalente: un event bus applicativo (Spring `ApplicationEventPublisher`) ma distribuito.

**SQS.** **Coda** di messaggi gestita.
- **Standard** (consegna *at-least-once*, ordine non garantito, scala quasi illimitata) o **FIFO** (ordine e deduplicazione, throughput inferiore).
- **Visibility timeout**: quando un consumer prende un messaggio, questo è invisibile per N secondi; se non viene cancellato torna visibile. Deve essere ≥ timeout della Lambda (AWS consiglia 6×).
- **Retention** (fino a 14 giorni), **long polling**.
- **Dead-letter queue (DLQ)**: dopo `maxReceiveCount` tentativi falliti il messaggio va nella DLQ per analisi: **mettetela**.
- Consumer idempotenti: essendo *at-least-once*, lo stesso messaggio può arrivare due volte.

**Lambda come consumer.** Un **event source mapping** fa il polling della coda e invoca la Lambda con un **batch**; se la Lambda ha successo, i messaggi sono cancellati. Si possono usare le *partial batch responses* per non rifare l'intero batch.

**SES.** Servizio di invio email (API o SMTP). Concetti: **identità verificata** (email o dominio, con DKIM/SPF/DMARC), **sandbox** (limiti e solo destinatari verificati finché non chiedi la produzione), reputazione (bounce/complaint), **configuration set**. Disponibile a Milano.

**Perché questa catena?** La richiesta dell'utente non aspetta l'invio email (disaccoppiamento); se SES è lento o giù, la coda trattiene i messaggi (resilienza); il picco di eventi viene assorbito (buffering). EventBridge aggiunge la possibilità di più consumer in futuro.

**IAM.** Lambda produttrici: `events:PutEvents` sul bus (o `sqs:SendMessage`). **Queue policy** sulla coda che permette a `events.amazonaws.com` di scrivere, limitata alla specifica regola con `aws:SourceArn`. La Notification Lambda: `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` + `ses:SendEmail`.

**Orale:** differenza SQS/SNS/EventBridge; cos'è il visibility timeout; a cosa serve la DLQ; cos'è la sandbox SES; perché il consumer deve essere idempotente.
Sul **SNS** del diagramma: SNS è *pub/sub* (push a più sottoscrittori: email, SMS, SQS, HTTP, Lambda). Se non lo usate davvero, toglietelo.

---

## 12. CloudWatch

**Cosa è.** Osservabilità: **Logs** (log group per Lambda, `/aws/lambda/<nome>`), **Metrics** (invocazioni, errori, durata, throttles, CPU del DB, profondità delle code), **Alarms** (soglia → azione, es. notifica SNS), **Dashboards**, **Logs Insights** (query sui log). Le Lambda scrivono i log da sole se il ruolo ha i permessi (`AWSLambdaBasicExecutionRole`).
Collegamenti utili: allarme su `Errors` della Lambda, su `ApproximateNumberOfMessagesVisible` della DLQ, su `CPUUtilization`/connessioni di Aurora.
Per le Lambda in VPC senza accesso a Internet, i log funzionano comunque (il servizio Lambda li invia per te).

---

## 13. Come si collegano: tabella riassuntiva

| Da | A | Come | Chi autorizza |
| --- | --- | --- | --- |
| Browser | CloudFront | HTTPS | pubblico |
| CloudFront | S3 sito | OAC (SigV4) | bucket policy (principal `cloudfront.amazonaws.com`) |
| Browser | Cognito | OIDC / SDK | pubblico (credenziali utente) |
| Browser | API Gateway | HTTPS + JWT | authorizer valida il token |
| API Gateway | Lambda | invoke sincrono | resource policy della Lambda |
| Lambda (VPC) | RDS Proxy | PostgreSQL 5432, TLS, token IAM | `rds-db:connect` nell'execution role + SG `sg-rds-proxy` |
| RDS Proxy | Secrets Manager | `GetSecretValue` | ruolo del proxy |
| RDS Proxy | Aurora | PostgreSQL, password dal secret | SG `sg-rds` + utente PostgreSQL |
| Lambda | EventBridge | `PutEvents` | identity policy nel ruolo |
| EventBridge | SQS | target della regola | queue policy |
| SQS | Notification Lambda | event source mapping | ruolo della Lambda |
| Notification Lambda | SES | `SendEmail` | identity policy nel ruolo |
| Presigned Lambda | S3 file | firma URL | permessi del ruolo firmatario |
| Browser | S3 file | PUT/POST sul presigned URL | l'URL stesso (firma + scadenza) |

---

## 14. Costi (da sapere, non da memorizzare)
Pesi indicativi: la parte **più costosa** del progetto è il DB (Aurora writer+replica, più il proxy che si paga in base alle vCPU/ACU del DB), poi eventuali **interface endpoint** (per AZ) o **NAT Gateway**. Lambda, API Gateway, S3, SQS, SES, Cognito e CloudFront restano nel livello gratuito o a pochi centesimi con traffico da progetto. Prima di creare risorse reali: **AWS Budgets** con allarme a 5-10 €, e il **Pricing Calculator**. Ricordati di **cancellare** ciò che crei a fine prove (Aurora, proxy, NAT, endpoint costano anche a vuoto).

---

## 15. Domande da esame trasversali (prova a rispondere ad alta voce)
1. Seguimi una richiesta "crea un'offerta" dal clic al database, nominando ogni servizio e ogni permesso coinvolto.
2. Cosa cambia se la Lambda delle offerte è fuori dalla VPC?
3. Perché non hai messo un NAT? Cosa avresti fatto se servisse chiamare un'API esterna?
4. Cosa succede se cade AZ-1? E se cade solo il writer?
5. Come si evita che un utente modifichi gli immobili di un altro?
6. Come fai a far caricare un video da 200 MB?
7. Come rendi l'invio email affidabile se SES è temporaneamente giù?
8. Dove sta la password del database? Chi la può leggere?
9. Come si fa un deploy di una nuova versione del sito senza downtime e senza che gli utenti vedano la cache vecchia?
10. Come monitori che il sistema funziona?
