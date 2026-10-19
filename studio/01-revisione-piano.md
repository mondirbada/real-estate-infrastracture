# Revisione del piano — real-estate-infrastructure

Revisione di `main` (commit `8a3ccba`): `architecture.md`, `problems.md`, `am-management/`, `diagrams/updated.drawio`.
Giudizio generale: **l'impianto è sensato e sopra la media per un progetto ITS**. Serverless, multi-AZ, DB privato, IAM documentato con criterio. I problemi sono pochi ma alcuni vanno sistemati prima della presentazione, perché il professore li noterà.

Legenda: 🔴 da correggere prima di presentare · 🟡 da chiarire / migliorare · 🟢 va bene così.

---

## 1. Errori concettuali (🔴)

### 1.1 Security group su servizi che non vivono in una VPC
Il diagramma ha `sg-cloudfront-files`, `sg-cloudfront-website`, `sg-s3-files`, `sg-s3-website`, `sg-api-gateway`, `sg-cognito`, `sg-sqs`, `sg-ses`, `sg-sns`, `sg-cloudwatch`.
**I security group si attaccano a interfacce di rete (ENI) dentro una VPC.** CloudFront, S3, API Gateway, Cognito, SQS, SES, SNS, CloudWatch, EventBridge sono servizi *regionali o globali gestiti da AWS*: non hanno ENI nella tua VPC e quindi non hanno security group.
Security group che hanno senso nel progetto:
- `sg-lambda-*` (le Lambda **dentro la VPC**),
- `sg-rds-proxy`, `sg-rds`,
- `sg-vpc-interface-*` (gli *interface endpoint*, che sono ENI vere).

Come proteggi gli altri? Con **IAM** (identity policy + resource policy: bucket policy S3, queue policy SQS), non con la rete.
→ Togliere quegli SG dal diagramma. È l'errore più visibile.

### 1.2 Authorizer: ruoli sovrapposti e ownership nel posto sbagliato
Il testo dice che API Gateway valida i JWT di Cognito **e** che una Lambda Authorizer "autorizza l'accesso" e gestisce "ownership delle proprietà".
- Su un singolo metodo/route API Gateway usa **un solo** authorizer: o quello nativo Cognito/JWT, o la Lambda. Non si impilano.
- La **ownership** ("questo immobile è tuo?") richiede una lettura del DB. L'authorizer ha una **cache** (di default ~5 min, chiave = token): la policy generata viene riusata anche per path e risorse diverse. Una decisione per-risorsa lì dentro è fragile e può dare accessi sbagliati.
- Una Lambda Authorizer in VPC per leggere il DB aggiunge latenza e cold start a *ogni* richiesta.

**Proposta semplice e difendibile:**
1. API Gateway con authorizer **Cognito/JWT** (nativo, zero codice): risponde a "chi sei, il token è valido?".
2. Il **ruolo** (agente/acquirente/admin) arriva da un gruppo Cognito o da un claim nel token (`cognito:groups`).
3. La **ownership** la controlla la Lambda di business (la Property Lambda) con una query: `WHERE id = :id AND owner_id = :sub`. Il `sub` del token è l'ID utente.
4. Se serve davvero una Lambda Authorizer, deve fare solo ciò che l'authorizer nativo non sa fare (es. regole di tenant/ruolo), restare **fuori dalla VPC** e non toccare il DB.

Equivalente Spring Boot: l'authorizer nativo è il filtro JWT di Spring Security (`oauth2ResourceServer`); l'ownership è un controllo nel service (`@PreAuthorize`/check del proprietario), non nel filtro.

### 1.3 "CloudFront utilizza l'autenticazione tramite Cognito"
Impreciso. CloudFront serve file statici e non autentica nessuno. È la **SPA** (React) che fa il login con Cognito (hosted UI/Amplify/SDK), ottiene i token e li manda ad API Gateway nell'header `Authorization`. Se non c'è Lambda@Edge davanti, il sito statico è pubblico e va bene così: i dati stanno dietro l'API.
→ Riscrivere la frase.

