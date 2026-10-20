# IAM — ruoli, policy, trust relationship

IAM (Identity and Access Management) decide **chi** (principal) può fare **quale azione** su **quale risorsa**, a
**quali condizioni**. È un servizio globale e gratuito. Questo file raccoglie i concetti e l'elenco completo di ruoli e
resource policy del progetto; ogni JSON è mostrato e spiegato nel file del servizio che lo usa.

## Collegamenti

- Ruoli delle Lambda: [lambda.md](lambda.md) e i file delle sei Lambda.
- Ruolo del proxy e accesso al DB: [rds-proxy.md](rds-proxy.md), [secrets-manager.md](secrets-manager.md), [kms.md](kms.md).
- Ruolo di servizio di Aurora: [aurora.md](aurora.md).
- Resource policy: [api-gateway.md](api-gateway.md), [s3.md](s3.md), [cloudfront.md](cloudfront.md),
  [lambda-files.md](lambda-files.md), [sqs.md](sqs.md), [vpc-endpoints.md](vpc-endpoints.md).
- Autorizzazione degli utenti finali (non IAM): [cognito.md](cognito.md), [api-gateway.md](api-gateway.md).

## Concetti

Di default **tutto è negato**: un permesso esiste solo se una policy lo concede (Allow) e nessuna lo nega (Deny). Ogni
chiamata API AWS, anche quella fatta dalla console, è firmata da un'identità e valutata da IAM. I principal non sono solo
persone: sono anche **servizi** (Lambda, RDS, CloudFront…).

**Least privilege**: si parte stretti e si allarga solo se serve, non il contrario; meglio `Resource` precisi che `*`.

### Entità

| Entità | Cosa è | Credenziali | Nel progetto |
| --- | --- | --- | --- |
| Root user | Il proprietario dell'account, può tutto | email e password | Mai per il lavoro quotidiano; solo con MFA |
| IAM user | Persona o applicazione con credenziali a lungo termine | password, access key | Da evitare per le applicazioni; per le persone meglio IAM Identity Center |
| IAM group | Insieme di utenti a cui si attaccano le stesse policy | — | Non è un principal |
| **IAM role** | Identità **senza credenziali proprie**: chi è autorizzato la **assume** e riceve credenziali **temporanee** da STS | temporanee | Tutti i servizi del progetto usano ruoli |
| Policy | Documento JSON di permessi | — | Si attacca a identità o risorse |

Un ruolo non ha password né access key permanenti: se le credenziali temporanee trapelano, scadono. È per questo che
Lambda e RDS Proxy usano ruoli.

### Anatomia di una policy

