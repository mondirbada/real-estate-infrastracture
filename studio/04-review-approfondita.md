# Review approfondita — real-estate-infrastructure

Revisione del 2026-10-19 su `main` dopo il commit `0d55561` ("fix diagramma" di Tommaso).
Letti: `architecture.md`, `problems.md`, `am-management/` (tutto), `diagrams/updated.drawio` (come XML: nodi, etichette, frecce)
e il PNG esportato, `studio/01-03`. Dove serviva ho controllato la documentazione AWS: la sezione 8 dice cosa ho
verificato e cosa no.

## Riassunto

**Il progetto sta in piedi.** Tutti i servizi usati esistono a Milano (`eu-south-1`). L'architettura è serverless, con
il DB privato su due AZ, nessun NAT ed endpoint VPC, ed è fattibile e coerente nel testo. La base IAM che c'è (proxy,
Secrets Manager, Lambda → proxy) è scritta bene e combacia con gli esempi ufficiali AWS.
Prima dell'esame vanno sistemate quattro cose:
1. **Il diagramma.** Con l'ultimo commit è sparita l'icona di **API Gateway**. Mancano poi le etichette (le 5 Lambda
   non hanno nome) e le frecce del flusso principale (browser → CloudFront/API Gateway → Lambda, Lambda → SNS, proxy →
   Secrets Manager). Gli endpoint VPC sono disegnati fuori dalla VPC. È la cosa più visibile.
2. **I ruoli IAM mancanti.** Oggi c'è solo il ruolo del proxy: mancano sei execution role e cinque o sei resource policy.
   La lista da scrivere è in fondo (sezione 7).
3. **Tre flussi non decisi**, che il professore può chiedere: come si cancella un utente anche da Cognito (la User Lambda
   in VPC non lo raggiunge), come il DB viene a sapere che un upload è finito, se i file caricati sono pubblici o privati.
4. **Due paragrafi mancanti** in `architecture.md`: CORS e cifratura (testo pronto nella sezione 4).

Errori oggettivi corretti direttamente: 4 nei documenti del team, più 5 residui nelle mie guide (elenco qui sotto).
Il `.drawio` **non l'ho toccato**: Tommaso ci sta lavorando adesso, e le correzioni necessarie non sono piccole.
Gliele lascio nella sezione 2.

---

## Legenda

- **[bloccante]**: da sistemare prima dell'esame, altrimenti il professore lo nota subito o il flusso non funziona.
- **[da sistemare]**: incoerenza o lacuna vera, ma circoscritta. Va decisa e scritta.
- **[dettaglio]**: migliora il progetto o la risposta all'orale; si può anche lasciare così, sapendolo spiegare.
- **[corretto]**: già sistemato in questo commit.

## Cosa ho corretto direttamente

| File | Correzione | Perché |
| --- | --- | --- |
| `architecture.md` (Rete) | La regola SG `sg-lambda-internal` → `sg-endpoint-secrets-manager` diventa `sg-rds-proxy` → `sg-endpoint-secrets-manager`, "se l'endpoint serve" | Lo stesso documento dice che le Lambda non leggono mai i secret: l'endpoint, se serve, serve al proxy |
| `problems.md` (PrivateLink) | "SNS per le lambda e, se necessario, Secrets Manager per l'RDS Proxy" | Stessa contraddizione |
| `architecture.md` (Auth) | La frase sulla cache della Lambda Authorizer ora dice "se se ne attiva la cache, per default vale per tutte le route" | Nelle HTTP API la cache dell'authorizer è opzionale; la versione precedente diceva che è sempre attiva ([doc](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html)) |
| `architecture.md` | Refuso "nela" → "nella" | — |
| `studio/03` | Ruolo delle Lambda: `events:PutEvents` → `sns:Publish`; "Notification Lambda" → "Mailer Lambda"; il ruolo CloudWatch di API Gateway serve solo per le REST API | Residui della versione con EventBridge; per le HTTP API i log non richiedono quel ruolo ([doc](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)) |
| `studio/02` | Tolta la "eventuale Lambda Authorizer"; "EventBridge aggiunge…" → "il topic SNS aggiunge…" | Residui |
| `studio/01` | Nota in testa: la tabella dei ruoli della sezione 5 è superata da questo file | Citava ancora EventBridge |

---

## 1. Fattibilità reale

### 1.1 Servizi disponibili a Milano