---

## 2. Incoerenze tra documenti e diagramma (🟡)

| Tema | `architecture.md` | `updated.drawio` | Da fare |
| --- | --- | --- | --- |
| Lambda di business | 4: Proprietà, Utenti, Offerte, Media&File | Property, User, Offers, **Files, Presigned**, Mailer | Decidere: Files e Presigned sono una cosa o due? Allineare il testo |
| Notifiche | EventBridge → SQS → Notification Lambda → SES | SQS, SES, **SNS**, Mailer Lambda; **EventBridge non c'è** | Togliere SNS o spiegare perché c'è; aggiungere EventBridge (o toglierlo, vedi 3.4); uniformare "Notification Lambda" / "Mailer Lambda" |
| Secrets Manager | Non citato | Presente, con `sg-secret-manager` e PrivateLink | Aggiungere al testo (il README IAM dice già "verrà aggiunto") |
| PrivateLink | `problems.md`: "Cognito PrivateLink" | PrivateLink per **SM e SNS** | Decidere quali endpoint servono davvero (vedi 3.2) |
| CloudWatch | Non citato | Presente | Una riga nel testo: log delle Lambda, metriche, allarmi |
| Authorizer | Lambda Authorizer | Non visibile | Vedi 1.2 |

Nota: il PNG `diagrams/updated.drawio.png` è una versione **più vecchia e più scarna** del `.drawio` (non ha SQS, SES, SG). Rigenerare PNG/SVG dopo ogni modifica, altrimenti nella presentazione mostrate il diagramma sbagliato.

---

## 3. Risposte alle domande di `problems.md`

