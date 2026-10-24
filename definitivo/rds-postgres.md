# RDS for PostgreSQL — istanza `real-estate-prod-db`

Amazon RDS for PostgreSQL è il database relazionale gestito del progetto: utenti, immobili, offerte e metadati dei
file, con le loro relazioni. Una sola istanza in deployment **Multi-AZ DB instance**: una **primaria** attiva in AZ-1 e
una **standby** a riposo in AZ-2, nelle subnet private, raggiungibile solo dall'RDS Proxy.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Riceve connessioni da | [RDS Proxy](rds-proxy.md) | PostgreSQL 5432, TLS, utente e password letti dal proxy in [Secrets Manager](secrets-manager.md) |
| **Non** riceve connessioni da | le Lambda | passano sempre dal proxy ([vpc.md](vpc.md#security-group)) |
| Cifratura con | [KMS](kms.md) | chiave `aws/rds` |
| Metriche ed eventi verso | [CloudWatch](cloudwatch.md) | CPU, connessioni, spazio libero; eventi RDS di failover |

## Perché RDS for PostgreSQL Multi-AZ

Nell'applicazione ci sono relazioni tra diverse entità (utenti, immobili, offerte, file) e un quantitativo di dati
possibilmente elevato: serve un database relazionale, e PostgreSQL è quello che il team conosce.

La versione precedente del progetto usava un cluster **Aurora PostgreSQL** con una writer e una reader. Su
**indicazione del docente, per costo e semplicità**, è stato sostituito da RDS for PostgreSQL Multi-AZ:

- la reader di Aurora **serviva solo al failover**: l'endpoint di default del proxy mandava tutto alla writer, e le
  letture distribuite non ci servono;
- il Multi-AZ di RDS dà la stessa **alta disponibilità** (una copia sincrona in un'altra AZ, failover automatico,
  stesso endpoint) con un servizio più semplice da spiegare e da gestire, e a un costo più basso.

Alternative valutate e scartate:

| Alternativa | Perché no |
| --- | --- |
| Aurora PostgreSQL, writer + reader (la scelta precedente) | Più costosa; la reader non serviva alle letture, solo al failover |
| RDS **Multi-AZ DB cluster** (una writer e due standby leggibili, in tre AZ) | Più costoso (tre istanze); le standby leggibili servono solo se si devono distribuire le letture, e a noi non serve |
| RDS **Single-AZ** | Un'istanza sola: se cade l'istanza o la sua AZ il database è fermo fino al ripristino. Niente alta disponibilità |

## Concetti

- **Primaria e standby**: l'applicazione parla solo con la primaria. RDS mantiene una **standby** in un'altra AZ e le
  replica i dati in modo **sincrono**: una scrittura è confermata quando è su entrambe. Per questo dopo un failover non
  si perdono transazioni confermate. Il prezzo è un po' più di latenza in scrittura rispetto al Single-AZ.
- **La standby non serve letture**: è una riserva a riposo, non si può interrogare. Per le letture servirebbero una
  read replica o un Multi-AZ DB cluster.
- **Endpoint**: uno solo, un nome DNS dell'istanza. Dopo un failover il nome resta lo stesso e RDS lo fa puntare alla
  nuova primaria.
- **Failover**: automatico se la primaria o la sua AZ hanno un problema (host non sano, rete, storage), durante alcune
  manutenzioni del sistema operativo, o a mano con *Reboot with failover*. La standby diventa primaria e RDS ricrea una
  nuova standby. Tempi tipici: **60-120 secondi**, di più con transazioni grandi o un recovery lungo.
- **Failover con RDS Proxy**: il proxy continua ad accettare connessioni sullo **stesso indirizzo** e le dirige da sé
  alla nuova primaria, senza aspettare la propagazione del DNS né le cache DNS dei client. Le connessioni inattive delle
  Lambda restano aperte; si interrompono solo quelle a metà di una transazione o di uno statement, e mentre la primaria
  non c'è il proxy mette in coda le nuove richieste.
- **Backup automatici**: uno snapshot giornaliero nella *backup window* più i log delle transazioni caricati su S3 ogni
  5 minuti; permettono il **point-in-time recovery** in un'istanza nuova, a qualsiasi momento della retention (da 0 a 35
  giorni; 0 disattiva i backup). Più gli snapshot manuali, che restano finché non si cancellano.
- **Finestra di manutenzione**: 30 minuti a settimana in cui RDS applica patch e modifiche rimandate. Con il Multi-AZ
  le patch del sistema operativo si fanno prima sulla standby, poi c'è un failover breve (in genere meno di un minuto) e
  si aggiorna la vecchia primaria. Un aggiornamento di versione del motore invece ferma entrambe le istanze insieme.
- **DB subnet group**: le subnet (in almeno 2 AZ) in cui possono stare primaria e standby. **Parameter group**: il
  `postgresql.conf` gestito.
- **Autenticazione**: password (con Secrets Manager) o IAM database authentication.

## Configurazione

Scelte del progetto, da confermare alla creazione (per esempio che la classe sia ordinabile a Milano con
`aws rds describe-orderable-db-instance-options --engine postgres --region eu-south-1`):

| Voce | Valore |
| --- | --- |
| Identificativo | `real-estate-prod-db` |
| Motore | RDS for PostgreSQL **17** (ultima minor disponibile alla creazione), *auto minor version upgrade* attivo |
| Deployment | **Multi-AZ DB instance** (una standby) |
| Primaria | AZ-1 `eu-south-1a`, `private_subnet_A` |
| Standby | AZ-2 `eu-south-1b`, `private_subnet_B` (solo failover, non leggibile) |
| Classe d'istanza | `db.t4g.micro` (2 vCPU burstable, 1 GiB): basta al carico di un progetto d'esame; si sale a `db.t4g.small` se CPU o memoria non bastano |
| Storage | **gp3**, 20 GiB (il minimo), baseline 3000 IOPS e 125 MiB/s; *storage autoscaling* fino a 100 GiB |
| DB subnet group | `private_subnet_A`, `private_subnet_B` |
| Security group | `sg-rds`: 5432 solo da `sg-rds-proxy` |
| Accesso pubblico | No |
| Cifratura a riposo | KMS `aws/rds`, da scegliere **alla creazione** dell'istanza |
| Cifratura in transito | TLS dal proxy |
| Backup automatici | retention **7 giorni**, backup window `01:00-01:30` UTC |
| Finestra di manutenzione | domenica `02:00-02:30` UTC (non si sovrappone alla backup window) |
| Deletion protection | attiva; si toglie prima di cancellare l'istanza a fine prove |
| Target del proxy | l'istanza `real-estate-prod-db` |

Primaria e standby sono **una sola istanza** per RDS: un identificativo, un endpoint, un target del proxy. Utenti
applicativi, secret e ruoli IAM non si duplicano per AZ; dati e utenti PostgreSQL stanno nell'istanza e la standby ne è
la copia sincrona.

Perché questi valori:

- **PostgreSQL 17**: versione recente e matura, supportata da RDS Proxy a Milano (che arriva fino alla 18).
- **`db.t4g.micro`**: la più piccola, con traffico da demo; il Multi-AZ la raddoppia comunque (si pagano due istanze).
- **gp3 da 20 GiB**: i dati sono testo, le foto e i video stanno su S3; con gp3 IOPS e throughput di base non dipendono
  dalla dimensione, come invece succede con gp2.
- **7 giorni di backup**: il default della console, abbastanza per tornare indietro dopo un errore durante le prove;
  è anche il tempo per cui un profilo cancellato resta nei backup ([lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)).

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
- Il database di default `postgres` deve restare: RDS Proxy ne ha bisogno anche se l'applicazione usa un altro database.
  Il proxy crea anche l'utente `rdsproxyadmin` quando si registra il target: non va toccato.

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

RDS usa il **service-linked role** `AWSServiceRoleForRDS`, con la policy AWS `AmazonRDSServiceRolePolicy` e trust
verso `rds.amazonaws.com`. È gestito da AWS (permette al servizio di gestire risorse come le interfacce di rete) e RDS
lo crea da sé alla creazione della prima istanza: va solo verificato che l'identità di deploy possa crearlo
(`iam:CreateServiceLinkedRole`). Non se ne crea una copia personalizzata.

- Il ruolo del proxy `real-estate-prod-rds-proxy-secrets-role` va associato **al proxy**, non all'istanza.
- Il ruolo di servizio **non** dà alle Lambda accesso ai dati.
- Integrazioni aggiuntive, come Enhanced Monitoring o l'accesso di RDS a S3, richiederebbero una valutazione separata
  dei ruoli necessari.

## Sicurezza e rete

- Subnet private, nessun accesso pubblico, nessun accesso diretto dalle Lambda.
- Primaria e standby nello stesso `sg-rds` e nello stesso subnet group: dopo un failover le regole valgono uguali.
- Cifratura a riposo con KMS (storage, log, backup e snapshot; la standby è cifrata come la primaria) e in transito
  con TLS. La cifratura si sceglie solo alla creazione e la chiave non si cambia dopo.

## Costi

È la voce più costosa del progetto: con il Multi-AZ si pagano **due istanze** sempre accese (primaria e standby) e lo
storage di entrambe, e il proxy si paga in base alle vCPU dell'istanza. Resta comunque meno di Aurora con writer e
reader, e molto meno di un Multi-AZ DB cluster con tre istanze. Prima di creare risorse reali: AWS Budgets con un
allarme a 5-10 € e il Pricing Calculator; a fine prove si cancellano istanza e proxy, che costano anche a vuoto.

## Punti aperti

- Classe d'istanza: `db.t4g.micro` va confermata come ordinabile in `eu-south-1` per PostgreSQL 17 in Multi-AZ; se
  non lo fosse, `db.t3.micro`.
- Da verificare in prova: un failover forzato (*Reboot with failover*) con le Lambda collegate al proxy, per misurare
  quanto dura davvero.

## Riferimenti

- [Multi-AZ DB instance: standby sincrona, non leggibile](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
- [Multi-AZ DB instance e Multi-AZ DB cluster a confronto](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)
- [Failover di una Multi-AZ DB instance (60-120 s, cause, DNS)](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html)
- [RDS Proxy durante il failover](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.howitworks.html#rds-proxy-failover)
- [Limiti di RDS Proxy con RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html#rds-proxy.limitations-pg)
- [Regioni e versioni di RDS Proxy con RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.RDSProxy.html)
- [Retention dei backup](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)
- [Point-in-time recovery](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
- [Manutenzione e Multi-AZ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html)
- [Storage gp3](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html#gp3-storage)
- [Cifratura delle istanze RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
- [Service-linked role di RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html)
- [Configurazione degli utenti PostgreSQL per IAM](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)

## All'orale

> **Perché RDS PostgreSQL e non più Aurora?**
> Su indicazione del docente, per costo e semplicità. La reader di Aurora ci serviva solo per il failover; il Multi-AZ
> di RDS dà la stessa alta disponibilità, una primaria attiva e una standby a riposo in un'altra AZ, con un servizio più
> semplice e meno costoso.
>
> **Cosa vuol dire che la replica è sincrona?**
> Una scrittura è confermata solo quando è sia sulla primaria sia sulla standby. Se la primaria cade, la standby ha già
> tutto ciò che era stato confermato: non si perdono transazioni.
>
> **Cosa succede in un failover?**
> RDS promuove la standby, in genere in 60-120 secondi, e sposta il nome DNS dell'istanza sulla nuova primaria; poi
> ricrea una standby. Il proxy non aspetta il DNS: tiene aperte le connessioni delle Lambda e le porta lui sulla nuova
> primaria; cadono solo le transazioni in corso.
>
> **La standby riceve letture?**
> No, non si può interrogare: è solo la riserva. Se servissero letture distribuite ci vorrebbero una read replica o un
> Multi-AZ DB cluster, che ha due standby leggibili ma costa di più.
>
> **E i backup?**
> Automatici, 7 giorni di retention: uno snapshot al giorno più i log delle transazioni ogni 5 minuti, così si può
> ripristinare un momento qualsiasi in un'istanza nuova.
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