| Servizio | In `eu-south-1`? | Fonte | Note |
| --- | --- | --- | --- |
| Cognito user pool | Sì | Verificato: [endpoint Cognito](https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html) | Anche le identity pool, che però non usate |
| SES (API) | Sì | Verificato: [endpoint SES](https://docs.aws.amazon.com/general/latest/gr/ses.html) | **L'SMTP non c'è a Milano**: va bene, la Mailer usa l'API (SDK). Quota in sandbox: 200 email/24 h, 1 al secondo |
| RDS Proxy + Aurora PostgreSQL | Sì (Aurora PostgreSQL dalla 11.9 alla 18.x) | Verificato: [regioni RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.RDS_Proxy.html) | — |
| Aurora Serverless v2 (alternativa) | Sì | Verificato: [regioni Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html) | Utile come alternativa più economica (sezione 5) |
| Lambda, API Gateway HTTP API, S3, SNS, SQS, Secrets Manager, CloudWatch, VPC endpoint | Sì | Non verificato riga per riga: sono servizi di base presenti in tutte le regioni commerciali | — |
| CloudFront, IAM | Globali | — | Il certificato ACM per CloudFront, se usate un dominio vostro, va in `us-east-1` (già scritto) |

**[dettaglio] Milano è una regione *opt-in*.** Va abilitata nell'account prima di creare risorse, ed è una buona
risposta a "perché Milano?": dati in Italia e latenza bassa per utenti italiani. Il prezzo è che alcune funzioni ci
arrivano più tardi.

### 1.2 Ogni Lambda raggiunge ciò che chiama?

La regola: una Lambda **in VPC** non ha Internet, quindi ogni servizio AWS che chiama deve avere un endpoint VPC.
Alcune cose però non passano dalla rete della Lambda, e conviene saperle distinguere:

| Chi | Chiama | Come ci arriva | Esito |
| --- | --- | --- | --- |
| 5 Lambda di business (VPC) | RDS Proxy | Rete VPC, `sg-lambda-internal` → `sg-rds-proxy` 5432 | OK |
| 5 Lambda di business | Token IAM per il proxy | **Calcolato in locale** dall'SDK (firma SigV4), nessuna chiamata di rete | OK |
| Tutte le Lambda | Credenziali del ruolo, log su CloudWatch | Li gestisce il servizio Lambda, non la rete della funzione | OK, nessun endpoint |
| Lambda che pubblicano eventi | SNS | Interface endpoint `com.amazonaws.eu-south-1.sns` | OK (c'è nel piano) |
| Presigned Lambda | S3 | **Nessuna chiamata**: il presigned POST si firma in locale | OK |
| Files Lambda | S3 (cancellare un file, controllare che esista) | Gateway endpoint S3, che il piano dà come "se" | **Da decidere**: vedi F2 |
| User Lambda | Cognito (cancellare o modificare l'utente) | **Nessun percorso** | **Da decidere**: vedi F1 |
| Mailer Lambda (fuori VPC) | SQS, SES | Internet di AWS. SQS lo legge il servizio Lambda (event source mapping) | OK |
| RDS Proxy | Secrets Manager | La documentazione AWS non lo dice | Resta "da verificare" (vedi F4) |
| Browser | S3 (upload) | Diretto, con il presigned POST | OK, ma serve il CORS sul bucket (N3) |

#### F1 · [da sistemare] La User Lambda e Cognito
- **Dove:** `architecture.md` cita gli eventi `UpdateUserInformation` e `DeleteUser` della User Lambda; `problems.md`
  dice che "le lambda nella VPC non chiamano Cognito".
- **Problema:** se `DeleteUser` cancella solo la riga nel DB, l'account Cognito resta e l'utente può ancora fare login.
  Per cancellarlo da Cognito la Lambda dovrebbe chiamare `AdminDeleteUser`, ma dalla VPC non ha strada (niente NAT,
  niente endpoint Cognito). Vale lo stesso per email e attributi che stanno in Cognito.
- **Proposta (la più semplice):** le operazioni sull'account (cancellazione, cambio email o password) le fa il **frontend
  direttamente con Cognito**, usando l'access token dell'utente (`DeleteUser`, `UpdateUserAttributes` sono API pubbliche
  di Cognito); la User Lambda gestisce solo i dati applicativi nel DB.
  Alternative: un interface endpoint `cognito-idp` (esiste, ma con limiti: va verificato), oppure un evento SNS gestito
  da una Lambda fuori VPC.
- **Collegato:** come nasce la riga utente nel DB? Proposta: alla prima chiamata autenticata (`POST /users/me`) la User
  Lambda crea la riga con `sub` ed `email` presi dal token. Così non serve un trigger Cognito.

#### F2 · [da sistemare] Come il DB sa che un upload è finito
- **Dove:** `architecture.md`, Database & Storage.
- **Problema:** il browser carica direttamente su S3, quindi nessuna Lambda vede l'upload. Non è scritto chi salva nel DB
  i metadati del file (chiave, proprietà, tipo).
- **Proposta:** una **notifica S3** `ObjectCreated` sul prefisso `uploads/` che invoca la Files Lambda, la quale registra
  il file nel DB. S3 invoca la Lambda tramite il servizio Lambda, non dalla rete della VPC, quindi non serve un endpoint.
  Serve però un permesso sulla Lambda per `s3.amazonaws.com` (sezione 7, voce 13).
  In più, se la Files Lambda deve **cancellare** file, serve il **gateway endpoint S3**, che è gratuito: consiglio di
  metterlo e togliere il "se".
  Alternativa più semplice: il frontend, a upload finito, chiama `POST /files/confirm`. È meno affidabile, perché il
  client può mentire o non chiamare.

#### F3 · [dettaglio] Il proxy e l'istanza reader
- **Dove:** il diagramma ha una freccia dal proxy alla *Read Instance*.
- **Fatto:** l'endpoint di default di RDS Proxy manda tutto al **writer**. La reader serve come **riserva per il
  failover** e riceve letture solo se si crea un endpoint del proxy di sola lettura.
- **Proposta:** all'orale dite "la reader è lì per l'alta disponibilità: se cade il writer, Aurora la promuove". Se
  volete usarla per le letture, aggiungete un *read-only proxy endpoint* e citatelo.

#### F4 · [dettaglio] L'endpoint di Secrets Manager per il proxy
Ho ricontrollato: le pagine AWS sui prerequisiti di rete e sul troubleshooting del proxy non dicono se il proxy, in
subnet senza Internet, abbia bisogno dell'endpoint di Secrets Manager
([rete](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-network-prereqs.html),
[troubleshooting](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.troubleshooting.html)).
La posizione del piano, "lo mettiamo e lo verifichiamo alla creazione", resta la più onesta. All'orale: "se il
target del proxy risulta `AVAILABLE` senza endpoint, lo togliamo e risparmiamo".

#### F5 · [dettaglio] Dimensione delle subnet
Il proxy vuole almeno **10 IP liberi** per subnet, e altri ne usano le ENI delle Lambda e degli endpoint
([doc](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-network-prereqs.html)).
Proposta da scrivere: VPC `10.0.0.0/16`, `private_subnet_A` = `10.0.1.0/24` (AZ-1), `private_subnet_B` = `10.0.2.0/24`
(AZ-2). Così rispondete anche a "che CIDR avete scelto?".

---

## 2. Coerenza fra documenti e diagramma

Il testo (`architecture.md`, `problems.md`, `am-management/`) ora è coerente al suo interno. Le incoerenze stanno quasi
tutte nel **diagramma**, che dopo `0d55561` ha perso le etichette e un servizio. Questa sezione è da girare a Tommaso.

Cosa c'è oggi nella pagina "AWS Infrastructure" (letta dall'XML e dal PNG):
fuori dalla regione 2 CloudFront, un'icona IAM Identity Center e i due endpoint VPC con il loro SG. Nella regione:
2 bucket S3, Cognito, Secrets Manager, CloudWatch e la catena SNS → SQS → Mailer Lambda → SES (con frecce). Nella VPC
"PRIVATE": 5 Lambda con `sg-lambda-internal`, `rds-proxy` con `sg-rds-proxy`, writer in `private_subnet_A` e reader in
`private_subnet_B` (con `sg-rds`). Frecce: Lambda → proxy, proxy → writer e reader.

#### C1 · [bloccante] API Gateway non c'è più nel diagramma
- **Dove:** `diagrams/updated.drawio`. L'icona `api_gateway` (id `P3Q06UuXfGOA1thm4UkR-13`) c'era nel commit di
  Tommaso `6aec1cb` ed è stata rimossa in `0d55561`, probabilmente cancellando il riquadro che la conteneva.
- **Perché conta:** è la porta d'ingresso di tutto il backend; `architecture.md` le dedica una sezione intera.
- **Proposta:** rimetterla, fuori dalla VPC e dentro la regione.

#### C2 · [da sistemare] Mancano le frecce del flusso principale
Il diagramma mostra solo il DB e le notifiche. Mancano le frecce che `architecture.md` descrive:
1. Browser → CloudFront (sito) → S3 sito (OAC)
2. Browser → Cognito (login)
3. Browser → API Gateway (JWT) → 5 Lambda di business
4. Lambda → endpoint SNS → SNS (oggi SNS non riceve nessuna freccia: non si capisce chi pubblica)
5. Browser → S3 file (presigned POST) e CloudFront (file) → S3 file
6. RDS Proxy → Secrets Manager (tratteggiata, "via endpoint, da verificare")
7. Lambda → CloudWatch (anche una sola freccia generica)

Manca anche un'icona per il browser/utente (c'era nella pagina vecchia).

#### C3 · [da sistemare] Nessuna etichetta
- **Problema:** le 5 Lambda nella VPC non hanno nome: non si capisce quale sia Property, User, Offers, Files o Presigned.
  Anche S3 (sito o file?), CloudFront (sito o file?), SNS, SQS, SES e Cognito sono senza nome.
- **Proposta:** un'etichetta sotto ogni icona, con gli stessi nomi di `architecture.md`. Per la coda va scritto
  "SQS (+ DLQ)", perché la DLQ non è disegnata.

#### C4 · [da sistemare] Gli endpoint VPC sono fuori dalla VPC
- **Dove:** `sg-endpoint-secrets-manager` e `sg-endpoint-sns` sono figli del riquadro dell'account, sopra la regione.
- **Perché è sbagliato:** un interface endpoint è una **ENI dentro le subnet private** (una per AZ), con il suo SG.
  Disegnato fuori dalla VPC, trasmette il concetto sbagliato.
- **Proposta:** spostarli dentro "PRIVATE". Se decidete il gateway endpoint S3 (F2), va aggiunto anche lui: si disegna
  sul bordo della VPC, legato alle route table.

#### C5 · [da sistemare] I nomi dei ruoli
- **Dove:** 6 ruoli `_to_do` nel diagramma; `rds-proxy-secrets-role` in `am-management/` e nel diagramma.
- **Problema:** `problems.md` ha deciso la convenzione `real-estate-<ambiente>-<componente>-<scopo>`, ma l'unico ruolo
  esistente non la segue.
- **Proposta:** usare i nomi della sezione 7. Rinominare il ruolo del proxy in `real-estate-prod-rds-proxy-secrets-role`
  (va cambiato in `am-management/README.md`, `rds-proxy.md`, `aurora.md` e nel diagramma), oppure scrivere in
  `problems.md` che la convenzione vale solo per i ruoli nuovi. Il cambio di nome non l'ho fatto io, perché tocca file del team
  e il diagramma.

#### C6 · [dettaglio] Icone e annidamento
- L'icona in alto a sinistra è **IAM Identity Center** (`single_sign_on`), non IAM. Se rappresenta IAM, va usata
  l'icona IAM con etichetta.
- Le Lambda e il proxy stanno nella VPC ma fuori dai riquadri AZ e subnet, mentre il testo dice "in entrambe le subnet".
  Basta una nota "multi-AZ: subnet A + B". La convenzione AWS è regione ⊃ VPC ⊃ AZ ⊃ subnet; oggi i riquadri AZ si
  sovrappongono alla VPC senza contenerla.
- SES usa l'icona del set vecchio (`aws3`): è solo estetica.

#### C7 · [dettaglio] File di contorno del diagramma
- `diagrams/updated.drawio.svg` è del 18/10 e mostra lo schema vecchio; il PNG invece è aggiornato. Va riesportato o
  cancellato.
- `diagrams/.$updated.drawio.bkp` è il backup automatico di draw.io, finito in Git: va tolto e messo in `.gitignore`.
- La pagina `_OLD_OBSOLETE` del `.drawio`: va tolta prima di consegnare, oppure detta esplicitamente.

#### C8 · [dettaglio] I file letti da CloudFront
`architecture.md` dice che "la lettura dei file passa da CloudFront con OAC, come per il sito", e il diagramma ha
**due** distribuzioni. Proposta: scriverlo ("una seconda distribuzione per i file"). È anche il motivo per cui la regola
SPA "403/404 → `/index.html`" non tocca i file: le pagine d'errore personalizzate valgono per tutta la distribuzione.

Cose coerenti, da non toccare: 5 Lambda di business più la Mailer (6 ruoli nel diagramma), Mailer fuori VPC, 2 subnet
private senza NAT né IGW, writer e reader su due AZ, catena SG Lambda → proxy → DB, servizi gestiti senza SG, HTTP API
con JWT, Secrets Manager letto solo dal proxy.

---

## 3. IAM

#### I1 · I file esistenti sono corretti
Ho validato tutti i JSON e li ho confrontati con l'esempio ufficiale
([rds-proxy-iam-setup](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-iam-setup.html)):
- `trust-relationships/rds-proxy.json`: principal `rds.amazonaws.com`, `sts:AssumeRole`. Identico all'esempio AWS.
- `policies/rds-proxy-read-secrets.json`: `secretsmanager:GetSecretValue` sui soli secret applicativi. Identico.
- `policies/rds-proxy-decrypt-secrets.json`: `kms:Decrypt` con `kms:ViaService = secretsmanager.eu-south-1.amazonaws.com`.
  Identico. Separarlo in "solo con CMK" è giusto: la chiave gestita `aws/secretsmanager` autorizza già dalla sua key policy.
- `policies/lambda-connect-proxy.json`: `rds-db:connect` su `dbuser:<prx-ID>/<utente>`. Formato corretto, ed è giusto
  usare l'ID risorsa del proxy e non il nome.
- `trust-relationships/lambda.json`: corretto.
- Il testo distingue bene le due modalità: secret dietro al proxy contro `DefaultAuthScheme=IAM_AUTH` (IAM end-to-end).
  È esattamente la distinzione che fa la documentazione.

#### I2 · [da sistemare] Mancano quasi tutti i ruoli
Nel repo c'è 1 ruolo su 7 e nessuna delle resource policy (5, più una facoltativa): la lista completa è nella sezione 7. È la parte su cui il
professore insisterà. Consiglio di scriverla con la stessa struttura di `am-management/`: un `.md` per componente, la
trust in `trust-relationships/`, le policy in `policies/`.

#### I3 · [dettaglio] Policy gestite da AWS o scritte da voi
`AWSLambdaBasicExecutionRole`, `AWSLambdaVPCAccessExecutionRole` e `AWSLambdaSQSQueueExecutionRole` sono comode ma hanno
`Resource: "*"`. Per un progetto scolastico vanno bene, se sapete dirlo. Per mostrare il least privilege:
- **log** e **VPC** con le policy gestite (le azioni `ec2:*NetworkInterface*` richiedono comunque `"*"`);
- **SQS, SNS, S3, SES, rds-db** con policy vostre sull'ARN preciso.

#### I4 · [dettaglio] Quanti utenti PostgreSQL
Il README dice "un utente e un secret per ogni ambito che richiede permessi distinti". Va deciso quanti sono. Proposta:
uno per Lambda (`property_user`, `users_user`, `offers_user`, `files_user`, `presigned_user`), così ogni execution role
ha il suo `dbuser` e il racconto del least privilege è lineare: IAM decide *chi entra nel proxy*, i `GRANT` *cosa fa
nelle tabelle*. Costo: 5 secret, circa 0,40 $ al mese ciascuno.

#### I5 · [dettaglio] Confused deputy
Nelle resource policy verso servizi AWS (bucket, coda, permessi Lambda) mettete sempre `aws:SourceArn` (e, dove si
può, `aws:SourceAccount`). Nella sezione 7 sono già indicati.

---

## 4. Sicurezza e rete

#### N1 · Catena dei security group (da copiare in `architecture.md` o in un `network.md`)
I SG sono **stateful**: la risposta torna da sola. "A → B" vuol dire: regola *inbound* su B con sorgente il SG di A
(più l'*outbound* su A, se restringete l'uscita).

| SG | Inbound | Outbound |
| --- | --- | --- |
| `sg-lambda-internal` | nessuno | 5432 → `sg-rds-proxy`; 443 → `sg-endpoint-sns`; 443 → prefix list S3 (`pl-…`) se c'è il gateway endpoint |
| `sg-rds-proxy` | 5432 da `sg-lambda-internal` | 5432 → `sg-rds`; 443 → `sg-endpoint-secrets-manager` (se serve) |
| `sg-rds` | 5432 da `sg-rds-proxy` | nessuno |
| `sg-endpoint-sns` | 443 da `sg-lambda-internal` | nessuno |
| `sg-endpoint-secrets-manager` | 443 da `sg-rds-proxy` | nessuno |

Trappola da saper dire: il **gateway endpoint S3 non ha SG**. Funziona con una rotta nelle route table delle due subnet
private; se l'uscita delle Lambda è ristretta, serve una regola outbound verso la *prefix list* di S3.

#### N2 · [da sistemare] DNS privato degli endpoint
Perché l'SDK chiami `sns.eu-south-1.amazonaws.com` senza modifiche al codice, gli interface endpoint vanno creati con
**Private DNS attivo**, e la VPC deve avere `enableDnsSupport` ed `enableDnsHostnames` attivi. Non è scritto da nessuna
parte; basta una riga nella sezione Rete.

#### N3 · [da sistemare] CORS non è citato
Servono due configurazioni, perché il sito (dominio CloudFront) chiama due origini diverse:
- **HTTP API**: `allowOrigins` = `https://<id>.cloudfront.net`, `allowHeaders` = `Authorization, Content-Type`,
  `allowMethods` = quelli usati. L'HTTP API risponde da sola al preflight `OPTIONS`.
- **Bucket dei file**: una regola CORS che permetta `POST` dall'origine del sito. Senza, il browser blocca l'upload
  presigned.

Testo pronto per `architecture.md`:
> **CORS.** Il sito è servito da CloudFront e chiama due origini diverse: l'HTTP API, configurata con l'origine del sito
> tra quelle ammesse e gli header `Authorization` e `Content-Type`, e il bucket dei file, che ha una regola CORS che
> permette il `POST` degli upload dalla stessa origine.

#### N4 · [da sistemare] Cifratura: manca un paragrafo
Testo pronto:
> **Cifratura.** In transito: HTTPS ovunque (CloudFront reindirizza HTTP su HTTPS, le bucket policy negano le richieste
> senza TLS), TLS obbligatorio verso l'RDS Proxy ("Require TLS") e tra il proxy e Aurora. A riposo: Aurora cifrato con
> KMS (va scelto alla creazione del cluster), S3 con SSE-S3, SQS con SSE-SQS, secret con la chiave `aws/secretsmanager`.

La scelta **SSE-SQS** non è casuale: **SNS non riesce a consegnare a una coda cifrata con la chiave gestita `aws/sqs`**,
perché la sua key policy non ammette SNS e non si può modificare. Servirebbe una CMK con una key policy per
`sns.amazonaws.com` ([doc SNS](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)).
È una bella domanda da orale.

#### N5 · [da sistemare] I file caricati sono pubblici o privati?
- **Problema:** con CloudFront + OAC, e senza URL firmati, **chiunque abbia il link** legge il file. Per le foto degli
  annunci va benissimo; per documenti privati (contratti, documenti d'identità di un'offerta) no.
- **Proposta:** decidere e scriverlo. Se ci sono file privati, o li servite con **CloudFront signed URL**, o con un
  **presigned GET** generato dalla Files Lambda dopo il controllo di ownership, che firma in locale come il POST.
  Per un progetto scolastico basta: "le foto sono pubbliche via CloudFront; i documenti privati con presigned GET".

#### N6 · [dettaglio] S3
Da scrivere esplicitamente: **Block Public Access attivo** su entrambi i bucket e Object Ownership "bucket owner
enforced" (ACL disattivate). Il presigned POST funziona lo stesso, perché è firmato da un ruolo IAM e non è un accesso
pubblico. La chiave dell'oggetto la decide la Lambda (`uploads/<propertyId>/<uuid>`), non il client; il POST scade in
pochi minuti.

#### N7 · [dettaglio] WAF e throttling
Con la **HTTP API** non si può associare AWS WAF direttamente: si può solo con le REST API, o mettendo CloudFront davanti
all'API. Se il professore chiede "come vi difendete dagli abusi?", la risposta è: throttling sullo stage dell'HTTP API
(rate/burst), JWT obbligatorio sulle route, WAF su CloudFront per il sito. WAF sull'API è uno sviluppo futuro.

---

## 5. Scelte da saper giustificare all'orale

| Scelta | Cosa dire | Alternativa da citare |
| --- | --- | --- |
| Serverless (Lambda) | Paghi per richiesta, scala da zero, niente server da gestire: per un traffico basso e variabile è la scelta naturale | Container su ECS Fargate: sempre accesi, più simili a Spring Boot + Docker |
| HTTP API invece di REST API | Costa meno, ha l'authorizer JWT nativo e il CORS integrato, ed è tutto ciò che ci serve | REST API se servono usage plan, API key, validazione delle richieste, WAF diretto |
| Una Lambda per ambito (router interno) | Come un controller Spring per risorsa: meno funzioni da gestire, ruolo IAM per ambito | Una Lambda per route: permessi più fini, più cose da gestire |
| Aurora con writer + reader | Failover automatico in decine di secondi e storage replicato su 3 AZ | **Aurora Serverless v2** (c'è a Milano) per pagare solo la capacità usata; RDS PostgreSQL Multi-AZ, più economico |
| RDS Proxy | Le Lambda aprono una connessione per istanza: con molte invocazioni concorrenti si esaurisce `max_connections`. Il proxy fa pooling, accetta l'autenticazione IAM e rende il failover più rapido | Senza proxy, con poche Lambda e connessioni riusate fuori dall'handler |
| IAM verso il proxy, secret dietro | Nessuna password nelle Lambda; la password del DB la vede solo il proxy | IAM end-to-end (`IAM_AUTH`): niente secret né KMS, ma utenti DB con `rds_iam` |
| SNS + SQS invece della sola SQS | SQS dà buffer e retry, SNS permette altri consumer in futuro (SMS, push) senza toccare le Lambda | Solo SQS: più semplice, va bene se il canale resterà uno |
| DLQ | Dopo N fallimenti il messaggio va da parte invece di tornare all'infinito; un allarme su "DLQ non vuota" | — |
| Niente NAT | Non chiamiamo API esterne; il NAT è un costo fisso; gli endpoint bastano | NAT in subnet pubblica se un giorno servisse un'API esterna |
| Mailer fuori VPC | Non usa il DB: fuori dalla VPC raggiunge SES senza endpoint | In VPC servirebbe un endpoint per SES |
| Presigned in VPC | Prima di firmare controlla nel DB che l'utente possa caricare su quella proprietà | Fuori dalla VPC, ma senza controllo di ownership |
| Due distribuzioni CloudFront | Regole di cache ed errori diverse per sito e file | Una distribuzione con un behavior `/files/*` |
| Milano | Dati in Italia, latenza bassa | Francoforte/Irlanda: tutte le funzioni subito, regione non opt-in |
| Ownership nella Lambda | L'authorizer dice *chi sei*; *se l'immobile è tuo* lo sa solo il DB | Lambda Authorizer (sconsigliata: cache, latenza, DB a ogni richiesta) |

**[dettaglio] La frase "per sicurezza" sul proxy.** In `architecture.md` il proxy è implementato "per sicurezza".
All'orale suona come "sicurezza informatica" e il professore può chiedere "quale?". Proposta di riformulazione: "per
robustezza: le Lambda possono moltiplicare le connessioni, e il proxy ci dà anche l'autenticazione IAM e un failover più
rapido". Non l'ho cambiata io, perché è una scelta di parole del team.

---

## 6. Domande di `problems.md`: risolte e aperte

| Domanda | Stato |
| --- | --- |
| Lambda + VPC: le Lambda devono stare nella VPC del proxy? | **Risolta**: le 5 di business in VPC, la Mailer fuori |
| Servono subnet pubbliche? | **Risolta**: no, 2 subnet private in 2 AZ |
| PrivateLink per Cognito? | **Risolta** per l'autenticazione. **Riaperta** dalla cancellazione degli utenti (F1) |
| NAT per API esterne? | **Risolta**: no |
| Le Lambda devono stare tutte nella VPC? | **Risolta**: solo quelle con DB |
| Nomi dei ruoli | **Decisa ma non applicata**: `_to_do` nel diagramma; il ruolo del proxy non segue la convenzione (C5) |
| Aperto: endpoint Secrets Manager | **Ancora aperta**, si chiude solo in prova (F4) |
| Aperto: IAM end-to-end al posto dei secret | **Si può chiudere**: tenete il modello con i secret, già documentato; l'alternativa va solo saputa citare |
| Aperto: nomi dei ruoli nel diagramma | **Aperta** (C5 e sezione 7) |

Domande nuove da aggiungere a `problems.md`:
1. Cancellazione e modifica dell'account: da Cognito lato frontend o con un endpoint? (F1)
2. Registrazione dei file caricati: notifica S3 o conferma dal client? Gateway endpoint S3 sì o no? (F2)
3. File pubblici o privati? (N5)
4. Uso della reader: solo failover o anche letture? (F3)
5. Quanti utenti PostgreSQL? (I4)

---

## 7. Ruoli e policy IAM da scrivere (punto di partenza per la prossima fase)

Convenzione: `real-estate-prod-<componente>-<scopo>`. Nomi delle risorse proposti (da riportare anche nel diagramma):
topic `real-estate-prod-notifications`, coda `real-estate-prod-notifications-queue`, DLQ
`real-estate-prod-notifications-dlq`, bucket `real-estate-prod-website-<suffisso>` e `real-estate-prod-files-<suffisso>`
(i nomi dei bucket sono unici nel mondo), API `<API_ID>`, distribuzioni `<DIST_SITE_ID>` e `<DIST_FILES_ID>`.
Abbreviazioni: `<ACC>` = account ID, `<REG>` = `eu-south-1`.

### 7.1 Execution role delle Lambda (identity policy + trust)
Trust per tutti: `trust-relationships/lambda.json` (principal `lambda.amazonaws.com`, `sts:AssumeRole`), che esiste già.

| # | Ruolo | Policy gestite | Azioni (policy vostra) | Risorse |
| --- | --- | --- | --- | --- |
| 1 | `real-estate-prod-lambda-property-role` | `AWSLambdaBasicExecutionRole`, `AWSLambdaVPCAccessExecutionRole` | `rds-db:connect`; `sns:Publish` | `arn:aws:rds-db:<REG>:<ACC>:dbuser:<prx-ID>/property_user`; `arn:aws:sns:<REG>:<ACC>:real-estate-prod-notifications` |
| 2 | `real-estate-prod-lambda-users-role` | come sopra | `rds-db:connect`; `sns:Publish` | `…dbuser:<prx-ID>/users_user`; topic |
| 3 | `real-estate-prod-lambda-offers-role` | come sopra | `rds-db:connect`; `sns:Publish` | `…dbuser:<prx-ID>/offers_user`; topic |
| 4 | `real-estate-prod-lambda-files-role` | come sopra | `rds-db:connect`; `sns:Publish`; `s3:DeleteObject`, `s3:GetObject` (serve anche per `HeadObject` e per un eventuale presigned GET) | `…dbuser:<prx-ID>/files_user`; topic; `arn:aws:s3:::real-estate-prod-files-<suffisso>/uploads/*` |
| 5 | `real-estate-prod-lambda-presigned-role` | come sopra | `rds-db:connect`; `s3:PutObject` (il presigned POST ha **al massimo** questi permessi) | `…dbuser:<prx-ID>/presigned_user`; `arn:aws:s3:::real-estate-prod-files-<suffisso>/uploads/*` |
| 6 | `real-estate-prod-lambda-mailer-role` | solo `AWSLambdaBasicExecutionRole` (fuori VPC) | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`; `ses:SendEmail` | `arn:aws:sqs:<REG>:<ACC>:real-estate-prod-notifications-queue`; `arn:aws:ses:<REG>:<ACC>:identity/<mittente o dominio>` con condizione `ses:FromAddress` (più l'ARN del configuration set, se lo usate) |

Note:
- `sns:Publish` va solo alle Lambda che pubblicano davvero un evento: decidete quali e togliete il permesso alle altre.
- Il limite di dimensione e di tipo di un upload **non** lo fa IAM: lo fanno le *conditions* del presigned POST
  (`content-length-range`, `Content-Type`).
- Esempio completo per la Property (da duplicare):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsPropertyUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/property_user"
    },
    {
      "Sid": "PublishNotificationEvents",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications"
    }
  ]
}
```

### 7.2 Ruolo già esistente
| # | Ruolo | Trust | Azioni | Risorse |
| --- | --- | --- | --- | --- |
| 7 | `rds-proxy-secrets-role`, da rinominare in `real-estate-prod-rds-proxy-secrets-role` (C5) | `rds.amazonaws.com` | `secretsmanager:GetSecretValue` (+ `kms:Decrypt` con `kms:ViaService` solo se CMK) | gli ARN completi dei 5 secret `real-estate/prod/database/<utente>-XXXXXX` |

### 7.3 Resource policy (chi può usare la mia risorsa)
| # | Dove si attacca | Principal | Azione | Risorsa | Condizione |
| --- | --- | --- | --- | --- | --- |
| 8 | Ciascuna delle 5 Lambda di business (permesso Lambda, `aws lambda add-permission`) | `apigateway.amazonaws.com` | `lambda:InvokeFunction` | la funzione | `aws:SourceArn` = `arn:aws:execute-api:<REG>:<ACC>:<API_ID>/*` (si può restringere per route) |
| 9 | Bucket sito | `cloudfront.amazonaws.com` | `s3:GetObject` | `arn:aws:s3:::real-estate-prod-website-<suffisso>/*` | `AWS:SourceArn` = `arn:aws:cloudfront::<ACC>:distribution/<DIST_SITE_ID>` |
| 10 | Bucket file | `cloudfront.amazonaws.com` | `s3:GetObject` | `arn:aws:s3:::real-estate-prod-files-<suffisso>/*` (o solo il prefisso pubblico, vedi N5) | `AWS:SourceArn` = distribuzione file |
| 11 | Entrambi i bucket (statement Deny) | `"*"` | `s3:*` | bucket e `bucket/*` | `Bool aws:SecureTransport = false` → **Deny** |
| 12 | Coda `real-estate-prod-notifications-queue` | `sns.amazonaws.com` | `sqs:SendMessage` | ARN della coda | `ArnEquals aws:SourceArn` = ARN del topic |
| 13 | Files Lambda, solo se scegliete la notifica S3 (F2) | `s3.amazonaws.com` | `lambda:InvokeFunction` | la funzione | `aws:SourceArn` = `arn:aws:s3:::real-estate-prod-files-<suffisso>`, `aws:SourceAccount` = `<ACC>` |

Le policy 9 e 10 con OAC, la 12 e la 11 hanno già un esempio scritto in `03-iam-ruoli-policy-trust.md` (sezioni 7.3,
7.4 e 7.6): vanno solo copiate con i nomi nuovi.

### 7.4 Cose che **non** richiedono un ruolo (e va saputo dire)
- **SQS → Mailer Lambda**: l'event source mapping legge la coda con il **ruolo della Mailer** (voce 6); sulla Lambda
  non serve un permesso.
- **DLQ**: lo spostamento lo fa SQS con la `RedrivePolicy` della coda principale (`deadLetterTargetArn`,
  `maxReceiveCount`), senza permessi IAM.
- **Authorizer JWT**: valida i token con le chiavi pubbliche del user pool, senza ruolo.
- **HTTP API → CloudWatch Logs**: basta indicare il log group nello stage; il ruolo a livello account serve solo alle
  REST API.
- **Aurora**: service-linked role `AWSServiceRoleForRDS`, creato e gestito da AWS (`aurora.md`, già scritto).
- **Topic SNS**: la policy di default permette all'account proprietario di pubblicare; la restrizione la fa
  l'identity policy delle Lambda.

### 7.5 Facoltativi (punti in più)
| # | Cosa | Principal / dove | Contenuto |
| --- | --- | --- | --- |
| 14 | Identità di deploy | il vostro utente o ruolo | `iam:PassRole` su `arn:aws:iam::<ACC>:role/real-estate-prod-*` con condizione `iam:PassedToService` ∈ {`lambda.amazonaws.com`, `rds.amazonaws.com`} |
| 15 | Endpoint policy dell'endpoint SNS | policy sull'endpoint VPC | permette solo `sns:Publish` sul topic del progetto, per principal dell'account (`aws:PrincipalAccount`) |
| 16 | Key policy KMS | solo se usate CMK | ammettere il ruolo del proxy (secret) o `sns.amazonaws.com` (coda cifrata con CMK, vedi N4) |

---

## 8. Cosa ho verificato e cosa no

**Verificato sulla documentazione AWS, oggi:**
- Disponibilità a Milano di Cognito (user e identity pool), SES (API sì, SMTP no), RDS Proxy con Aurora PostgreSQL e
  Aurora Serverless v2 (link nella sezione 1).
- Il ruolo del proxy (trust, `GetSecretValue`, `kms:Decrypt` con `kms:ViaService`) è identico all'esempio ufficiale.
- Prerequisiti di rete del proxy: almeno 2 subnet in AZ diverse, almeno 10 IP liberi; nessuna menzione dell'endpoint di
  Secrets Manager.
- HTTP API: la cache della Lambda Authorizer è facoltativa e per default vale per tutte le route; l'access logging non
  richiede il ruolo CloudWatch dell'account.
- SNS non consegna a code SQS cifrate con la chiave gestita `aws/sqs` (pagina SNS e articolo re:Post).

**Non verificato puntualmente (conoscenza consolidata, da ricontrollare se il professore insiste):**
- Disponibilità a Milano di Lambda, HTTP API, S3, SNS, SQS, Secrets Manager e degli endpoint VPC `sns`,
  `secretsmanager` e gateway `s3` (servizi di base in tutte le regioni commerciali).
- Che WAF non si associ alle HTTP API.
- Che Cognito accetti `DeleteUser` e `UpdateUserAttributes` dal browser con l'access token (sono API pubbliche, ma
  dipendono dagli scope dell'app client).
- Se il proxy abbia bisogno dell'endpoint di Secrets Manager: la documentazione non lo dice, si scopre solo in prova.

**Non fatto:** non ho aperto il `.drawio` in draw.io (l'ho letto come XML e ho guardato il PNG esportato) e non ho creato
risorse su un account AWS.
