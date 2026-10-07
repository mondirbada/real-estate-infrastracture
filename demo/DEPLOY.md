# Domora — File richiesti per il deploy della demo

Questo è l'inventario dei file da preparare per realizzare il [piano della demo](../domora/demo/README.md). **I percorsi indicati sono proposti: Terraform, script e applicazione non sono ancora implementati.** Il documento è la checklist per il futuro deploy, non una procedura già eseguibile.

La demo si distribuisce dal proprio computer con Terraform e AWS CLI, usando credenziali temporanee. Non richiede GitHub Actions: GitHub serve come sorgente del frontend Next.js SSR collegato ad Amplify. Regione `eu-central-1`, un account, un writer PostgreSQL, un NAT e circa dieci ore complessive di attività.

## 1. Struttura dei file da realizzare

I file comuni vengono riutilizzati dalla [produzione progettata](../prod/DEPLOY.md); cambiano radice Terraform, parametri e orchestrazione. Non servono manifest Kubernetes, Docker Compose nel cloud, CodePipeline o un container per ogni servizio.

| Percorso proposto dalla radice della repository | Contenuto e responsabilità |
| --- | --- |
| `.tool-versions` | Versioni esatte di Terraform, Node.js e strumenti; Terraform con supporto al lock S3 nativo |
| `package.json`, `package-lock.json` | Workspace frontend/backend e comandi ripetibili di installazione, build e verifica |
| `.gitignore` | Esclusione di `.terraform/`, state, plan, `.env`, credenziali, chiavi private e artefatti generati; il lock provider va invece versionato |
| `.env.example` | Nomi delle configurazioni locali e valori fittizi, senza segreti |
| `infra/bootstrap/main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `.terraform.lock.hcl` | Bucket S3 privato/versionato per lo state e bucket artefatti; bootstrap separato dal ciclo di vita della demo |
| `infra/envs/demo/versions.tf`, `.terraform.lock.hcl` | Vincoli Terraform/provider AWS e selezione esatta dei provider |
| `infra/envs/demo/backend.tf`, `backend.hcl.example` | Backend S3 e `use_lockfile = true`; esempio di bucket, chiave e regione, senza credenziali |
| `infra/envs/demo/providers.tf` | Provider AWS in Francoforte, tag e controllo dell'account atteso; alias `us-east-1` per risorse globali che lo richiedono |
| `infra/envs/demo/main.tf` | Collegamenti fra i moduli comuni, con una sola configurazione dell'ambiente |
| `infra/envs/demo/variables.tf`, `outputs.tf` | Parametri validati e output non segreti: endpoint API, hosting, pool Cognito, CloudFront, CodeBuild e ARN dei segreti |
| `infra/envs/demo/demo.tfvars.example` | Configurazione documentata: account, nomi, ACU 0,5–4, un writer/NAT, concorrenze, retention, email e funzionalità opzionali |
| `infra/modules/network/*.tf` | VPC, subnet applicative/dati su due zone, subnet pubblica per NAT zonale, IGW, route, security group e gateway endpoint S3 |
| `infra/modules/database/*.tf` | Aurora PostgreSQL, subnet group, cifratura, parametri, Secrets Manager e RDS Proxy; alternativa esplicita RDS PostgreSQL micro e possibilità di omettere Proxy |
| `infra/modules/identity/*.tf` | Cognito Essentials, client pubblico senza client secret, TOTP, callback/logout e configurazione autorizzazione API |
| `infra/modules/api/*.tf` | REST API, route pubbliche/riservate, authorizer Cognito, scope per access token, CORS, stage, deployment e throttling |
| `infra/modules/compute/*.tf` | Lambda API, dispatcher e due worker: IAM, VPC, memoria, timeout, concorrenze, versioni e alias |
| `infra/modules/media/*.tf` | S3 privato, CORS per upload, prefissi ingresso/varianti, eventi verso SQS, CloudFront/OAC, key group e policy firme/cache |
| `infra/modules/async/*.tf` | Code media/notifiche e DLQ, mapping SQS–Lambda, Scheduler, permessi di consegna e SES opzionale |
| `infra/modules/hosting/*.tf` | Applicazione/branch Amplify collegati a GitHub, build SSR, configurazioni pubbliche e ruolo hosting minimo |
| `infra/modules/operations/*.tf` | Log con retention breve, pochi allarmi, budget e progetto CodeBuild nella VPC per migrazioni/seed |
| `apps/web/amplify.yml` | Build Next.js SSR: installazione dal lock, build e output `.next`; configurazione monorepo coerente con `appRoot` |
| `apps/web/next.config.*`, `apps/web/package.json` | Configurazione Next.js e dipendenze frontend; nessun export statico nella versione scelta |
| `apps/api/package.json`, `apps/api/src/*` | Runtime e handler API; autorizzazioni, SQL, outbox e generazione degli upload/download firmati |
| `apps/workers/package.json`, `apps/workers/src/*` | Handler media, dispatcher e notifiche con elaborazione dei duplicati |
| `db/migrations/*.sql`, `db/migrate.ts` | Schema, indici, vincoli, outbox, registro migrazioni e lock contro esecuzioni concorrenti |
| `db/bootstrap-roles.ts` | Creazione iniziale dei ruoli SQL applicativo/migrazioni con identità amministrativa limitata al bootstrap |
| `db/seeds/demo.ts`, `db/fixtures/demo/*` | Dati sintetici e fotografie; collegamento degli utenti SQL ai `sub` Cognito effettivi |
| `buildspecs/db-demo.yml` | Job CodeBuild per bootstrap SQL, migrazioni e seed, con pacchetto sorgente/migrazioni fissato dal manifest |

Ogni modulo contiene almeno `main.tf`, `variables.tf` e `outputs.tf`; IAM e policy possono stare in `iam.tf` e `policies.tf` dello stesso modulo. Gli ARN, i domini e gli identificativi si passano tramite output: non si copiano a mano tra script.

**Confini:** Terraform gestisce risorse, policy, pacchetti/versioni/alias Lambda. Gli script gestiscono build, valori dei segreti, migrazioni, dati sintetici e avvio/attesa delle build. Non aggiornano gli alias Lambda fuori da Terraform. Connessione iniziale GitHub–Amplify e verifiche email/TOTP possono richiedere una preparazione manuale.

## 2. Script e manifest di esecuzione

| Percorso proposto | Cosa deve fare |
| --- | --- |
| `scripts/preflight.sh` | Verificare strumenti, sessione AWS, account atteso, regione, quote, piano/crediti e scelta Aurora/RDS; fermarsi se i componenti scelti non sono utilizzabili |
| `scripts/bootstrap-state.sh` | Applicare la radice bootstrap con state locale protetto, poi migrare il suo state al bucket appena creato; inizializzare il backend della demo |
| `scripts/build-artifacts.sh` | Installare dal lock, compilare e creare ZIP Lambda e pacchetto migrazioni; dipendenze native del worker media compilate per Linux e architettura Lambda scelta |
| `scripts/make-release-manifest.ts` | Generare un manifest con commit completo, checksum e riferimenti immutabili agli artefatti |
| `scripts/upload-artifacts.sh` | Caricare gli artefatti nel bucket privato sotto il release ID; verificare checksum, senza sovrascrivere altri rilasci |
| `scripts/initialize-secrets.sh` | Generare la coppia CloudFront prima del primo plan, fornendo a Terraform solo la pubblica; dopo la creazione dei segreti caricare la privata e le credenziali SQL in Secrets Manager e rimuovere i file temporanei protetti |
| `scripts/run-db-job.sh` | Avviare CodeBuild per il release ID e attendere l'esito effettivo; non aprire PostgreSQL al computer personale |
| `scripts/prepare-demo-users.ts` | Creare gli account di prova Cognito senza password versionate; raccogliere i `sub` per il seed; lasciare verifica email e TOTP al flusso utente |
| `scripts/upload-demo-fixtures.ts` | Caricare le fotografie sintetiche tramite il percorso autorizzato, attendere l'elaborazione e collegare solo i media pronti agli annunci del seed |
| `scripts/release-backend.sh` | Preparare/applicare plan Terraform per attivare worker, dispatcher e API nell'ordine previsto, dopo le migrazioni |
| `scripts/deploy-frontend.sh` | Impostare configurazioni pubbliche autorizzate, avviare il job Amplify, attendere successo e verificare la revisione effettivamente costruita |
| `scripts/smoke-demo.ts` | Verificare catalogo, login/MFA, pubblicazione/upload, isolamento, preferiti e visita; richiedere token di test senza stamparli |
| `scripts/deploy-demo.sh` | Coordinare i passaggi e registrare gli esiti; interrompere la sequenza al primo errore |
| `scripts/cleanup-demo.sh` | Disattivare Scheduler/consumer, svuotare solo bucket demo autorizzati incluse versioni, preparare un plan destroy e verificare la cancellazione delle risorse |
| `scripts/check-residuals.sh` | Segnalare risorse residue per tag/ID: NAT/IP, DB/proxy, snapshot, bucket, log, hosting e segreti in cancellazione differita |
| `releases/manifest.schema.json` | Schema del manifest, condiviso con il deploy di produzione |
| `releases/<release-id>/manifest.json` | File generato per una prova: commit, ZIP/checksum, migrazioni/checksum, configurazione pubblica, opzioni attive e risultati |

Il manifest non contiene password o token. Gli output runtime, i plan e i log del deploy non vanno aggiunti al repository. Il manifest registra esplicitamente Aurora oppure RDS, Proxy attivo oppure collegamento diretto, email/WAF attivi oppure esclusi.

## 3. Parametri e preparazioni esterne

- **Identità:** account ID atteso, profilo AWS CLI con sessione temporanea, regione e prefissi/tag della demo.
- **GitHub/Amplify:** repository e branch frontend scelti, collegamento autorizzato, autobuild disabilitata per evitare deploy fuori sequenza. Non serve acquistare un dominio: usare hosting e API URL gestiti, configurando callback Cognito e CORS su quelli effettivi.
- **Database:** versione PostgreSQL supportata dall'account, backend Aurora/RDS, range ACU/classe, storage consentito, segreti e ruoli distinti. Aurora gestisce la password master tramite Secrets Manager; i job di bootstrap non usano l'utenza API per creare lo schema.
- **Media:** chiave pubblica CloudFront, ARN della privata, bucket e origini autorizzate. Le chiavi private non entrano in `tfvars`, output o bundle Next.js.
- **Email:** indirizzi mittente/destinatari da verificare nel sandbox SES; nessuna richiesta di accesso produzione necessaria alla demo.
- **Budget:** 25 USD prudenziali e avvisi; verifica manuale del saldo crediti prima del provisioning. Nessun passaggio automatico al Paid plan.

I file `demo.tfvars` e `backend.hcl` effettivi derivano dagli esempi. Le credenziali arrivano dalla sessione AWS, non da questi file. State e plan possono comunque contenere dati sensibili e rimangono protetti.

## 4. Sequenza del primo deploy

1. **Preflight e bootstrap:** confermare servizi disponibili, creare backend/artefatti e inizializzare Terraform. Il bootstrap ha uno state separato e non viene incluso nel destroy ordinario.
2. **Build e manifest:** produrre ZIP e migrazioni, registrarne checksum e caricarli; generare la coppia di firma CloudFront e predisporre la sola pubblica per Terraform. Gli artefatti devono esistere prima delle risorse Lambda che li referenziano.
3. **Preparazione infrastruttura:** plan/apply della demo con scheduler e consumer disabilitati e API ancora non attivate per gli utenti. Creare rete, DB/proxy, code, bucket, segreti, job migrazione, Cognito e hosting. Sul primo deploy gli handler possono essere già presenti ma il servizio rimane chiuso fino allo schema pronto.
4. **Credenziali e SQL:** caricare i valori nei segreti creati, eseguire bootstrap ruoli e migrazioni tramite CodeBuild. Creare utenti Cognito, completare email/TOTP, poi eseguire seed con i loro `sub`. Attendere tutti gli esiti; le foto saranno caricate dopo l'attivazione dei worker.
5. **Attivazione backend:** applicare i plan di attivazione con una configurazione completa, prima worker e poi dispatcher/API. Evitare `terraform -target` come normale meccanismo di rilascio.
6. **Frontend:** usare gli output reali per API, Cognito e CloudFront, completare callback/CORS e avviare la build SSR Amplify. Non usare upload manuale ZIP per Next.js SSR. Verificare commit ed esito del job.
7. **Fixture, prova e presentazione:** caricare le foto tramite API/upload e attendere i media pronti; smoke test più percorso completo nel browser. Verificare DLQ/outbox e fare una prova prima dell'esposizione.
8. **Teardown:** salvare gli esiti utili, esaminare il plan destroy e rimuovere la demo. Gli script richiedono account/ambiente `demo` corrispondenti; non cancellano bucket di state o altri progetti. La pulizia del bootstrap è un'operazione separata dopo aver conservato gli state necessari.

Sul deploy successivo si saltano bootstrap e seed già completati: prima migrazioni compatibili con il codice ancora attivo, poi aggiornamento backend e frontend. Un seed deve essere ripetibile senza duplicare dati e non deve cancellare modifiche della prova senza un reset esplicito.

## 5. Cosa va consegnato per poter partire

Il deploy diventa eseguibile quando esistono: applicazione compilabile, moduli/radice Terraform con lock, migrazioni/fixture, buildspec CodeBuild, configurazione Amplify, manifest e script di build/deploy/verifica/pulizia. Nel primo collaudo si controllano anche quote Lambda: la concorrenza proposta potrebbe non essere assegnabile a un nuovo account senza adeguamenti.

Non basta un `main.tf`: **codice, pacchetti, schema SQL, account autenticabili e configurazione hosting devono essere pronti insieme**. Questa checklist non crea risorse AWS.

Riferimenti: [backend S3 e lock Terraform](https://developer.hashicorp.com/terraform/language/backend/s3), [CodeBuild nella VPC](https://docs.aws.amazon.com/codebuild/latest/userguide/vpc-support.html), [limite dei deploy manuali Amplify SSR](https://docs.aws.amazon.com/amplify/latest/userguide/manual-deploys.html), [job Amplify](https://docs.aws.amazon.com/cli/latest/reference/amplify/start-job.html).
