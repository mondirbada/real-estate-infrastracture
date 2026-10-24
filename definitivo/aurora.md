# Aurora PostgreSQL — cluster `real-estate-prod-aurora`

Aurora PostgreSQL è il database relazionale gestito del progetto: utenti, immobili, offerte e metadati dei file, con le
loro relazioni. Un solo cluster con un'istanza **writer** in AZ-1 e una **reader** in AZ-2, nelle subnet private,
raggiungibile solo dall'RDS Proxy.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Riceve connessioni da | [RDS Proxy](rds-proxy.md) | PostgreSQL 5432, TLS, utente e password letti dal proxy in [Secrets Manager](secrets-manager.md) |
| **Non** riceve connessioni da | le Lambda | passano sempre dal proxy ([vpc.md](vpc.md#security-group)) |
| Cifratura con | [KMS](kms.md) | chiave `aws/rds` |
| Metriche verso | [CloudWatch](cloudwatch.md) | CPU, connessioni |

## Perché Aurora PostgreSQL

Nell'applicazione ci sono relazioni tra diverse entità (utenti, immobili, offerte, file) e un quantitativo di dati
possibilmente elevato: serve un database relazionale. Aurora rispetto a RDS PostgreSQL ha failover più veloce, storage
replicato su più AZ automaticamente e repliche leggere rapide, a un costo più alto. Per un carico piccolo anche RDS
PostgreSQL Multi-AZ andrebbe bene; **Aurora Serverless v2** (disponibile a Milano) pagherebbe solo la capacità usata ed è
l'alternativa più economica per carichi bassi o variabili: invece di istanze a taglia fissa ha una capacità in ACU che
scala da sola, anche verso il basso quando il carico è fermo.

## Concetti

- **Calcolo e storage separati**: lo storage è un volume distribuito su 3 AZ con 6 copie dei dati, che cresce da solo
  (fino a 128 TiB). Le istanze sono solo calcolo.
- **Cluster**: 1 writer + da 0 a 15 reader, che condividono lo stesso storage (lag minimo).
- **Endpoint**: *cluster endpoint* (sempre il writer, anche dopo un failover), *reader endpoint* (bilancia tra i reader),
  *instance endpoint*.
- **Failover**: se il writer cade, una reader viene promossa in genere in decine di secondi e il cluster endpoint si
  aggiorna (DNS); le applicazioni devono sapersi riconnettere.
- **Backup**: automatici e continui (point-in-time recovery, retention da 1 a 35 giorni) più snapshot manuali.
- **Subnet group**: le subnet (in almeno 2 AZ) in cui il cluster può stare. **Parameter group**: il `postgresql.conf`
  gestito.
- **Autenticazione**: password (con Secrets Manager) o IAM database authentication.

## Configurazione

| Voce | Valore |
| --- | --- |
| Cluster | `real-estate-prod-aurora` |
| Writer | AZ-1 `eu-south-1a`, `private_subnet_A` |
| Reader | AZ-2 `eu-south-1b`, `private_subnet_B` (failover) |
| DB subnet group | `private_subnet_A`, `private_subnet_B` |
| Security group | `sg-rds`: 5432 solo da `sg-rds-proxy` |
| Cifratura a riposo | KMS `aws/rds`, da scegliere **alla creazione** del cluster |
| Cifratura in transito | TLS dal proxy |
| Target del proxy | il cluster |

Le due istanze rappresentano **un solo cluster**: il proxy punta al cluster, e utenti applicativi, secret e ruoli IAM
non si duplicano per AZ. Dati e utenti PostgreSQL appartengono al cluster.

**La reader** oggi serve solo per il **failover**: l'endpoint di default del proxy manda tutto al writer. Per distribuire
le letture servirebbe un endpoint di sola lettura del proxy (punto aperto).

### Utenti PostgreSQL

- Un utente per ogni Lambda che usa il database: `property_user`, `users_user`, `offers_user`, `files_user`,
  `presigned_user`, ciascuno con il suo secret letto dal proxy e i suoi `GRANT`.
- I permessi su database, schemi, tabelle e sequenze si definiscono con SQL (`GRANT`), compresi quelli sugli oggetti
  futuri quando servono. **IAM non sostituisce i `GRANT`**: IAM decide chi entra nel proxy e con quale utente, i `GRANT`
  cosa quell'utente può fare sulle tabelle.
- I `GRANT` toccati dalla cancellazione dell'account
  ([lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)), come esempio del principio:

  ```sql
  -- La Users Lambda: il proprio profilo, più lo stato di immobili e offerte per ritirarli.
  GRANT SELECT, INSERT, UPDATE ON users TO users_user;
  GRANT SELECT (id, owner_id, status, title) ON properties TO users_user;
  GRANT UPDATE (status) ON properties TO users_user;
  GRANT SELECT (id, property_id, buyer_id, status, amount) ON offers TO users_user;
  GRANT UPDATE (status) ON offers TO users_user;

  -- Le altre Lambda: solo leggere se l'utente della richiesta è ancora attivo.
  GRANT SELECT (sub, deleted_at) ON users TO property_user, offers_user, presigned_user, files_user;
  ```

  `users_user` può cambiare **solo la colonna `status`** di immobili e offerte, non titolo, prezzo o importo, e non ha
  `DELETE` su nessuna tabella. Le colonne in `SELECT` servono perché in PostgreSQL un `UPDATE` deve poter leggere le
  colonne che usa nel `WHERE` e nel `RETURNING`. Per IAM non cambia nulla: il ruolo della Users Lambda entra sempre nel
  proxy come `users_user`, e sono i `GRANT` a dire che cosa può fare lì dentro.
- L'**utente master** è riservato all'amministrazione: non si usa nelle connessioni applicative e il suo secret non è
  associato al proxy.
- In questa configurazione il proxy usa la **password** dell'utente contenuta nel secret: non serve `rds-db:connect` al
  ruolo del proxy, né il ruolo `rds_iam` agli utenti PostgreSQL. In PostgreSQL `rds_iam` cambia la modalità di
  autenticazione dell'utente: non va aggiunto indiscriminatamente agli utenti applicativi di questo modello.

### Dati personali: niente email nel database

La tabella `users` ha come chiave il `sub` di Cognito e **non ha la colonna email**. Le altre tabelle si riferiscono
all'utente sempre con il `sub` (`owner_id` degli immobili, autore delle offerte).

| Colonna | Da dove arriva | Note |
| --- | --- | --- |
| `sub` (chiave primaria) | claim `sub` dell'access token, in `PUT /users/me` | identificativo opaco e stabile di Cognito: non cambia nemmeno se l'utente cambia email |
| dati di profilo applicativi | body di `PUT /users/me` | solo ciò che serve all'applicazione (per esempio il profilo pubblico dell'agente) |
| `deleted_at` | `DELETE /users/me` | `NULL` finché l'account è attivo; con la cancellazione i dati di profilo diventano `NULL` e resta il solo `sub` |

Immobili e offerte hanno una colonna `status`: `properties.status` vale `active` o `withdrawn`, `offers.status` vale
`pending`, `accepted`, `rejected` o `withdrawn`. Il ritiro serve anche alla cancellazione dell'account, che anonimizza
invece di cancellare ([lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)).

Perché:

- **Minimizzazione dei dati** (GDPR): l'email sta in un posto solo, Cognito. Un dump del database o un'iniezione SQL non
  espongono i recapiti degli utenti.
- **Nessuna copia da riallineare**: se l'utente cambia email su Cognito, la Mailer usa subito quella nuova.
- Quando serve un'email la Mailer la chiede a Cognito con `AdminGetUser`, partendo dal `recipientSub` dell'evento
  ([lambda-mailer.md](lambda-mailer.md#da-dove-arriva-lemail)).
- **Anonimizzare costa poco**: alla cancellazione dell'account basta svuotare le colonne di profilo. Il `sub` che resta,
  dopo `DeleteUser` su Cognito, è uno pseudonimo che non porta più a nessuna persona.

## IAM

Aurora usa il **service-linked role** `AWSServiceRoleForRDS`, con la policy AWS `AmazonRDSServiceRolePolicy` e trust
verso il servizio RDS. È gestito da AWS (permette al servizio di gestire risorse come le interfacce di rete): va solo
verificato che esista o che possa essere creato durante il provisioning. Non se ne crea una copia personalizzata.

- Il ruolo del proxy `real-estate-prod-rds-proxy-secrets-role` va associato **al proxy**, non alle istanze Aurora.
- Il ruolo di servizio **non** dà alle Lambda accesso ai dati.
- Integrazioni aggiuntive, come Enhanced Monitoring o l'accesso di Aurora a S3, richiederebbero una valutazione separata
  dei ruoli necessari.

## Sicurezza e rete

- Subnet private, nessun accesso pubblico, nessun accesso diretto dalle Lambda.
- Cifratura a riposo con KMS e in transito con TLS.

## Costi

È la voce più costosa del progetto: writer e reader sono sempre accese, e il proxy si paga in base alla capacità del
database. Prima di creare risorse reali: AWS Budgets con un allarme a 5-10 € e il Pricing Calculator; a fine prove si
cancellano cluster e proxy, che costano anche a vuoto.

## Punti aperti

- **Uso della reader**: oggi solo failover. Se si vogliono distribuire le letture serve un endpoint di sola lettura del
  proxy ([decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#punti-aperti)).
- Backup e retention: valori da fissare alla creazione.

## Riferimenti

- [Service-linked role Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html)
- [Configurazione degli utenti PostgreSQL per IAM](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)
- [Regioni di Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html)

## All'orale

> **Cosa vuol dire che in Aurora calcolo e storage sono separati?**
> Le istanze fanno solo calcolo; i dati stanno in un volume replicato su 3 AZ con 6 copie. Per questo una reader
> diventa writer in poco tempo: i dati li ha già.
>
> **Cosa succede in un failover?**
> Aurora promuove la reader; il cluster endpoint passa al nuovo writer. Il proxy tiene aperte le connessioni delle
> Lambda e si ricollega, così il failover percepito è più breve.
>
> **La reader riceve letture?**
> No, oggi è la riserva per il failover: l'endpoint di default del proxy va al writer. Per le letture servirebbe un
> endpoint read-only del proxy.
>
> **Perché l'utente master non si usa nell'applicazione?**
> Può tutto. Ogni Lambda ha il suo utente con i soli `GRANT` necessari, come in Spring si userebbe un utente del
> datasource diverso da `postgres`.
>
> **Il service-linked role dà accesso ai dati?**
> No: serve al servizio RDS per gestire le sue risorse. L'accesso ai dati è IAM verso il proxy più i `GRANT`.
>
> **Che dati personali tenete nel database?**
> Il `sub` di Cognito come chiave e i dati di profilo applicativi; niente email. L'email sta solo in Cognito e la legge
> la Mailer quando deve inviare. È come tenere nel database di un'app Spring solo l'ID dell'utente di Keycloak.
>
> **Cosa può fare la Users Lambda su immobili e offerte?**
> Solo cambiare la colonna `status`, per ritirarli quando un utente cancella l'account: `GRANT UPDATE (status)`, non
> `UPDATE` su tutta la tabella e nessun `DELETE`. IAM non è cambiato: dice solo che entra come `users_user`.
>
> **Perché non RDS PostgreSQL o Serverless v2?**
> Si potrebbe: Aurora dà failover più rapido e storage multi-AZ; Serverless v2 costerebbe meno con poco traffico.