- `Version`: sempre `"2012-10-17"`, la versione del linguaggio.
- `Statement`: lista di regole; `Sid` è un'etichetta facoltativa.
- `Effect`: `Allow` o `Deny`.
- `Action`: `servizio:Operazione` (es. `sns:Publish`), con wildcard; `NotAction` per "tutto tranne".
- `Resource`: gli ARN a cui si applica; `*` = tutte. Non tutte le azioni si possono limitare a una risorsa.
- `Principal`: **solo** nelle resource policy e nelle trust policy. Nelle identity policy il "chi" è implicito.
- `Condition`: restringe quando si applica. Chiavi utili: `aws:SourceArn` e `aws:SourceAccount` (anti confused deputy),
  `kms:ViaService`, `aws:SecureTransport`, `aws:PrincipalAccount`, `aws:RequestedRegion` (solo una regione),
  `aws:PrincipalTag` (tag dell'identità).

ARN: `arn:partition:servizio:regione:account:risorsa`. S3 non ha regione né account nell'ARN
(`arn:aws:s3:::bucket/prefisso/*`); per questo nelle resource policy verso S3 si aggiunge `aws:SourceAccount`.

### Tipi di policy

1. **Identity policy**, attaccata a utente, gruppo o ruolo: "cosa può fare questa identità". Può essere *AWS managed*
   (es. `AWSLambdaBasicExecutionRole`: comoda, spesso larga), *customer managed* (scritta da noi, riusabile) o *inline*.
2. **Resource policy**, attaccata alla risorsa: "chi può usare questa risorsa". Ha il `Principal`. Esempi: bucket policy
   S3, queue policy SQS, permesso di una Lambda, key policy KMS, resource policy di un secret, endpoint policy.
3. **Trust policy**: la resource policy **di un ruolo**; dice chi può assumerlo (`sts:AssumeRole`).
4. *Permissions boundary*, *SCP* (AWS Organizations) e *session policy*: tetti massimi, non concedono nulla da soli.
   Nel progetto non si usano, ma va saputo che esistono.

### Trust policy e permissions policy

Ogni ruolo ha due documenti distinti:

- **trust policy**: chi può assumere il ruolo ("chi entra");
- **permissions policy**: cosa può fare chi lo assume ("cosa fa dentro").

Servono entrambe: senza la trust giusta il servizio non riesce ad assumere il ruolo; senza permessi lo assume ma non può
fare niente. Principal possibili in una trust: `{"Service": "..."}` (servizi AWS, il nostro caso),
`{"AWS": "arn:aws:iam::ACCOUNT:role/..."}` (altri ruoli, utenti o account), `{"Federated": "..."}` (federazione).

### Come IAM decide

1. Di default tutto è **negato** (*implicit deny*).
2. Un **Deny esplicito** in qualunque policy applicabile nega sempre.
3. Altrimenti, se c'è un **Allow** (non bloccato da boundary o SCP), è consentito.
4. Nello **stesso account** basta che conceda l'identity policy **oppure** la resource policy, con eccezioni come KMS
   (serve anche la key policy).
5. **Cross-account** servono entrambe.

In breve: Deny esplicito > Allow > deny di default.

### Le due porte tra servizi

Quando il servizio A chiama il servizio B, la domanda è "chi autorizza?", e i casi sono tre:

- **A fa qualcosa con le sue credenziali** (la Lambda pubblica su SNS) → identity policy sul **ruolo di A**.
- **Un servizio chiama una nostra risorsa** (API Gateway invoca la Lambda, CloudFront legge S3, SNS scrive in SQS, S3
  invoca la Files Lambda) → **resource policy sulla risorsa** che ammette il servizio, con `aws:SourceArn`.
- **Un servizio agisce nel nostro account con un ruolo che gli diamo** (RDS Proxy legge i secret, Lambda esegue il
  codice) → **ruolo con trust verso quel servizio**.

### Confused deputy

Un servizio AWS che agisce per conto di più clienti potrebbe essere usato da un altro account per arrivare alle nostre
risorse. Le condizioni `aws:SourceArn` (solo la nostra API, distribuzione, topic, bucket) e `aws:SourceAccount` (solo il
nostro account) lo impediscono: tutte le resource policy del progetto verso servizi AWS le hanno.

### `iam:PassRole`

Per *consegnare* un ruolo a un servizio (dire a una Lambda o al proxy "usa questo ruolo") serve `iam:PassRole` su quel
ruolo. Impedisce a un'identità con pochi permessi di "prestare" a un servizio un ruolo più potente di lei.

### Service-linked role

Ruolo creato e gestito da un servizio AWS (es. `AWSServiceRoleForRDS`), con trust e permessi fissi: non si modifica e
non se ne crea una copia.

## Tutti i ruoli

Convenzione: `real-estate-<ambiente>-<componente>-<scopo>`. "log" = `AWSLambdaBasicExecutionRole`, "VPC" =
`AWSLambdaVPCAccessExecutionRole` (policy gestite da AWS).

| Ruolo | Chi lo assume (trust) | Permessi | Dettagli |
| --- | --- | --- | --- |
| `real-estate-prod-lambda-property-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-property.json`](iam/policies/lambda-property.json): `rds-db:connect` come `property_user`, `sns:Publish`, `s3:ListBucket` (prefisso `uploads/`) e `s3:DeleteObject` su `uploads/*` | [lambda-property.md](lambda-property.md) |
| `real-estate-prod-lambda-users-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-users.json`](iam/policies/lambda-users.json): `rds-db:connect` come `users_user`, `sns:Publish` | [lambda-users.md](lambda-users.md) |
| `real-estate-prod-lambda-offers-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-offers.json`](iam/policies/lambda-offers.json): `rds-db:connect` come `offers_user`, `sns:Publish` | [lambda-offers.md](lambda-offers.md) |
| `real-estate-prod-lambda-presigned-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-presigned.json`](iam/policies/lambda-presigned.json): `rds-db:connect` come `presigned_user`, `s3:PutObject` su `uploads/*` | [lambda-presigned.md](lambda-presigned.md) |
| `real-estate-prod-lambda-files-role` | `lambda.amazonaws.com` | log, VPC, [`lambda-files.json`](iam/policies/lambda-files.json): `rds-db:connect` come `files_user`, `s3:DeleteObject` su `uploads/*` | [lambda-files.md](lambda-files.md) |
| `real-estate-prod-lambda-mailer-role` | `lambda.amazonaws.com` | log, [`lambda-mailer.json`](iam/policies/lambda-mailer.json): lettura della coda, `ses:SendEmail` con `ses:FromAddress` | [lambda-mailer.md](lambda-mailer.md) |
| `real-estate-prod-rds-proxy-secrets-role` | `rds.amazonaws.com` | [`rds-proxy-read-secrets.json`](iam/policies/rds-proxy-read-secrets.json) (+ [`rds-proxy-decrypt-secrets.json`](iam/policies/rds-proxy-decrypt-secrets.json) solo con una CMK) | [rds-proxy.md](rds-proxy.md) |
| `AWSServiceRoleForRDS` (service-linked) | servizio RDS, gestita da AWS | `AmazonRDSServiceRolePolicy` | [aurora.md](aurora.md) |