### 3.1 "Le Lambda devono davvero stare nella VPC?"
**Solo quelle che parlano con l'RDS Proxy.** L'RDS Proxy ha endpoint solo dentro la VPC (non si espone su Internet), quindi per raggiungerlo la Lambda deve avere ENI nella VPC (associata a subnet e security group).
Le altre Lambda **non devono** starci e anzi stanno meglio fuori: niente cold start extra, niente problemi di uscita verso Internet, niente costo di endpoint.
- Probabilmente fuori: Presigned Lambda (firma un URL S3, non serve DB), Notification/Mailer Lambda (se l'evento contiene già email e testo), eventuale authorizer.
- Dentro: Property, User, Offers (e Files se scrive metadati sul DB).
Questa scelta riduce molto sia la complessità sia il costo (vedi 3.2).

### 3.2 NAT o VPC endpoint? (cuore del problema)
Una Lambda in VPC **non ha accesso a Internet** nemmeno se sta in una subnet pubblica (non ha IP pubblico). Per chiamare servizi AWS (EventBridge, SQS, S3, Secrets Manager…) ci sono due strade:
- **VPC endpoint**: *gateway* (S3, DynamoDB — **gratuiti**) e *interface* (quasi tutto il resto, ENI + costo orario per AZ + traffico).
- **NAT Gateway**: costo fisso orario alto + traffico, uno per AZ per l'alta affidabilità.

Poiché non usate API esterne (come scritto: niente Stripe), **non serve il NAT**. Servono solo gli endpoint per ciò che le Lambda *in VPC* chiamano davvero:
- Se le Lambda in VPC pubblicano eventi: endpoint per EventBridge (o SQS, se scrivono direttamente in coda).
- S3 da dentro la VPC: gateway endpoint, gratis.
- **Secrets Manager: le Lambda non lo chiamano** (con IAM auth verso il proxy è il proxy a leggerlo, e il proxy lo raggiunge da solo). Quindi `sg-private-link-sm` / `sg-vpc-interface-sm` nel diagramma probabilmente **non servono**. Verificare: se non c'è codice Lambda che chiama `GetSecretValue`, togliere.
- **Cognito**: le Lambda in VPC non hanno motivo di chiamare Cognito (API Gateway valida i JWT da sé). PrivateLink per Cognito esiste da novembre 2025 ma ha limiti (non vale per hosted UI/managed login, non per client credentials, e un user pool con dominio assegnato non è compatibile). Per voi: **non serve**.
- SNS: se SNS non serve (vedi 2), nessun endpoint.

→ Conclusione per la presentazione: *"niente NAT, perché non chiamiamo Internet; solo gateway endpoint S3 (gratis) e gli interface endpoint strettamente necessari"*. Fa una bella figura e mostra che avete ragionato sui costi. Ogni interface endpoint costa per AZ: se ne avete 3 su 2 AZ sono 6 ENI fatturate.

### 3.3 "Entrambe le AZ necessitano di subnet pubblica e privata?"
No. Una subnet è "pubblica" solo se la sua route table ha una rotta verso un **Internet Gateway**. Servono subnet pubbliche per: NAT Gateway, load balancer pubblici, istanze con IP pubblico. Nel vostro progetto non c'è niente di tutto questo: tutto il traffico entra da CloudFront e API Gateway, che stanno fuori dalla VPC.
- **Minimo necessario:** 2 subnet private in 2 AZ (obbligatorio: il *DB subnet group* di RDS/Aurora richiede subnet in almeno 2 AZ, e anche l'RDS Proxy).
- Subnet pubbliche inutilizzate non sono obbligatorie e non servono. Se un giorno aggiungete un NAT, allora sì, una pubblica per AZ.
Il diagramma ha un'unica VPC "PRIVATE" con due AZ: coerente.

### 3.4 "Ruoli e policy: reali o con nomi espliciti?"
Entrambi, in posti diversi:
- Nei documenti usate **nomi espliciti con una convenzione** (es. `real-estate-prod-lambda-property-role`), così il professore capisce a colpo d'occhio cosa fa ogni ruolo.
- Gli **ID/ARN reali** (account, ID proxy `prx-…`, ARN dei secret) restano segnaposto `<...>` nei file in Git, e li sostituite al momento del provisioning. È già quello che fa `am-management/`: va bene.
- Non committate mai account ID reali con credenziali, e mai password.

---

## 4. Punti da rafforzare nel piano (🟡)

1. **Notifiche: EventBridge è davvero necessario?** Le Lambda possono mettere messaggi direttamente su SQS. EventBridge ha senso se più consumer diversi vogliono ascoltare lo stesso evento (email oggi, SMS/webhook domani). Va bene tenerlo, ma motivate la scelta ("pronti a più consumer") oppure semplificate. Se una Lambda in VPC pubblica su EventBridge serve un interface endpoint: un motivo in più per semplificare.
2. **SQS: manca la Dead-Letter Queue.** Se la Notification Lambda fallisce, il messaggio ritorna in coda all'infinito (fino alla retention). Una DLQ con `maxReceiveCount` è la risposta standard e vale una riga nel diagramma. Il visibility timeout deve essere ≥ al timeout della Lambda (AWS consiglia 6×).
3. **SES: sandbox.** Un account nuovo parte in sandbox: si può inviare solo verso indirizzi verificati e con quote basse. Serve richiedere l'accesso alla produzione e verificare dominio/mittente (DKIM). Per la demo d'esame: usate indirizzi verificati. SES è disponibile a Milano (eu-south-1); l'endpoint SMTP va verificato nella documentazione, ma noi usiamo l'API da Lambda.
4. **S3 sito: bucket privato + Origin Access Control (OAC).** Il testo non lo dice. Il bucket non deve essere pubblico né in modalità "static website hosting": CloudFront legge con OAC e la bucket policy concede `s3:GetObject` solo al servizio CloudFront per quella specifica distribuzione (condizione `AWS:SourceArn`). Stessa logica per il bucket dei file se servito via CloudFront.
5. **Upload media con presigned URL.** Il testo dice "S3 eventualmente limitato per file e dimensioni". Un presigned **PUT** non può limitare la dimensione; un presigned **POST** sì (`content-length-range`). Va scelto in modo consapevole. Poi: CORS sul bucket, tipi consentiti, scadenza breve (es. 5 min), la Lambda che firma ha `s3:PutObject` sul prefisso giusto (l'URL eredita i permessi di chi firma), chiave dell'oggetto con prefisso per utente e UUID.
6. **Certificato per CloudFront.** Se usate un dominio custom, il certificato ACM per CloudFront deve stare in **us-east-1** (non a Milano). Per un esame potete usare il dominio `*.cloudfront.net` e dirlo.
7. **Lambda "monolitiche" per ambito.** Una Lambda con router interno (a volte chiamata *lambdalith*) è una scelta legittima e più semplice da gestire per studenti. Svantaggi da saper dire: ruolo IAM unico e quindi meno granulare, cold start più pesante, un bug rompe tutto l'ambito. Alternativa: una Lambda per route. Dite che l'avete scelta per semplicità (è la stessa idea di un controller Spring) e che avete consapevolezza del compromesso.
8. **Aurora: costo e dimensionamento.** Writer + replica in 2 AZ + RDS Proxy + (eventuali) endpoint sono la parte di costo più alta del progetto. Alternative da citare: Aurora Serverless v2 (paga la capacità usata) per carichi bassi o variabili. Il testo già ammette che il proxy "non è strettamente necessario": ottima onestà, tenetela. Se lo tenete, la motivazione solida è che le Lambda possono moltiplicare le connessioni e il proxy le raggruppa (pooling).
9. **Mancano nel piano** (anche solo come "sviluppi futuri"): backup e retention di Aurora; **WAF** davanti a CloudFront/API Gateway; **CloudWatch** con allarmi (errori Lambda, DLQ non vuota, CPU DB); **throttling/usage plan** di API Gateway; ambienti separati (c'è solo "PRODUCTION"); IaC (CloudFormation/Terraform/CDK); stima dei costi (AWS Pricing Calculator); modello dati.
10. **Disponibilità dei servizi a Milano.** `eu-south-1` è una *opt-in region* (va abilitata nell'account) e a volte ha funzioni in ritardo rispetto a Francoforte/Irlanda. Prima di congelare il piano verificare che tutti i servizi che usate siano disponibili lì; per CloudFront, ACM del certificato (us-east-1) e WAF per CloudFront cambia la regione.

---

## 5. Revisione di `am-management/` (IAM)

Qui la qualità è alta e la documentazione è **tecnicamente corretta**. Ho verificato punto per punto:
- 🟢 Trust policy `rds-proxy.json` con principal `rds.amazonaws.com` e `sts:AssumeRole`: giusto.
- 🟢 Trust policy `lambda.json` con `lambda.amazonaws.com`: giusto.
- 🟢 Distinzione trust policy (chi assume) / permissions policy (cosa può fare): spiegata bene.
- 🟢 `rds-db:connect` su `arn:aws:rds-db:<regione>:<account>:dbuser:<prx-ID>/<utente>` con l'**ID risorsa del proxy** (non il nome): corretto e tutt'altro che banale.
- 🟢 Modello "client → proxy con IAM+TLS, proxy → DB con password da Secrets Manager": è una configurazione valida e coerente.
- 🟢 Condizione `kms:ViaService` per la CMK: ottima pratica di least privilege.
- 🟢 Aurora con service-linked role `AWSServiceRoleForRDS`, non da ricreare: giusto.
- 🟢 Separazione dei permessi di provisioning (`iam:PassRole`) dai ruoli applicativi: matura.

Cosa manca (non è un errore, è che il resto dei ruoli non è ancora scritto): sono **tutti i ruoli e le resource policy degli altri servizi**. Il professore chiederà anche questi. Elenco di ciò che dovrebbe esserci:

| Collegamento | Cosa serve | Tipo |
| --- | --- | --- |
| Lambda (tutte) | Execution role: log CloudWatch (`AWSLambdaBasicExecutionRole`) | identity |
| Lambda in VPC | + `AWSLambdaVPCAccessExecutionRole` (crea/gestisce le ENI) | identity |
| API Gateway → Lambda | Permesso `lambda:InvokeFunction` per il principal `apigateway.amazonaws.com` sulla singola Lambda (`aws lambda add-permission`) | **resource-based** sulla Lambda |
| API Gateway → CloudWatch | Ruolo a livello account per scrivere i log di accesso (solo REST API) | identity + trust `apigateway.amazonaws.com` |
| CloudFront → S3 | Bucket policy con principal `cloudfront.amazonaws.com` + condizione `AWS:SourceArn` della distribuzione (OAC) | **resource-based** sul bucket |
| Lambda → EventBridge/SQS | `events:PutEvents` o `sqs:SendMessage` sul solo bus/coda | identity |
| EventBridge → SQS | Queue policy: principal `events.amazonaws.com`, `sqs:SendMessage`, condizione `aws:SourceArn` della regola | **resource-based** sulla coda |
| SQS → Notification Lambda | Il ruolo della Lambda con `sqs:ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes` (esiste la managed policy `AWSLambdaSQSQueueExecutionRole`) | identity |
| Notification Lambda → SES | `ses:SendEmail` limitato all'identità verificata (condizione su `ses:FromAddress`) | identity |
| Presigned Lambda → S3 | `s3:PutObject` sul prefisso del bucket file (e `s3:GetObject` se firma anche le letture) | identity |
| Cognito (se usate gruppi/ruoli identità) | Ruoli per le identity pool, trust `cognito-identity.amazonaws.com` con condizioni — solo se usate le **identity pool**; per solo user pool + JWT non servono | trust |
| Chi fa il deploy | Un utente/ruolo con `iam:PassRole`, ecc. (già citato) | identity |

Piccoli ritocchi alla documentazione esistente:
- `am-management/README.md` dice che "Secrets Manager verrà aggiunto al diagramma in seguito": ma il diagramma lo contiene già. Aggiornare.
- Dire esplicitamente che Lambda **non** assumono il ruolo del proxy e non leggono secret: già scritto, ottimo; aggiungere che il token IAM dura **15 minuti** e che la connessione già aperta non scade a quel punto.
- Specificare che il proxy deve avere **"Require TLS"** attivo e il client usare `sslmode=require`/`verify-full` con il bundle CA di RDS.
- Nei secret: dire che il formato JSON atteso dal proxy è `{"username": "...", "password": "..."}` (ok, già scritto).

---

## 6. Cose fatte bene (da valorizzare nella presentazione)
- Scelte spiegate con il "perché" e con onestà sui limiti (es. nota sul proxy "non strettamente necessario").
- `problems.md` mostra che il gruppo si fa domande vere invece di copiare un diagramma.
- Multi-AZ per il DB, DB in subnet private, nessun accesso diretto Lambda→Aurora (solo via proxy).
- IAM con least privilege, trust separata, niente password nel repo, ordine di configurazione dichiarato.
- README IAM dichiara chiaramente che sono template e non risorse esistenti.

## 7. Ordine consigliato delle correzioni
1. Togliere i security group dai servizi non-VPC (1.1) e rigenerare PNG/SVG.
2. Riscrivere la parte auth: authorizer nativo + ownership nella Lambda (1.2, 1.3).
3. Allineare lista Lambda e notifiche tra testo e diagramma (sezione 2).
4. Decidere quali Lambda stanno in VPC e togliere gli endpoint inutili (3.1, 3.2).
5. Aggiungere DLQ, SES sandbox, OAC, presigned POST (sezione 4).
6. Scrivere i ruoli mancanti (sezione 5).
