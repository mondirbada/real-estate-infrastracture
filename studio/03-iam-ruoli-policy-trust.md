# IAM — ruoli, policy, trust relationship (con gli esempi del progetto)

Questa è la parte su cui puntare. Obiettivo: saper rispondere a *"chi può fare cosa su quale risorsa, e perché?"* per ogni freccia del diagramma.

---

## 1. L'idea in tre righe
- **IAM** (Identity and Access Management) decide **chi (principal) può fare quale azione su quale risorsa, a quali condizioni**. È globale e gratuito.
- Di default **tutto è negato**. Un permesso esiste solo se una policy lo **concede** (Allow) e nessuna lo **nega** (Deny).
- Ogni chiamata API AWS (anche quella della console) è firmata da un'identità e valutata da IAM.

Analogia con Spring Security: *principal* = utente autenticato, *action* = `hasAuthority`, *resource* = l'oggetto. Qui però i principal sono anche **servizi** (Lambda, RDS…).

---

## 2. Le entità di IAM

| Entità | Cosa è | Credenziali | Quando |
| --- | --- | --- | --- |
| **Root user** | Il proprietario dell'account, può tutto | email+password | Mai per lavoro quotidiano; MFA e basta |
| **IAM user** | Una persona/app con credenziali a lungo termine | password console, access key | Evitare per le app; per le persone meglio IAM Identity Center |
| **IAM group** | Insieme di utenti a cui attacchi policy | — | Per dare gli stessi permessi a più utenti (non è un principal) |
| **IAM role** | Un'identità **senza credenziali proprie** che chiunque (autorizzato) può **assumere** per ottenere credenziali **temporanee** | credenziali temporanee da STS | **Per i servizi AWS e per le app**: la scelta giusta |
| **Policy** | Documento JSON di permessi | — | Si attacca a identità o risorse |

**Ruolo vs utente:** un ruolo non ha password né access key permanenti; chi lo assume riceve credenziali valide da minuti a ore (**STS**, Security Token Service). Se trapelano, scadono. È per questo che Lambda, EC2, ecc. usano ruoli.

---

## 3. Policy: anatomia e tipi

