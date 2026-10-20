# Decisioni e punti aperti

Le scelte prese con il loro motivo, le alternative considerate e scartate, le domande ancora aperte e gli sviluppi
futuri. Ogni riga rimanda al file del servizio che la spiega per intero.

## Decisioni prese

### Architettura e rete

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Architettura serverless | Traffico basso e variabile: si paga per richiesta, scala da zero, nessun server da gestire | [00-architettura.md](00-architettura.md) |
| Regione `eu-south-1` (Milano) | Dati in Italia, latenza bassa per utenti italiani; tutti i servizi usati ci sono. È una regione *opt-in*, da abilitare nell'account | [Disponibilità dei servizi](#disponibilità-dei-servizi-a-milano) |
| Una VPC `10.0.0.0/16` con due subnet private `/24` in due AZ | Il subnet group di Aurora e il proxy chiedono 2 AZ; le `/24` lasciano spazio alle ENI (il proxy vuole almeno 10 IP liberi per subnet) | [vpc.md](vpc.md) |
| Niente subnet pubbliche, Internet Gateway e NAT | Il traffico utente entra da CloudFront e API Gateway, fuori dalla VPC; non chiamiamo API esterne; il NAT è un costo fisso inutile | [vpc.md](vpc.md) |
| Endpoint VPC: interface SNS, interface Secrets Manager, gateway S3 (gratuito) | Unico modo per raggiungere i servizi AWS dalla VPC senza NAT; solo quelli che servono davvero | [vpc-endpoints.md](vpc-endpoints.md) |
| Private DNS sugli interface endpoint (`enableDnsSupport`, `enableDnsHostnames`) | L'SDK usa i nomi standard dei servizi senza modifiche al codice | [vpc-endpoints.md](vpc-endpoints.md) |
| Security group solo sulle risorse nella VPC, regole SG → SG | I servizi gestiti fuori dalla VPC non hanno ENI; le regole tra gruppi restano valide quando cambiano gli IP | [vpc.md](vpc.md#security-group) |
| Nessun PrivateLink per Cognito | Le Lambda non chiamano Cognito: l'authorizer valida i token da sé | [cognito.md](cognito.md#sicurezza-e-rete) |

### Frontend e storage

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Bucket del sito privato, letto da CloudFront con OAC; niente static website hosting | Nessun accesso diretto al bucket, HTTPS e cache | [cloudfront.md](cloudfront.md), [s3.md](s3.md) |
| Errori 403/404 → `/index.html` sulla distribuzione del sito | Routing della SPA; il 403 perché CloudFront non ha `s3:ListBucket` | [cloudfront.md](cloudfront.md#configurazione) |
| Due distribuzioni CloudFront, sito e file | La regola SPA vale per tutta la distribuzione e non deve toccare i file; cache ed errori diversi | [cloudfront.md](cloudfront.md) |
| Dominio `*.cloudfront.net` per la presentazione | Un dominio personalizzato richiederebbe un certificato ACM in `us-east-1` | [cloudfront.md](cloudfront.md#configurazione) |
| **File degli utenti pubblici** tramite la distribuzione dei file; bucket privato | Sono le foto e i video degli annunci: chi ha il link li vede | [s3.md](s3.md) |
| Upload diretto con **presigned POST** (non PUT), firmato dalla Presigned Lambda | Il file non passa dal backend (limiti 10 MB e 6 MB); solo il POST limita la dimensione | [lambda-presigned.md](lambda-presigned.md) |
| Chiave dell'oggetto decisa dalla Lambda, scadenza 5 minuti, `image/` (10 MB) o `video/` (limite più alto) | Il client non sceglie dove scrivere; un solo prefisso di `Content-Type` per firma | [lambda-presigned.md](lambda-presigned.md#configurazione) |
| **Notifica S3 `ObjectCreated`** su `uploads/` verso la Files Lambda, che registra il file | Il database si aggiorna solo con gli upload riusciti, senza fidarsi del client | [lambda-files.md](lambda-files.md) |
| Gateway endpoint S3 per la cancellazione dei file | La Files Lambda cancella oggetti dalla VPC; il gateway è gratuito | [vpc-endpoints.md](vpc-endpoints.md) |
| Block Public Access e ACL disattivate su entrambi i bucket | I file sono pubblici solo tramite CloudFront | [s3.md](s3.md#configurazione) |

### Autenticazione e API

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| HTTP API e non REST API | Costa meno, ha authorizer JWT e CORS integrati: tutto ciò che serve | [api-gateway.md](api-gateway.md#perché-unhttp-api) |
| Authorizer JWT nativo, nessuna Lambda Authorizer | La cache di una Lambda Authorizer vale per tutte le route; senza cache servirebbe il DB a ogni richiesta | [api-gateway.md](api-gateway.md#autorizzazione-su-due-livelli) |
| **Il frontend manda all'HTTP API l'ID token** (decisione definitiva) | Le Lambda hanno bisogno di `email` e `sub`, che l'ID token contiene e l'access token no; con l'access token l'email andrebbe presa dal body (falsificabile) o chiesta a Cognito con `GetUser`, irraggiungibile dalla VPC senza un endpoint in più; una Pre Token Generation Lambda per mettere `email` nell'access token complicherebbe il progetto; non usiamo scope OAuth né resource server. Limite: la buona pratica OIDC vuole l'access token con gli scope per le API; se servissero permessi a scope si passerebbe all'access token, e l'authorizer accetta tutti e due (`aud` nell'ID token, `client_id` nell'access token), quindi sarebbe solo configurazione | [cognito.md](cognito.md#decisione-allapi-va-lid-token) |
| Autorizzazione su due livelli: ruolo (gruppi Cognito) e ownership (nella Lambda, con il DB) | L'authorizer sa chi sei; se la risorsa è tua lo sa solo il database | [api-gateway.md](api-gateway.md#autorizzazione-su-due-livelli) |
| Gruppi `buyer`, `agent`, `admin` nel user pool; solo user pool, niente identity pool | I ruoli applicativi arrivano nel token; gli upload usano il presigned POST, non credenziali AWS nel browser | [cognito.md](cognito.md) |
| **Account modificato e cancellato dal frontend direttamente con Cognito** | Le Lambda nella VPC non raggiungono Cognito. `PUT /users/me` dopo ogni login crea o aggiorna la riga; nuovo login di conferma, `DELETE /users/me`, poi `DeleteUser` (scope `aws.cognito.signin.user.admin` sull'app client), poi logout | [cognito.md](cognito.md#cancellazione-dellaccount), [lambda-users.md](lambda-users.md) |
| Route esplicite, lettura degli annunci pubblica | Il preflight `OPTIONS` lo gestisce il CORS senza authorizer; un visitatore vede gli annunci | [api-gateway.md](api-gateway.md#route) |
| CORS sull'HTTP API e sul bucket dei file | Il sito chiama due origini diverse | [api-gateway.md](api-gateway.md#cors), [s3.md](s3.md#cors-del-bucket-dei-file) |
| Throttling sullo stage | Difesa dagli abusi; WAF non si associa a un'HTTP API | [api-gateway.md](api-gateway.md#throttling) |

### Business logic e dati

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Cinque Lambda di business, una per scope con router interno (Property, Users, Offers, Presigned, Files), più la Mailer | Semplicità, come un controller per risorsa; ruolo IAM per scope | [lambda.md](lambda.md) |
| In VPC solo le Lambda che usano il database, in entrambe le subnet | Il proxy esiste solo nella VPC | [lambda.md](lambda.md#lambda-nella-vpc) |
| Presigned Lambda **nella** VPC | Prima di firmare controlla nel database che l'utente sia il proprietario | [lambda-presigned.md](lambda-presigned.md) |
| Mailer Lambda **fuori** dalla VPC | Non usa il database: niente endpoint per SQS e SES, meno cold start e costi | [lambda-mailer.md](lambda-mailer.md) |
| Aurora PostgreSQL, un cluster con writer e reader su due AZ | Dati relazionali; failover automatico e storage replicato | [aurora.md](aurora.md) |
| RDS Proxy | Pooling delle connessioni delle Lambda, autenticazione IAM, failover più rapido. Non strettamente necessario con il nostro traffico, adottato per sicurezza | [rds-proxy.md](rds-proxy.md) |
| Lambda → proxy con IAM e TLS; proxy → Aurora con la password del secret | Nessuna password nelle Lambda; la password la vede solo il proxy | [rds-proxy.md](rds-proxy.md) |
| Un utente PostgreSQL e un secret per ogni Lambda con DB | IAM decide chi entra e con quale utente, i `GRANT` cosa può fare | [aurora.md](aurora.md#utenti-postgresql) |
| Connessione al DB aperta fuori dall'handler | Riuso tra le invocazioni | [lambda.md](lambda.md#connessione-al-database) |

### Notifiche

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| SNS → SQS → Mailer Lambda → SES (non EventBridge) | SQS dà buffer e retry, SNS permette altri consumer senza toccare le Lambda; allineato al diagramma | [sns.md](sns.md) |
| Pubblicano solo Property, Users e Offers | Sono le sole che generano eventi da notificare | [sns.md](sns.md#iam) |
| L'evento contiene destinatario e dati dell'email | La Mailer non ha bisogno del database | [lambda-mailer.md](lambda-mailer.md) |
| DLQ dopo 5 tentativi, visibility timeout 180 s (6 × 30 s), retention 4 giorni coda e 14 giorni DLQ | Nessun messaggio ritentato all'infinito; nessun messaggio che torna visibile a metà | [sqs.md](sqs.md) |
| Coda cifrata con SSE-SQS | SNS non consegna a una coda cifrata con `aws/sqs` | [kms.md](kms.md) |
| `RawMessageDelivery` sulla sottoscrizione | La Mailer riceve il messaggio senza la busta JSON di SNS | [sns.md](sns.md#configurazione) |
| SES via API, in sandbox per la demo | A Milano l'SMTP non c'è; la sandbox basta inviando a indirizzi verificati | [ses.md](ses.md) |

### IAM e sicurezza

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Nomi espliciti `real-estate-<ambiente>-<componente>-<scopo>`; ID reali come segnaposto `<...>` in Git | Si capisce a colpo d'occhio cosa fa ogni ruolo; niente ID reali né password nel repository | [iam.md](iam.md#tutti-i-ruoli) |
| Un execution role per Lambda, policy del progetto sugli ARN precisi; policy gestite solo per log e VPC | Least privilege e audit chiari; le azioni ENI richiedono comunque `Resource: "*"` | [lambda.md](lambda.md#iam) |
| Ruolo del proxy `real-estate-prod-rds-proxy-secrets-role` | Rinominato per seguire la convenzione | [rds-proxy.md](rds-proxy.md#iam) |
| `aws:SourceArn` (e `aws:SourceAccount` per S3) in tutte le resource policy verso servizi | Prevenire il confused deputy | [iam.md](iam.md#confused-deputy) |
| Deny delle richieste senza TLS sui bucket; TLS obbligatorio sul proxy e verso Aurora | Cifratura in transito ovunque | [s3.md](s3.md#bucket-policy), [rds-proxy.md](rds-proxy.md) |
| Cifratura a riposo: Aurora `aws/rds`, S3 SSE-S3, SQS SSE-SQS, secret `aws/secretsmanager` | Chiavi gestite da AWS, gratuite; CMK solo se servisse | [kms.md](kms.md) |
| `iam:PassRole` dell'identità di deploy limitato ai ruoli del progetto e ai servizi Lambda e RDS | Non si può "prestare" un ruolo a un altro servizio | [iam.md](iam.md#identità-di-deploy-e-iampassrole) |
| Endpoint policy sull'endpoint SNS (facoltativa) | Least privilege anche sulla rete | [vpc-endpoints.md](vpc-endpoints.md#iam) |

## Alternative considerate e non adottate

| Alternativa | Perché no | Quando avrebbe senso |
| --- | --- | --- |
| Container su ECS Fargate | Sempre accesi, costo fisso | Carico costante, applicazione già containerizzata |
| REST API | Costa di più; non ci servono usage plan, API key, validazione, cache | Se servisse WAF diretto o usage plan |
| Una Lambda per route | Più funzioni da gestire | Permessi IAM più fini per singola route |
| Lambda Authorizer per l'ownership | Cache condivisa tra le route o DB a ogni richiesta, latenza e cold start | Regole che l'authorizer JWT non sa esprimere, senza DB e fuori dalla VPC |
| Access token verso l'API | Non contiene l'email; non usiamo scope | Con scope OAuth o app di terze parti (solo cambio di configurazione) |
| Pre Token Generation Lambda | Complicazione inutile | — |
| Identity pool | Non servono credenziali AWS nel browser | Accesso diretto dei client ai servizi AWS |
| Trigger Cognito per creare la riga utente | `PUT /users/me` basta | — |
| `AdminDeleteUser` dalla Users Lambda, interface endpoint `cognito-idp` o evento verso una Lambda fuori VPC | Dalla VPC non c'è strada; l'endpoint Cognito esiste ma con limiti | — |
| Lasciare su S3 i file di un immobile cancellato | Spazio pagato per niente e file ancora raggiungibili da chi ha il link | — |
| Cancellare i file con un evento SNS → Files Lambda | La Files Lambda non è in ascolto su SNS: servirebbe un'altra coda o un endpoint Lambda. La Property ha già il gateway endpoint S3, gratuito | Se la pulizia diventasse lenta (molti file) e non dovesse pesare sulla richiesta |
| Lifecycle rule di S3 sui file orfani | Le lifecycle rule lavorano per prefisso o tag ed età, non sanno se l'immobile esiste | Come rete di sicurezza, con un tag messo sui file da cancellare |
| Conferma dell'upload dal client (`POST /files/confirm`) | Il client può mentire o non chiamare | — |
| Presigned PUT | Non limita la dimensione | — |
| File privati con CloudFront signed URL o presigned GET della Files Lambda | I file degli annunci sono pubblici per decisione | Se si aggiungessero documenti privati (contratti, documenti d'identità) |
| Una sola distribuzione con behavior `/files/*` | La regola SPA 403/404 toccherebbe i file | — |
| EventBridge al posto di SNS | Le Lambda in VPC avrebbero bisogno di un endpoint EventBridge; SNS basta per il fan-out | Molti consumer con regole di filtro su pattern |
| Solo SQS, senza SNS | Nessun consumer aggiuntivo possibile senza toccare le Lambda | Se il canale resterà uno solo |
| NAT Gateway | Costo fisso, nessuna API esterna | Se servisse chiamare un'API esterna: una subnet pubblica per AZ con NAT |
| RDS Proxy con IAM end-to-end (`DefaultAuthScheme=IAM_AUTH`) | Scelto il modello con secret, più comune e già documentato | Per semplificare: niente secret, endpoint e permessi KMS, ma utenti DB con `rds_iam` |
| Nessun RDS Proxy | Rischio di esaurire `max_connections`, niente IAM | Poche Lambda con connessioni riusate fuori dall'handler |
| Aurora Serverless v2 o RDS PostgreSQL Multi-AZ | Aurora provisioned scelto per failover e storage | Serverless v2 (disponibile a Milano) per pagare solo la capacità usata; RDS Multi-AZ più economico |
| Francoforte o Irlanda | Dati in Italia e latenza | Funzioni nuove disponibili subito, regione non opt-in |
| Chiave KMS del cliente (CMK) | Le chiavi gestite bastano | Controllo e audit sulla chiave; servono key policy e `rds-proxy-decrypt-secrets.json` |
| Lambda@Edge o CloudFront Functions | Il sito statico è pubblico, i dati stanno dietro l'API | — |

## Punti aperti

| Domanda | Stato | Dove |
| --- | --- | --- |
| **Endpoint di Secrets Manager per il proxy**: serve? | La documentazione AWS non lo dice. Si verifica alla creazione del proxy: se il target risulta `AVAILABLE` senza endpoint, lo si toglie (e la regola `sg-rds-proxy` → `sg-endpoint-secrets-manager`) risparmiando | [vpc-endpoints.md](vpc-endpoints.md#punti-aperti) |
| **Uso della reader di Aurora** | Oggi solo failover (l'endpoint di default del proxy va al writer). Per distribuire le letture serve un endpoint di sola lettura del proxy | [aurora.md](aurora.md#punti-aperti) |
| Formulazione "per sicurezza" sul proxy | All'orale può suonare come "sicurezza informatica" e far chiedere "quale?". Proposta, non applicata (scelta di parole del team): "per robustezza: le Lambda possono moltiplicare le connessioni, e il proxy ci dà anche l'autenticazione IAM e un failover più rapido" | [rds-proxy.md](rds-proxy.md#perché-cè) |
| Diagramma valido | La versione di riferimento è [`real-estate-v2.drawio`](diagrammi/real-estate-v2.drawio), con tutti i flussi e i nomi dei ruoli; lo schema precedente di Tommaso (`updated.drawio`, con i ruoli ancora `_to_do`, senza API Gateway né frecce dei flussi) è in archivio. Il team deve confermare la v2 aprendola in draw.io; quando la si ritocca, allineare i nomi abbreviati (bucket, coda, DLQ) e il riquadro IAM che rimanda ancora ad `am-management/`, e aggiungere la freccia Property Lambda → gateway S3 per la cancellazione dei file di un immobile ([README](README.md#diagramma)) | [README](README.md#diagramma) |
| Prove reali | Una connessione al proxy e il comportamento durante il failover del writer vanno verificati creando le risorse | [iam.md](iam.md#verifica-prima-delluso) |
| Backup e retention di Aurora | Valori da fissare alla creazione | [aurora.md](aurora.md#punti-aperti) |

## Disponibilità dei servizi a Milano

| Servizio | In `eu-south-1`? | Note |
| --- | --- | --- |
| Cognito user pool | Sì (verificato: [endpoint Cognito](https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html)) | Anche le identity pool, che non usiamo |
| SES | Sì via API (verificato: [endpoint SES](https://docs.aws.amazon.com/general/latest/gr/ses.html)) | **L'SMTP non c'è a Milano**: la Mailer usa l'API. In sandbox 200 email ogni 24 ore, 1 al secondo |
| RDS Proxy con Aurora PostgreSQL | Sì (verificato: [regioni RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.RDS_Proxy.html), Aurora PostgreSQL dalla 11.9 alla 18.x) | — |
| Aurora Serverless v2 | Sì (verificato: [regioni Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html)) | Alternativa più economica |
| Lambda, HTTP API, S3, SNS, SQS, Secrets Manager, CloudWatch, endpoint VPC `sns`, `secretsmanager` e gateway `s3` | Sì | Servizi di base presenti in tutte le regioni commerciali; non verificati riga per riga |
| CloudFront, IAM | Globali | Il certificato ACM per CloudFront va in `us-east-1` |

Verificato anche sulla documentazione AWS: il ruolo del proxy (trust, `GetSecretValue`, `kms:Decrypt` con
`kms:ViaService`) è identico all'esempio ufficiale; prerequisiti di rete del proxy (2 subnet in AZ diverse, 10 IP
liberi); nelle HTTP API la cache della Lambda Authorizer è facoltativa e per default vale per tutte le route, e
l'access logging non richiede il ruolo CloudWatch dell'account; SNS non consegna a code cifrate con `aws/sqs`.
Non verificato puntualmente: che WAF non si associ alle HTTP API; il bisogno dell'endpoint di Secrets Manager. Nessuna risorsa è stata creata su un account AWS.

## Sviluppi futuri

- **WAF** davanti all'API, mettendo CloudFront davanti all'HTTP API (WAF è già possibile sulle distribuzioni CloudFront).
- Endpoint di sola lettura del proxy per usare la reader.
- **SES in produzione**: richiesta di uscita dalla sandbox e verifica del dominio del mittente (DKIM).
- Rotazione automatica dei secret con una Lambda di rotazione.
- Ambienti separati (oggi c'è solo `prod`), Infrastructure as Code (CloudFormation, Terraform o CDK), stima dei costi con
  il Pricing Calculator, modello dati, backup e retention di Aurora, scansione antivirus dei file caricati, dominio
  personalizzato.

## Costi complessivi

La parte più costosa è il database: Aurora writer e reader più il proxy, che si paga in base alla capacità del DB. Poi
gli interface endpoint, per AZ (un NAT costerebbe di più). Lambda, API Gateway, S3, SQS, SNS, SES, Cognito e CloudFront
restano nel livello gratuito o a pochi centesimi con il traffico del progetto. Prima di creare risorse reali: AWS
Budgets con un allarme a 5-10 € e il Pricing Calculator; a fine prove si cancella ciò che costa anche a vuoto (Aurora,
proxy, endpoint).

## Domande trasversali da preparare

1. Seguire una richiesta "crea un'offerta" dal clic al database, nominando servizi e permessi
   ([lambda-offers.md](lambda-offers.md#allorale)).
2. Cosa cambia se la Offers Lambda è fuori dalla VPC ([lambda-offers.md](lambda-offers.md#allorale)).
3. Perché niente NAT, e cosa fare se servisse un'API esterna ([vpc.md](vpc.md)).
4. Cosa succede se cade AZ-1, o solo il writer ([aurora.md](aurora.md#allorale)).
5. Come si evita che un utente modifichi gli immobili di un altro ([lambda-property.md](lambda-property.md#allorale)).
6. Come si fa caricare un video da 200 MB ([lambda-presigned.md](lambda-presigned.md#allorale)).
7. Come si rende affidabile l'invio email se SES è giù ([ses.md](ses.md#allorale)).
8. Dove sta la password del database e chi la legge ([secrets-manager.md](secrets-manager.md#allorale)).
9. Come pubblicare una nuova versione del sito senza che gli utenti vedano la cache vecchia ([cloudfront.md](cloudfront.md#allorale)).
10. Come si monitora che il sistema funziona ([cloudwatch.md](cloudwatch.md#allorale)).
11. Trust policy e permissions policy, execution role e resource policy, confused deputy, `PassRole` ([iam.md](iam.md#allorale)).

## All'orale

> **Qual è la scelta di cui siete meno sicuri?**
> L'endpoint di Secrets Manager per il proxy: la documentazione non lo chiarisce, lo verifichiamo creando il proxy.
> E l'ID token verso l'API: è una scelta motivata, ma sappiamo che la buona pratica per le API è l'access token con gli
> scope, e il passaggio sarebbe solo di configurazione.
>
> **Perché non EventBridge?**
> Il diagramma e il piano usano SNS: basta per il fan-out, e da una Lambda in VPC EventBridge avrebbe chiesto un altro
> endpoint. EventBridge serve quando ci sono molti consumer con regole di filtro.
>
> **Cosa fareste con più tempo?**
> WAF davanti all'API, SES in produzione, rotazione dei secret,
> Infrastructure as Code (come un `docker-compose.yml`, ma per tutta l'infrastruttura AWS).
>
> **Cosa avete fatto bene, secondo voi?**
> Ogni scelta ha un motivo scritto e un limite dichiarato (il proxy "non strettamente necessario", l'ID token); le
> domande vere del team sono documentate con la decisione presa; database privato su due AZ, nessun accesso diretto
> Lambda → Aurora; least privilege con un ruolo per Lambda e trust separate; nessuna password nel repository; ordine di
> creazione dichiarato; i JSON dichiarati come template, non come risorse esistenti.
>
> **Perché il proxy se dite che non è necessario?**
> Per robustezza: con molte invocazioni concorrenti le connessioni si moltiplicano, e il proxy ci dà anche
> l'autenticazione IAM e un failover più rapido.
