# RDS Proxy — `real-estate-prod-db-proxy`

L'RDS Proxy è un *connection pooler* gestito tra le Lambda e Aurora: tiene poche connessioni stabili verso il database e
ci smista le molte connessioni brevi delle Lambda. Le Lambda vi entrano con un **token IAM** su TLS; il proxy entra in
Aurora con la **password** dell'utente PostgreSQL, letta da Secrets Manager con il proprio ruolo.

```text
Lambda -- IAM + TLS --> RDS Proxy -- password + TLS --> Aurora PostgreSQL
                           |
                           +-- GetSecretValue --> Secrets Manager
```

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Lambda → proxy | [Property](lambda-property.md), [Users](lambda-users.md), [Offers](lambda-offers.md), [Presigned](lambda-presigned.md), [Files](lambda-files.md) | PostgreSQL 5432, TLS, token IAM come password | `rds-db:connect` nell'execution role; `sg-rds-proxy` accetta da `sg-lambda-internal` |
| Proxy → Secrets Manager | [secrets-manager.md](secrets-manager.md) | `GetSecretValue` (eventualmente tramite l'[endpoint](vpc-endpoints.md)) | ruolo del proxy |
| Proxy → Aurora | [aurora.md](aurora.md) | PostgreSQL 5432, TLS, password dal secret | `sg-rds` accetta da `sg-rds-proxy`; utente PostgreSQL |

## Perché c'è

Ogni istanza di una Lambda apre la propria connessione: con molte invocazioni concorrenti si esaurisce
`max_connections` e il database va sotto stress. Il proxy assorbe le connessioni effimere e ne mantiene poche verso
Aurora (*multiplexing*). In più ci dà l'autenticazione IAM (nessuna password nelle Lambda) e un failover percepito più
breve, perché tiene aperte le connessioni dei client mentre si ricollega al nuovo writer.

Non è strettamente necessario: il traffico del progetto non sarà così elevato da dover gestire una moltitudine di
connessioni, ma per sicurezza abbiamo deciso di implementarlo (vedi [decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md)
per come motivarlo). Senza proxy, con poche Lambda e connessioni riusate fuori dall'handler, si potrebbe anche fare.

## Concetti

- **Target group**: il cluster Aurora collegato.
- **Autenticazione client → proxy**: password oppure IAM ("Require IAM authentication"). Noi: **IAM**.
- **Autenticazione proxy → database**: credenziali in Secrets Manager, lette con il ruolo del proxy.
- **Require TLS**: connessioni cifrate obbligatorie.
- **Connection pinning**: alcune operazioni (come `SET` o certi prepared statement) legano una connessione a un client
  e riducono il multiplexing.
- **Dimensione del pool**: percentuale di `max_connections` che il proxy può usare.
- Vive **solo nella VPC**: nessun endpoint pubblico; richiede subnet in almeno 2 AZ, almeno 10 IP liberi per subnet e
  un security group.

## Configurazione

| Voce | Valore |
| --- | --- |
| Nome | `real-estate-prod-db-proxy` |
| Subnet | `private_subnet_A`, `private_subnet_B` (multi-AZ) |
| Security group | `sg-rds-proxy` |
| Target | cluster `real-estate-prod-aurora` (l'endpoint di default va al writer) |
| Autenticazione dei client | IAM richiesto, TLS richiesto ("Require TLS") |
| Autenticazione verso Aurora | secret, uno per utente PostgreSQL |
| Ruolo | `real-estate-prod-rds-proxy-secrets-role` |

**Modalità scelta:** autenticazione del proxy basata su secret, con IAM richiesto ai client. **Non** si sceglie
`DefaultAuthScheme=IAM_AUTH`, che è la diversa modalità IAM end-to-end (alternativa citata in
[decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md)).

### Autenticazione IAM di una Lambda, passo per passo

1. L'execution role della Lambda ha `rds-db:connect` su `dbuser:<prx-ID>/<utente>`.
2. Il codice genera un **token di autenticazione** con l'SDK (`generate-db-auth-token`), firmato SigV4 con le
   credenziali del ruolo, indicando host del proxy, porta e utente. È un calcolo locale, senza chiamate di rete, e il
   token vale **15 minuti**; una connessione già aperta non si chiude a quella scadenza.
3. Usa il token **come password** della connessione PostgreSQL, su TLS (`sslmode=require` o `verify-full` con il bundle
   CA di RDS).
4. Il proxy verifica il token con IAM, poi usa le credenziali del secret per parlare con Aurora.

Ci sono quindi **due livelli di identità** (IAM per entrare nel proxy, l'utente PostgreSQL per entrare nel database) e
**due ruoli** (quello della Lambda e quello del proxy):

```text
Lambda    --(1: assume l'execution role, trust lambda.amazonaws.com)--> credenziali temporanee
Lambda    --(2: token IAM firmato SigV4, rds-db:connect)--> RDS Proxy
RDS Proxy --(3: assume real-estate-prod-rds-proxy-secrets-role, trust rds.amazonaws.com)--> credenziali temporanee
RDS Proxy --(4: GetSecretValue)--> Secrets Manager -> username/password
RDS Proxy --(5: password PostgreSQL)--> Aurora
```

## IAM

### Ruolo del proxy: `real-estate-prod-rds-proxy-secrets-role`

Trust: il servizio `rds.amazonaws.com` assume il ruolo con `sts:AssumeRole`.

File: [`iam/trust-relationships/rds-proxy.json`](iam/trust-relationships/rds-proxy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRdsToAssumeRole",
      "Effect": "Allow",
      "Principal": { "Service": "rds.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Permessi: recuperare il valore dei soli secret applicativi.

File: [`iam/policies/rds-proxy-read-secrets.json`](iam/policies/rds-proxy-read-secrets.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApplicationDatabaseSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": ["<APPLICATION_SECRET_ARN>"]
    }
  ]
}
```

- Per più utenti si elencano in `Resource` gli ARN di tutti i secret (i 5 secret `real-estate/prod/database/<utente>`) e
  si associano gli stessi secret alla configurazione del proxy. Si usano gli ARN **completi**, con il suffisso casuale
  generato da Secrets Manager (`-AbCdEf`).
- Non include il secret dell'utente master.
- Il ruolo non riceve permessi di modifica o cancellazione dei secret, di gestione del cluster o di amministrazione IAM.
- Il ruolo del proxy **non** ha `rds-db:connect`: verso Aurora usa la password.

Solo con una chiave KMS del cliente per i secret si aggiunge anche questa policy (spiegata in [kms.md](kms.md)):
`kms:Decrypt` sulla sola chiave e solo tramite Secrets Manager nella nostra regione.

File: [`iam/policies/rds-proxy-decrypt-secrets.json`](iam/policies/rds-proxy-decrypt-secrets.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DecryptSecretsWithCustomerManagedKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "<SECRETS_KMS_KEY_ARN>",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.eu-south-1.amazonaws.com"
        }
      }
    }
  ]
}
```

### Accesso delle Lambda al proxy

Ogni Lambda che usa il database mantiene il proprio execution role (trust
[`lambda.json`](iam/trust-relationships/lambda.json)) con un permesso `rds-db:connect`. Template generico:

File: [`iam/policies/lambda-connect-proxy.json`](iam/policies/lambda-connect-proxy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsApplicationUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/<DB_USER>"
    }
  ]
}
```

- Concede `rds-db:connect` per **una sola coppia** proxy/utente PostgreSQL.
- `<PROXY_RESOURCE_ID>` è l'ID risorsa `prx-...`, non il nome o l'ARN ordinario del proxy e non l'ID del cluster.
- `<DB_USER>` cambia per ogni execution role: le policy reali sono già scritte per ciascuna Lambda
  ([lambda.md](lambda.md#execution-role)). Il permesso si dà solo alle funzioni che usano davvero il database (non alla
  Mailer).
- Si aggiunge ai permessi di log e VPC della funzione, non li sostituisce.
- Le Lambda **non** assumono il ruolo del proxy e **non** ricevono `secretsmanager:GetSecretValue`.

## Sicurezza e rete

| Security group `sg-rds-proxy` | Regola |
| --- | --- |
| In entrata | 5432 da `sg-lambda-internal` |
| In uscita | 5432 → `sg-rds`; 443 → `sg-endpoint-secrets-manager` |

TLS obbligatorio dai client e verso Aurora. Il percorso applicativo non prevede accesso diretto Lambda → Aurora.

## Costi

Si paga in base alla capacità (vCPU/ACU) del database a cui è collegato, anche a vuoto: insieme ad Aurora è la parte più
costosa.

## Punti aperti

- Se il proxy ha bisogno dell'endpoint di Secrets Manager si scopre solo creandolo ([vpc-endpoints.md](vpc-endpoints.md#punti-aperti)).
- Per mandare letture alla reader servirebbe un endpoint di sola lettura del proxy ([aurora.md](aurora.md#punti-aperti)).
- Da verificare in prova: una connessione e il comportamento durante il failover del writer.

## Riferimenti

- [Ruolo, trust e accesso ai secret del proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-iam-setup.html)
- [Connessione al proxy e ARN IAM](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-connecting.html)
- [Prerequisiti di rete del proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-network-prereqs.html)
- [Troubleshooting del proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.troubleshooting.html)
- [Regioni di RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.RDS_Proxy.html)

## All'orale

> **Perché serve il proxy con le Lambda?**
> Ogni istanza apre una connessione; con molte invocazioni si esaurisce `max_connections`. Il proxy fa pooling, come
> HikariCP in Spring Boot, ma condiviso tra tutte le istanze e gestito da AWS (più simile a un PgBouncer).
>
> **Differenza tra autenticazione client → proxy e proxy → database?**
> Le Lambda entrano con un token IAM di 15 minuti; il proxy entra in Aurora con la password del secret, che legge con il
> suo ruolo. Le Lambda non vedono mai la password.
>
> **A cosa serve il ruolo del proxy e perché la trust è verso `rds.amazonaws.com`?**
> Per leggere i secret: è il servizio RDS che lo assume. Senza la trust il proxy non potrebbe assumerlo e non
> leggerebbe le credenziali.
>
> **Cosa metti nella risorsa di `rds-db:connect`?**
> `dbuser:<prx-ID>/<utente>`, con l'ID risorsa del proxy (`prx-...`), non il nome: è il punto che tutti sbagliano.
>
> **Una Lambda non riesce a collegarsi: cosa controlli?**
> Il `rds-db:connect` con ID del proxy e utente giusti, i security group (5432 verso `sg-rds-proxy`), TLS attivo, il
> secret associato al proxy e leggibile dal suo ruolo, il `GRANT` dell'utente.
>
> **È davvero necessario?**
> Con poco traffico no, e lo diciamo. Lo teniamo per robustezza: pooling, autenticazione IAM e failover più rapido.