### 3.1 Anatomia di un documento
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApplicationDatabaseSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": ["arn:aws:secretsmanager:eu-south-1:123456789012:secret:real-estate/prod/database/app_user-AbCdEf"],
      "Condition": { "StringEquals": { "aws:RequestedRegion": "eu-south-1" } }
    }
  ]
}
```
- **Version**: sempre `"2012-10-17"` (è la versione del linguaggio, non una data tua).
- **Statement**: lista di regole.
- **Sid**: etichetta opzionale.
- **Effect**: `Allow` o `Deny`.
- **Action**: `servizio:Operazione`, con wildcard (`s3:Get*`). `NotAction` per "tutto tranne".
- **Resource**: gli **ARN** a cui si applica. `*` = tutte. Non tutte le azioni supportano restrizioni per risorsa.
- **Principal**: **solo** nelle policy *resource-based* e nelle *trust policy* (chi). Non va nelle identity policy (lì il "chi" è implicito: chi la ha attaccata).
- **Condition**: restringe quando si applica (IP, regione, tag, `aws:SourceArn`, `kms:ViaService`…).

### 3.2 ARN
`arn:partition:service:region:account-id:resource`. Esempio: `arn:aws:s3:::nome-bucket/prefisso/*` (S3 non ha regione/account nell'ARN), `arn:aws:rds-db:eu-south-1:123456789012:dbuser:prx-0abc123/app_user`.

### 3.3 Tipi di policy
1. **Identity-based** (attaccate a utente/gruppo/ruolo): "cosa può fare *questa identità*".
   - **AWS managed** (es. `AWSLambdaBasicExecutionRole`): create da AWS, comode ma spesso larghe.
   - **Customer managed**: le scrivi tu, riusabili.
   - **Inline**: incorporate in una sola identità, 1:1.
2. **Resource-based** (attaccate alla risorsa): "chi può usare *questa risorsa*". Hanno il `Principal`. Esempi: bucket policy S3, queue policy SQS, **policy della Lambda**, key policy KMS, resource policy dei secret.
3. **Trust policy**: è una resource-based policy **del ruolo**: dice **chi può assumerlo** (`sts:AssumeRole`).
4. **Permissions boundary**: *massimo* di permessi che un'identità può avere (non concede nulla da sola).
5. **SCP** (Service Control Policy, AWS Organizations): tetto sui permessi di tutto un account/OU. Utile sapere che esiste.
6. **Session policy**: restringe ulteriormente una sessione assunta.

### 3.4 Trust policy vs permissions policy (la domanda classica)
Ogni **ruolo** ha **due** cose distinte:
- **Trust policy** (relazione di fiducia): **chi può assumere il ruolo**. Ha `Principal` e azione `sts:AssumeRole`.
- **Permissions policy** (una o più): **cosa può fare chi lo assume**.

Se manca la trust giusta, il servizio non può nemmeno assumere il ruolo; se manca la permissions policy, lo assume ma non può fare niente. Servono entrambe.

Esempio **trust** per una Lambda (file `trust-relationships/lambda.json` del progetto):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```
Lettura: *"il servizio Lambda può assumere questo ruolo"*. Per il proxy cambia solo il principal: `rds.amazonaws.com`.

Principal possibili: `{"Service": "..."}` (servizi AWS), `{"AWS": "arn:aws:iam::ACCOUNT:role/..."}` (altro ruolo/utente/account), `{"Federated": "cognito-identity.amazonaws.com"}` (identity federation).

**Mnemonico:** *trust = "chi entra", permissions = "cosa fa dentro".*

### 3.5 Come IAM decide (logica di valutazione, semplificata)
1. Di default: **negato** (*implicit deny*).
2. Se una qualsiasi policy applicabile ha un **Deny esplicito** → **negato**, sempre.
3. Altrimenti se c'è un **Allow** (e non lo blocca un boundary/SCP) → **consentito**.
4. Nello **stesso account**: basta che l'identity policy **oppure** la resource policy conceda (somma) — con eccezioni importanti come **KMS** (serve la key policy) e le resource policy che nominano un ruolo specifico.
5. **Cross-account**: servono **entrambe**: l'identity policy nell'account del chiamante e la resource policy nell'account della risorsa.

"Deny > Allow > default deny".

### 3.6 Concetti collegati
- **`iam:PassRole`**: per *assegnare* un ruolo a un servizio (es. dire a RDS Proxy "usa questo ruolo") serve il permesso `iam:PassRole` su quel ruolo. Evita che un utente con pochi permessi si "presti" un ruolo potente passandolo a un servizio. È ciò che il README chiama "permessi di provisioning".
- **Service-linked role (SLR)**: ruolo creato e **gestito da un servizio AWS** (es. `AWSServiceRoleForRDS`), con trust e policy fisse; non si modificano.
- **Least privilege**: partire stretti e allargare, non il contrario. Meglio specificare `Resource` precisi che `*`.
- **IAM Access Analyzer**, **credential report**, **CloudTrail**: per capire/verificare/audit.
- **Condition keys utili:** `aws:SourceArn` / `aws:SourceAccount` (anti **confused deputy**: evita che un altro account usi il servizio per farsi dare accesso alla tua risorsa), `aws:RequestedRegion`, `kms:ViaService`, `aws:PrincipalTag`.

---

## 4. Il modello mentale: "due porte" tra servizi
Quando il servizio A chiama il servizio B ci sono due domande distinte:
1. **A è autorizzato a farlo?** → identity policy sul **ruolo di A** (o resource policy di B che nomina A).
2. **B accetta A?** → a volte una **resource-based policy** su B (necessaria quando B è "invocato" da un servizio senza che quest'ultimo abbia un tuo ruolo).

Regola pratica per ricordare quale usare:
- **A "fa" qualcosa** con le sue credenziali (la tua Lambda scrive su SQS) → **ruolo di A** con permessi.
- **Un servizio "chiama" la tua risorsa** al posto tuo (API Gateway invoca Lambda, EventBridge scrive su SQS, CloudFront legge da S3) → **resource policy sulla risorsa** che ammette il principal-servizio, con `aws:SourceArn`.
- **Un servizio deve agire nel tuo account con un ruolo che gli dai** (RDS Proxy che legge i secret) → **ruolo con trust verso il servizio**.

---

## 5. Mappa dei ruoli del progetto (da avere davanti all'orale)

Convenzione nomi proposta: `real-estate-<env>-<componente>-<scopo>`.

| # | Chi | Meccanismo | Trust / Principal | Permessi chiave |
| --- | --- | --- | --- | --- |
| 1 | **Deploy** (voi/CI) | ruolo/utente con credenziali temporanee | l'identità del team | creare risorse, `iam:PassRole` sui ruoli sotto |
| 2 | **RDS Proxy** → `rds-proxy-secrets-role` | **ruolo** (già nel repo) | `rds.amazonaws.com` | `secretsmanager:GetSecretValue` sui soli secret app; `kms:Decrypt` se CMK |
| 3 | **Aurora** | service-linked role `AWSServiceRoleForRDS` | gestita da AWS | `AmazonRDSServiceRolePolicy` |
| 4 | **Lambda con DB** (Property/User/Offers/Files) | **execution role** per funzione | `lambda.amazonaws.com` | `AWSLambdaBasicExecutionRole`, `AWSLambdaVPCAccessExecutionRole`, `rds-db:connect` sul proxy+utente, `events:PutEvents` |
| 5 | **Presigned Lambda** | execution role | `lambda.amazonaws.com` | log + `s3:PutObject` su `arn:…:bucket-file/prefisso/*` |
| 6 | **Notification Lambda** | execution role | `lambda.amazonaws.com` | log + `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` + `ses:SendEmail` |
| 7 | **API Gateway → Lambda** | resource policy **sulla Lambda** | principal `apigateway.amazonaws.com`, `lambda:InvokeFunction`, `aws:SourceArn` = ARN dell'API | — |
| 8 | **CloudFront → S3** | bucket policy (OAC) | principal `cloudfront.amazonaws.com`, `s3:GetObject`, `aws:SourceArn` = distribuzione | — |
| 9 | **EventBridge → SQS** | queue policy | principal `events.amazonaws.com`, `sqs:SendMessage`, `aws:SourceArn` = regola | — |
| 10 | **API Gateway → CloudWatch Logs** | ruolo a livello account (REST API) | `apigateway.amazonaws.com` | `AmazonAPIGatewayPushToCloudWatchLogs` |
| 11 | **Cognito → Lambda** (trigger, se usati) | resource policy sulla Lambda | `cognito-idp.amazonaws.com` | `lambda:InvokeFunction` |

Il repo copre **2, 3 e (in parte) 4**. Il resto è ciò che dovete scrivere/spiegare.

---

## 6. Gli esempi reali del repo, spiegati riga per riga

### 6.1 `lambda-connect-proxy.json` — la Lambda può collegarsi al proxy come un certo utente DB
```json
{ "Effect": "Allow",
  "Action": "rds-db:connect",
  "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/<DB_USER>" }
```
- `rds-db:connect` è l'azione di **IAM database authentication**.
- La risorsa è `dbuser:<ID risorsa del proxy>/<utente PostgreSQL>`. L'ID è `prx-xxxxxxxx` (non il nome del proxy!).
- Quindi: *questa Lambda può connettersi a questo proxy solo come questo utente*. Una Lambda per le offerte potrà usare `offers_user`, quella utenti `users_user`, ecc.
- Questa è una policy **identity-based** dell'execution role.

### 6.2 `rds-proxy-read-secrets.json` — il proxy può leggere i secret
```json
{ "Action": "secretsmanager:GetSecretValue",
  "Resource": ["<APPLICATION_SECRET_ARN>"] }
```
Allegata al ruolo `rds-proxy-secrets-role`. Elenca **solo** i secret dei vostri utenti applicativi (con l'ARN completo e il suffisso casuale `-AbCdEf`). Non include il secret master.

### 6.3 `rds-proxy-decrypt-secrets.json` — solo se usate una CMK
`kms:Decrypt` sulla chiave, con `Condition: kms:ViaService = secretsmanager.eu-south-1.amazonaws.com`: il ruolo può decifrare **solo** tramite Secrets Manager, non usare la chiave per altro. Ricorda: anche la **key policy** della CMK deve ammettere il ruolo.

### 6.4 `trust-relationships/rds-proxy.json`
Principal `rds.amazonaws.com`: *il servizio RDS (proxy) può assumere il ruolo*. Così, quando il proxy deve leggere un secret, usa le credenziali temporanee di quel ruolo.

### 6.5 Il quadro completo delle autenticazioni (da saper disegnare)
```
Lambda  --(1: assume execution role: trust lambda.amazonaws.com)-->  credenziali temporanee
Lambda  --(2: token IAM firmato SigV4, rds-db:connect)-->  RDS Proxy
RDS Proxy --(3: assume rds-proxy-secrets-role: trust rds.amazonaws.com)--> credenziali temporanee
RDS Proxy --(4: GetSecretValue)--> Secrets Manager  → username/password
RDS Proxy --(5: password PostgreSQL)--> Aurora
```
Notate: ci sono **due livelli** di identità in gioco (IAM per entrare nel proxy, utente PostgreSQL per entrare nel DB) e **due ruoli** (Lambda, proxy). I `GRANT` SQL decidono poi cosa può fare l'utente PostgreSQL sulle tabelle: IAM non lo copre.

---

## 7. Esempi che *mancano* nel repo (scrivili tu per esercizio)

### 7.1 Execution role della Presigned Lambda (identity)
```json
{ "Version": "2012-10-17",
  "Statement": [{
    "Sid": "UploadToUserFilesPrefixOnly",
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::real-estate-prod-files/uploads/*"
  }] }
```
(+ trust `lambda.amazonaws.com`, + `AWSLambdaBasicExecutionRole`.) Ricorda: il presigned URL ha **al massimo** questi permessi.

### 7.2 Permesso ad API Gateway di invocare una Lambda (resource-based sulla Lambda)
CLI: `aws lambda add-permission --function-name property-lambda --statement-id apigw-invoke --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*/*/*`
Equivale a una policy con `Principal: {Service: apigateway.amazonaws.com}`.

### 7.3 Bucket policy per CloudFront con OAC
```json
{ "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::real-estate-prod-website/*",
    "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>" } }
  }] }
```
Spiega: *senza la condizione, qualunque distribuzione CloudFront di qualunque account potrebbe leggere il bucket (confused deputy)*.

### 7.4 Queue policy: EventBridge può scrivere su SQS
```json
{ "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "events.amazonaws.com" },
    "Action": "sqs:SendMessage",
    "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:notifications-queue",
    "Condition": { "ArnEquals": { "aws:SourceArn": "arn:aws:events:eu-south-1:<ACCOUNT_ID>:rule/notify-rule" } }
  }] }
```

### 7.5 Notification Lambda → SES (con restrizione sul mittente)
```json
{ "Effect": "Allow",
  "Action": "ses:SendEmail",
  "Resource": "arn:aws:ses:eu-south-1:<ACCOUNT_ID>:identity/noreply@tuodominio.it",
  "Condition": { "StringEquals": { "ses:FromAddress": "noreply@tuodominio.it" } } }
```

### 7.6 Un *Deny* esplicito utile
Impedire l'accesso non cifrato al bucket:
```json
{ "Effect": "Deny", "Principal": "*", "Action": "s3:*",
  "Resource": ["arn:aws:s3:::real-estate-prod-files", "arn:aws:s3:::real-estate-prod-files/*"],
  "Condition": { "Bool": { "aws:SecureTransport": "false" } } }
```

---

## 8. Esercizi e domande d'esame su IAM
1. **Differenza tra trust policy e permissions policy.** Fai l'esempio del ruolo del proxy.
2. **Differenza tra execution role di una Lambda e resource-based policy di una Lambda.** Chi è il "principal" in ciascun caso?
3. **Perché il ruolo del proxy ha una trust verso `rds.amazonaws.com`?** E cosa succederebbe se mancasse?
4. **Una Lambda non riesce a leggere un secret.** Elenca 4 cause possibili (policy mancante, ARN sbagliato, KMS, ruolo sbagliato associato, VPC senza accesso a SM…).
5. **Cosa fa `iam:PassRole` e perché serve a chi crea il proxy?**
6. **Perché preferire un ruolo a un utente IAM con access key per un'app?** (credenziali temporanee, nessun segreto da custodire, rotazione automatica).
7. **Cosa significa "implicit deny" e "explicit deny"? Chi vince?**
8. **In che caso servono sia identity policy che resource policy?** (cross-account; KMS).
9. **Cos'è il confused deputy e come lo previene `aws:SourceArn`?**
10. **Cos'è un service-linked role? Posso modificarlo?**
11. **Ogni Lambda dovrebbe avere il suo ruolo?** Sì: least privilege, audit più chiaro; compromesso: più ruoli da gestire.
12. **Le Lambda possono leggere i secret?** Nel vostro modello no, lo fa il proxy; è una scelta di sicurezza precisa.
13. **Come fai a dare a un utente Cognito il permesso di caricare un file?** (non con IAM utenti: l'app genera un presigned URL con i permessi del ruolo della Presigned Lambda, dopo aver controllato il JWT).
14. **Dove si "autorizza" un utente finale (ruolo agent/buyer) e dove si "autorizzano" i servizi?** Utenti finali: Cognito gruppi + controllo nella Lambda di business. Servizi: IAM. Sono **due livelli diversi** di autorizzazione, e confonderli è l'errore più comune.

### Esercizi pratici (account di prova, con Budgets attivo)
- Crea un ruolo per Lambda con la sola trust `lambda.amazonaws.com` e attacca `AWSLambdaBasicExecutionRole`; crea una Lambda e guarda i log.
- Aggiungi una policy che non permette `s3:PutObject` e prova a scrivere: leggi l'errore `AccessDenied`.
- Usa **IAM Policy Simulator** per simulare `rds-db:connect` e `secretsmanager:GetSecretValue`.
- Crea un bucket privato + CloudFront con OAC e leggi la bucket policy generata.
- Leggi in **CloudTrail** la chiamata `AssumeRole` della tua Lambda.

---

## 9. Mini-glossario
**Principal** chi agisce · **Action** cosa · **Resource** su cosa · **Condition** quando · **Effect** consenti/nega · **ARN** nome univoco di una risorsa · **STS** emette credenziali temporanee · **AssumeRole** operazione per assumere un ruolo · **Trust policy** chi può assumere il ruolo · **Permissions policy** cosa può fare · **Identity-based / resource-based** dove sta la policy · **SLR** ruolo gestito dal servizio · **Boundary / SCP** tetti massimi · **PassRole** permesso di consegnare un ruolo a un servizio · **Least privilege** minimo necessario.