Trust delle Lambda: [`iam/trust-relationships/lambda.json`](iam/trust-relationships/lambda.json), uguale per i sei ruoli.
Trust del proxy: [`iam/trust-relationships/rds-proxy.json`](iam/trust-relationships/rds-proxy.json).

## Tutte le resource policy

| Risorsa | Chi ammette | Condizioni | File | Dettagli |
| --- | --- | --- | --- | --- |
| Le 5 Lambda di business | `apigateway.amazonaws.com`, `lambda:InvokeFunction` | `AWS:SourceArn` = la nostra API | [`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json) | [api-gateway.md](api-gateway.md) |
| Files Lambda | `s3.amazonaws.com`, `lambda:InvokeFunction` | `AWS:SourceArn` = bucket dei file, `AWS:SourceAccount` = nostro account | [`lambda-files-allow-s3.json`](iam/resource-policies/lambda-files-allow-s3.json) | [lambda-files.md](lambda-files.md) |
| Bucket del sito | `cloudfront.amazonaws.com`, `s3:GetObject`; Deny a tutti senza TLS | `AWS:SourceArn` = distribuzione del sito; `aws:SecureTransport` | [`s3-website-bucket-policy.json`](iam/resource-policies/s3-website-bucket-policy.json) | [s3.md](s3.md) |
| Bucket dei file | `cloudfront.amazonaws.com`, `s3:GetObject` su `uploads/*`; Deny a tutti senza TLS | `AWS:SourceArn` = distribuzione dei file; `aws:SecureTransport` | [`s3-files-bucket-policy.json`](iam/resource-policies/s3-files-bucket-policy.json) | [s3.md](s3.md) |
| Coda delle notifiche | `sns.amazonaws.com`, `sqs:SendMessage` | `aws:SourceArn` = il nostro topic | [`sqs-notifications-queue-policy.json`](iam/resource-policies/sqs-notifications-queue-policy.json) | [sqs.md](sqs.md) |
| Endpoint SNS (facoltativa) | `sns:Publish` sul nostro topic | `aws:PrincipalAccount` = nostro account | [`vpc-endpoint-sns-policy.json`](iam/resource-policies/vpc-endpoint-sns-policy.json) | [vpc-endpoints.md](vpc-endpoints.md) |

Key policy KMS: nessuna da scrivere, perché usiamo chiavi gestite da AWS. Servirebbe solo con una chiave del cliente,
per ammettere il ruolo del proxy o `sns.amazonaws.com` ([kms.md](kms.md)).

## Cosa non ha bisogno di ruoli

| Collegamento | Perché |
| --- | --- |
| Cognito (solo user pool) e authorizer JWT | Validano i token con le chiavi pubbliche del pool; non agiscono nell'account. I ruoli servirebbero con le *identity pool* o con i trigger Lambda, che non usiamo |
| CloudFront → S3 | CloudFront firma le richieste con OAC; il permesso sta nella bucket policy |
| API Gateway → Lambda | Il permesso sta sulla funzione (resource policy), non in un ruolo di API Gateway |
| SNS → SQS | Il permesso sta nella queue policy |
| SQS → Mailer Lambda | L'event source mapping legge la coda con il ruolo della Mailer stessa |
| SQS → DLQ | Lo spostamento lo fa SQS secondo la `RedrivePolicy` |
| HTTP API → CloudWatch Logs | Basta indicare il log group nello stage; il ruolo CloudWatch a livello account serve solo alle REST API |
| Lambda → CloudWatch Logs | Li invia il servizio Lambda con i permessi `logs:*` del ruolo, senza passare dalla rete della funzione |
| Secrets Manager | Il secret non assume ruoli; lo legge il ruolo del proxy |
| Topic SNS | La policy di default permette di pubblicare alle identità del nostro account; il filtro vero lo fanno le identity policy delle Lambda |
| Aurora | Usa il service-linked role gestito da AWS |

## Autorizzazione degli utenti finali e dei servizi

Sono due livelli diversi, e confonderli è l'errore più comune:

- **Utenti finali** (visitatore, `buyer`, `agent`, `admin`): autenticati da Cognito, autorizzati dall'authorizer JWT
  (token valido) e dalle Lambda (gruppo del token e ownership nel database). Non sono identità IAM.
- **Servizi** (Lambda, proxy, CloudFront, SNS, S3…): autorizzati da IAM con ruoli e resource policy.
- **Dentro il database**: IAM decide chi entra nel proxy e con quale utente PostgreSQL; i `GRANT` SQL decidono cosa
  quell'utente può fare sulle tabelle.

Esempio: per far caricare un file a un utente Cognito non gli si danno permessi IAM. La Presigned Lambda controlla il
JWT e l'ownership, poi firma un presigned POST con i permessi del proprio ruolo.

## Identità di deploy e `iam:PassRole`

I permessi di provisioning (creare ruoli, proxy, cluster, secret, `iam:PassRole`) appartengono all'identità di deploy
(un utente o ruolo del team), non ai ruoli applicativi. La parte delicata è il `PassRole`:

File: [`iam/policies/deploy-pass-role.json`](iam/policies/deploy-pass-role.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PassProjectRolesToLambdaAndRdsOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/real-estate-prod-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": [
            "lambda.amazonaws.com",
            "rds.amazonaws.com"
          ]
        }
      }
    }
  ]
}
```

- `Resource` con `real-estate-prod-*`: si possono consegnare solo i ruoli del progetto.
- `iam:PassedToService` limitato a `lambda.amazonaws.com` e `rds.amazonaws.com`: i ruoli si consegnano solo a Lambda e a
  RDS (il proxy), quindi l'identità di deploy non può "prestare" un ruolo a un altro servizio.

## Verifica prima dell'uso

- Nessun segnaposto `<...>` residuo nei JSON da applicare; account, ARN dei secret e della chiave, ID del proxy e utenti
  PostgreSQL presi dalle risorse effettive; regione `eu-south-1` confermata; nessuna password in Git.
- Ogni Lambda si collega al proxy solo con il proprio utente PostgreSQL.
- Il proxy legge solo i secret associati; le Lambda non possono leggerli.
- I `GRANT` PostgreSQL consentono solo le operazioni previste per ciascun ambito.
- Security group: Lambda → proxy e proxy → Aurora su TCP 5432; nessun accesso diretto Lambda → Aurora.
- Una connessione di prova e il comportamento durante il failover del writer.
- Strumenti utili: IAM Policy Simulator (per simulare `rds-db:connect` o `secretsmanager:GetSecretValue`), IAM Access
  Analyzer, credential report, CloudTrail (si vede la chiamata `AssumeRole` di ogni ruolo).

## Esercizi pratici

Su un account di prova, con AWS Budgets attivo:

1. Creare un ruolo con la sola trust `lambda.amazonaws.com` e `AWSLambdaBasicExecutionRole`, collegarlo a una Lambda e
   guardarne i log.
2. Togliere `s3:PutObject` da una policy, provare a scrivere e leggere l'errore `AccessDenied`.
3. Simulare con IAM Policy Simulator `rds-db:connect` e `secretsmanager:GetSecretValue`.
4. Creare un bucket privato con CloudFront e OAC, e leggere la bucket policy che la console propone.
5. Trovare in CloudTrail la chiamata `AssumeRole` della propria Lambda.

## File JSON

| File | Tipo | Dove è spiegato |
| --- | --- | --- |
| [`iam/trust-relationships/lambda.json`](iam/trust-relationships/lambda.json) | trust | [lambda.md](lambda.md) |
| [`iam/trust-relationships/rds-proxy.json`](iam/trust-relationships/rds-proxy.json) | trust | [rds-proxy.md](rds-proxy.md) |
| [`iam/policies/lambda-property.json`](iam/policies/lambda-property.json) | identity | [lambda-property.md](lambda-property.md) |
| [`iam/policies/lambda-users.json`](iam/policies/lambda-users.json) | identity | [lambda-users.md](lambda-users.md) |
| [`iam/policies/lambda-offers.json`](iam/policies/lambda-offers.json) | identity | [lambda-offers.md](lambda-offers.md) |
| [`iam/policies/lambda-presigned.json`](iam/policies/lambda-presigned.json) | identity | [lambda-presigned.md](lambda-presigned.md) |
| [`iam/policies/lambda-files.json`](iam/policies/lambda-files.json) | identity | [lambda-files.md](lambda-files.md) |
| [`iam/policies/lambda-mailer.json`](iam/policies/lambda-mailer.json) | identity | [lambda-mailer.md](lambda-mailer.md) |
| [`iam/policies/lambda-connect-proxy.json`](iam/policies/lambda-connect-proxy.json) | identity (template generico) | [rds-proxy.md](rds-proxy.md) |
| [`iam/policies/rds-proxy-read-secrets.json`](iam/policies/rds-proxy-read-secrets.json) | identity | [rds-proxy.md](rds-proxy.md) |
| [`iam/policies/rds-proxy-decrypt-secrets.json`](iam/policies/rds-proxy-decrypt-secrets.json) | identity (solo con CMK) | [kms.md](kms.md) |
| [`iam/policies/deploy-pass-role.json`](iam/policies/deploy-pass-role.json) | identity (deploy) | questo file |
| [`iam/resource-policies/lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json) | resource | [api-gateway.md](api-gateway.md) |
| [`iam/resource-policies/lambda-files-allow-s3.json`](iam/resource-policies/lambda-files-allow-s3.json) | resource | [lambda-files.md](lambda-files.md) |
| [`iam/resource-policies/s3-website-bucket-policy.json`](iam/resource-policies/s3-website-bucket-policy.json) | resource | [s3.md](s3.md) |
| [`iam/resource-policies/s3-files-bucket-policy.json`](iam/resource-policies/s3-files-bucket-policy.json) | resource | [s3.md](s3.md) |
| [`iam/resource-policies/sqs-notifications-queue-policy.json`](iam/resource-policies/sqs-notifications-queue-policy.json) | resource | [sqs.md](sqs.md) |
| [`iam/resource-policies/vpc-endpoint-sns-policy.json`](iam/resource-policies/vpc-endpoint-sns-policy.json) | resource (endpoint) | [vpc-endpoints.md](vpc-endpoints.md) |
| [`config/http-api-cors.json`](config/http-api-cors.json) | configurazione | [api-gateway.md](api-gateway.md) |
| [`config/s3-files-cors.json`](config/s3-files-cors.json) | configurazione | [s3.md](s3.md) |
| [`config/s3-files-notification.json`](config/s3-files-notification.json) | configurazione | [s3.md](s3.md) |
| [`config/presigned-post-conditions.json`](config/presigned-post-conditions.json) | configurazione (esempio) | [lambda-presigned.md](lambda-presigned.md) |
| [`config/sns-subscription-attributes.json`](config/sns-subscription-attributes.json) | configurazione | [sns.md](sns.md) |
| [`config/sqs-notifications-queue-attributes.json`](config/sqs-notifications-queue-attributes.json) | configurazione | [sqs.md](sqs.md) |
| [`config/sqs-notifications-dlq-attributes.json`](config/sqs-notifications-dlq-attributes.json) | configurazione | [sqs.md](sqs.md) |

## All'orale

> **Differenza tra trust policy e permissions policy? Fai l'esempio del proxy.**
> La trust dice chi può assumere il ruolo: per `real-estate-prod-rds-proxy-secrets-role` è `rds.amazonaws.com`. La
> permissions policy dice cosa può fare chi lo assume: `secretsmanager:GetSecretValue` sui soli secret applicativi.
> Senza trust il proxy non assume il ruolo; senza permessi lo assume ma non legge niente.
>
> **Differenza tra execution role e resource policy di una Lambda? Chi è il principal?**
> L'execution role è ciò che la funzione può fare (principal: la funzione stessa, tramite il ruolo). La resource policy
> è chi può invocarla (principal: `apigateway.amazonaws.com` o `s3.amazonaws.com`). Come in Spring: il primo è cosa può
> fare il tuo service verso il database, il secondo è chi può chiamare il tuo controller.
>
> **Come si legge IAM, se vieni da Spring Security?**
> Il principal è l'utente autenticato, l'action è l'authority (`hasAuthority`), la resource è l'oggetto protetto. La
> differenza è che qui i principal sono anche servizi, e che le regole possono stare sulla risorsa oltre che sull'identità.
>
> **Perché ruoli e non un utente IAM con access key?**
> Credenziali temporanee che scadono da sole, nessun segreto da custodire nel codice o nell'immagine, rotazione
> automatica. È l'opposto di mettere username e password in `application.properties` o in un `.env` dentro il container.
>
> **Cos'è il confused deputy e come lo evitate?**
> Un servizio AWS usato da un altro account per arrivare alle nostre risorse. Ogni resource policy verso un servizio
> ha `aws:SourceArn` (solo la nostra API, distribuzione, topic, bucket) e dove serve `aws:SourceAccount`.
>
> **Implicit deny ed explicit deny: chi vince?**
> Tutto è negato di default; un Allow lo apre; un Deny esplicito vince su qualunque Allow. Lo usiamo nelle bucket policy
> per rifiutare le richieste senza TLS.
>
> **Cosa fa `iam:PassRole`?**
> Permette di consegnare un ruolo a un servizio. Lo ha solo l'identità di deploy, limitato ai ruoli `real-estate-prod-*`
> e ai servizi Lambda e RDS.
