# Domora — File richiesti per il deploy di produzione

Questo documento elenca gli artefatti necessari a distribuire il [progetto completo](../domora/docs/16-sintesi-e-presentazione.md), seguendo [ambienti e rilascio](../domora/docs/14-ambienti-e-rilascio.md). **La produzione rimane teorica e non verrà creata per la presentazione.** I file elencati sono da progettare/implementare, non sono già presenti o eseguibili.

Si usa **Terraform per l'infrastruttura e GitHub Actions per coordinare il rilascio**. Staging e produzione hanno account, configurazioni e state distinti, ma condividono moduli e codice. La [demo semplificata](../demo/DEPLOY.md) non sostituisce il collaudo del vero staging: non riproduce ridondanza, scanner e garanzie operative della produzione.

## 1. File comuni e configurazioni per ambiente

Si riutilizzano `.tool-versions`, manifest/dipendenze Node, `.gitignore`, codice Next.js/API/worker, moduli Terraform, migrazioni, schema del manifest e script di build elencati nel documento demo. Le integrazioni aggiuntive appartengono agli stessi moduli, senza copiare il codice dell'infrastruttura in due versioni indipendenti.

| Percorso proposto dalla radice della repository | Contenuto e responsabilità |
| --- | --- |
| `infra/bootstrap/{main,variables,outputs,versions}.tf`, `.terraform.lock.hcl` | Bootstrap per ciascun account: backend S3 protetto, bucket artefatti, provider OIDC GitHub se assente e ruoli di pipeline |
| `infra/bootstrap/policies/*.json.tftpl` | Trust OIDC vincolata a repository, audience ed environment GitHub; permessi infrastruttura/rilascio distinti e `PassRole` delimitato |
| `infra/envs/staging/{main,providers,versions,variables,outputs,backend}.tf`, `.terraform.lock.hcl` | Radice del collaudo completo nell'account staging, con controllo account atteso |
| `infra/envs/prod/{main,providers,versions,variables,outputs,backend}.tf`, `.terraform.lock.hcl` | Radice di produzione nell'altro account, Francoforte e alias globali necessari |
| `infra/envs/staging/staging.tfvars.example`, `backend.hcl.example` | Capacità ridotte del vero staging, comunque due istanze/zone e integrazioni complete |
| `infra/envs/prod/prod.tfvars.example`, `backend.hcl.example` | Writer/reader Aurora, ciascuno 2–16 ACU, tier reader 1, concorrenze originali, NAT regionale su due zone, domini, retention e protezioni |
| `infra/modules/network/*.tf` | Percorsi privati su due zone, NAT regionale e gateway S3; alternativa esplicita due NAT zonali se provider/API non supportano la modalità regionale |
| `infra/modules/database/*.tf` | Cluster writer/reader, Proxy, segreti, PITR/backup, parametri e protezioni contro cancellazione accidentale |
| `infra/modules/identity/*.tf`, `api/*.tf`, `compute/*.tf`, `hosting/*.tf` | Cognito/MFA, REST API, Lambda per domini e worker, versioni/alias, Amplify SSR; configurazioni separate per ambiente |
| `infra/modules/media/*.tf` | Bucket ingresso/contenuti privati, versioning, CloudFront/OAC, firme, lifecycle, policy e controlli sugli upload |
| `infra/modules/async/*.tf` | Tre code funzionali e DLQ, dispatcher/outbox, Scheduler, EventBridge per eventi scanner e feedback SES |
| `infra/modules/security/*.tf` | GuardDuty Malware Protection for S3, ruoli scansione, WAF per hosting/API/Cognito e protezioni/audit previsti |
| `infra/modules/operations/*.tf` | CloudWatch/Synthetics/SNS, audit, budget, AWS Backup S3, job migrazioni e risorse per recupero |
| `infra/modules/dns/*.tf` | Domini, Route 53, validazione ACM, certificati regionali e certificato CloudFront in `us-east-1`, record SES/DKIM |
| `apps/web/amplify.yml` | Build SSR Next.js collegata al commit candidato, con configurazione pubblica specifica dell'ambiente |
| `buildspecs/db-prod.yml` | Job migrazioni SQL private e controllate; ruolo SQL dedicato, lock/timeout, nessun seed scolastico |
| `db/migrations/*.sql`, `db/migrate.ts`, `db/bootstrap-roles.ts` | Schema, indici, autorizzazioni SQL, registro/checksum migrazioni, bootstrap ruoli e transizione compatibile |
| `db/backfills/*.ts` | Conversioni dati per batch riprendibili, soltanto quando una migrazione le richiede |
| `releases/manifest.schema.json`, `releases/<release-id>/manifest.json` | Identità del candidato, checksum/oggetti S3/versioni, migrazioni, compatibilità, predecessore e risultati del collaudo |

Un bootstrap ha state proprio; ogni ambiente applicativo ha il proprio state S3, versionato e cifrato, con `use_lockfile = true`. I bucket di state restano separati da dati e artefatti. Non si usa un workspace Terraform come sostituto dell'isolamento degli account.

Terraform è l'unico proprietario ordinario di configurazione, pacchetti/versioni e alias Lambda. La pipeline non esegue `update-function-code` o spostamenti degli alias in parallelo a Terraform. SQL, valori dei segreti e avvio dei job Amplify/CodeBuild restano fuori dallo state applicativo; lo state può comunque contenere informazioni sensibili e va protetto.

## 2. Workflow GitHub Actions richiesti

I workflow si trovano in `.github/workflows/`, anche se la loro specifica è qui in `/prod`. Le Actions esterne vengono fissate a commit verificati; gli script comuni rimangono nel repository, invece di duplicarne la logica in lunghi blocchi YAML.

| File proposto | Trigger e responsabilità |
| --- | --- |
| `.github/workflows/ci.yml` | Pull request: lint, build, controlli applicativi significativi, Terraform fmt/validate e verifica manifest; senza credenziali produzione e senza apply |
| `.github/workflows/release.yml` | Avvio manuale su commit candidato autorizzato: build unica backend, upload immutabile, deploy staging, prove e promozione del candidato in produzione |
| `.github/workflows/deploy-environment.yml` | Workflow riutilizzabile chiamato da release per staging/prod; preflight, plan/apply per fasi, migrazioni, backend, Amplify e verifica finale |
| `.github/workflows/rollback.yml` | Avvio manuale su release precedente compatibile; nuovo plan Terraform e nuova build frontend, con esame dell'ambiente produzione |
| `.github/workflows/drift.yml` | Verifica periodica facoltativa del drift tramite plan; segnala scostamenti, senza correzioni automatiche |
| `.github/CODEOWNERS` | Responsabili di workflow, infrastruttura, policy e migrazioni; efficace insieme alle regole di protezione GitHub |

**Configurazione GitHub esterna ai YAML:** environment staging/produzione, regole di branch/tag, reviewer produzione, protezioni di merge e autorizzazioni della GitHub App collegata ad Amplify. Va verificato che il piano GitHub scelto supporti le protezioni necessarie. Non si fingono configurate soltanto perché citate nel workflow.

L'accesso AWS usa OIDC con `id-token: write` solo nei job che ne hanno bisogno e `contents: read` come base. La trust policy controlla `aud = sts.amazonaws.com` e il `sub` esatto della repository/environment autorizzati. Niente access key permanenti in GitHub Secrets. I ruoli di plan/apply, upload/avvio job e migrazioni hanno responsabilità separate; anche il plan può richiedere accesso a informazioni sensibili.

L'esame del plan viene prima dell'apply: il job di plan produzione usa un'identità dedicata, senza apply; il job di esecuzione è protetto dall'environment produzione e applica **quel plan salvato**, dopo verifica di commit, checksum, manifest e stato atteso. Per fasi successive si prepara/esamina il relativo plan; un plan cambiato dopo l'esame non viene applicato automaticamente. Plan e output dettagliati sono conservati in S3 cifrato con accesso ristretto e retention breve, non in commenti pubblici alle PR.

I workflow release e rollback condividono una concurrency group per l'intera sequenza dell'ambiente, con `cancel-in-progress: false`. Una sola identità di rilascio modifica l'ambiente alla volta. Il lock Terraform protegge ogni apply; non basta a serializzare migrazioni e build frontend. La pipeline rivalida commit e release in coda prima di partire: la concurrency GitHub non va trattata come una coda FIFO garantita.

## 3. Script e manifest del rilascio

| File proposto | Responsabilità |
| --- | --- |
| `scripts/preflight.sh` | Identità/account/regione, quote, disponibilità versioni, parametri e coerenza fra manifest e destinazione |
| `scripts/build-artifacts.sh`, `make-release-manifest.ts`, `upload-artifacts.sh` | ZIP Linux compatibili con Lambda, pacchetto migrazioni, checksum e caricamento immutabile; stessi ZIP promossi fra account |
| `scripts/verify-release.ts` | Controllare schema manifest, commit, checksum, compatibilità con la release attiva ed evidenze staging |
| `scripts/terraform-plan.sh`, `terraform-apply.sh` | Preparare plan completi per ogni fase e applicare il plan verificato, con account e backend attesi; niente routine basata su `-target` |
| `scripts/initialize-secrets.sh` | Bootstrap protetto di credenziali SQL e chiavi di firma; rotazioni successive con procedure dedicate |
| `scripts/run-db-job.sh` | Avviare CodeBuild sul pacchetto immutabile del candidato, attendere stato finale e registrare migrazioni eseguite |
| `scripts/release-backend.sh` | Aggiornare tramite Terraform prima consumer, poi dispatcher/API, rispettando compatibilità e funzioni ancora disabilitate |
| `scripts/deploy-frontend.sh` | Avviare Amplify sul candidato, verificare commit costruito e successo, registrare job ID e URL |
| `scripts/smoke-prod.ts` | Verifiche sintetiche controllate di catalogo, MFA, isolamento, upload/scansione, contatti/visite e notifica |
| `scripts/observe-release.sh` | Osservazione iniziale di almeno 15 minuti: errori, latenze, sonde, outbox e DLQ; interrompere promozione se gli esiti sono insufficienti |
| `scripts/rollback-release.sh` | Ricostruire una configurazione di rilascio precedente compatibile, far esaminare i plan e coordinare backend/frontend |
| `scripts/record-release.ts` | Registrare release attiva, predecessore, job/build, plan/checksum, risultati e limiti; nessun esito positivo se mancano verifiche |
| `config/release-flags.schema.json` | Formato delle funzionalità temporaneamente disabilitate durante espansione/migrazioni e attivate soltanto a dipendenze pronte |
| `ops/runbooks/release-failure.md`, `restore-database.md`, `restore-media.md`, `recover-state.md` | Procedure distinte per deploy fallito, dati corrotti, file persi e recupero dello state |

Il manifest registra almeno: release ID, commit completo, runtime/dipendenze fissati, oggetto S3 e versione/checksum per ciascun pacchetto, migrazioni/checksum, revisione frontend, configurazione pubblica per ambiente, release precedente, intervallo di compatibilità SQL/eventi e prove. I riferimenti ai segreti sono ARN/identificativi, mai valori.

Gli artefatti hanno percorso/versione immutabile. La pipeline promuove i pacchetti backend già collaudati, verificando la copia fra account; non li ricompila in produzione. Amplify costruisce separatamente lo stesso commit con URL e identificativi dell'ambiente: non si promettono bundle frontend identici fra staging e produzione.

## 4. Sequenza del deploy e primo avvio

Il bootstrap iniziale è un'operazione distinta dalla pipeline ordinaria: un amministratore prepara backend e ruoli OIDC in ciascun account, collega Amplify alla repository, configura DNS/certificati, segreti e identità SES. Accesso produzione SES e quote adeguate sono prerequisiti esterni; Terraform non garantisce l'approvazione AWS. La selezione del NAT regionale dipende anche dalla versione provider fissata.

La pipeline segue questa sequenza:

1. **Candidato:** controlli CI, build backend unica, manifest e artefatti immutabili.
2. **Preparazione staging:** plan/apply delle aggiunte infrastrutturali, senza attivare codice incompatibile. Sul primo avvio si creano risorse/handler con traffico e consumer disabilitati fino a schema pronto.
3. **SQL staging:** CodeBuild esegue migrazioni compatibili; eventuali backfill hanno progresso persistente e lock. In staging si usano fixture controllate; in produzione non esiste seed demo.
4. **Backend e frontend staging:** plan/apply di attivazione in ordine consumer → dispatcher/API → frontend Amplify; abilitazione funzioni solo dopo dipendenze pronte.
5. **Evidenze staging:** smoke test e osservazione; test specifici di carico/failover/restore quando la modifica li richiede. Una demo funzionale non dimostra gli SLO della produzione.
6. **Esame produzione:** verificare lo stesso candidato e i plan produzione effettivi, con le protezioni GitHub previste.
7. **Produzione:** ripetere preparazione, migrazioni, attivazione backend e frontend con gli artefatti promossi e account corretto. Per ogni fase si registra il plan e l'esito; non si mescolano cancellazioni incompatibili con le aggiunte necessarie al rilascio.
8. **Chiusura:** smoke test, osservazione e registrazione della release attiva. Rimozione di vecchie colonne/formati in un rilascio successivo, dopo verifica di compatibilità, code, DLQ e outbox.

Ogni fase Terraform usa l'intera configurazione con riferimenti di rilascio espliciti: durante la preparazione rimangono attive le versioni precedenti, durante l'attivazione cambiano i riferimenti delle funzioni previste. Non si usa un unico apply che aggiorni tutte le Lambda prima delle migrazioni, né si promette un cambio atomico dell'intero sistema.

Amplify SSR resta collegato a GitHub, con autobuild indipendente disabilitata. Il processo di rilascio deve controllare quale revisione il job costruisce effettivamente: passare un `commitId` non viene assunto sufficiente senza collaudare la modalità del job. Usare un branch di rilascio controllato, mantenerlo sul candidato durante la build e verificare il commit restituito; se non corrisponde, fermare il rilascio. Il rollback frontend ripete lo stesso meccanismo sulla revisione precedente.

## 5. Esito negativo e ritorno precedente

Se migrazione o verifica staging fallisce, non si promuove il candidato. Se l'applicazione di produzione fallisce con schema compatibile, si ripristinano gli artefatti precedenti **tramite Terraform** e si ricostruisce il frontend della revisione compatibile. Gli script registrano anche esiti parziali.

Il rollback non esegue automaticamente migrazioni SQL inverse, non ritira email e non annulla scritture degli utenti. Se lo schema non è più compatibile, si corregge in avanti o si attiva una procedura d'incidente. Il restore dei dati segue il runbook dedicato; non è il normale rollback di un deploy.

**Non è previsto un workflow `destroy` di produzione.** Database e risorse persistenti hanno protezioni appropriate e retention; eventuali dismissioni richiedono una procedura distinta. Conservare almeno gli ultimi cinque rilasci e trenta giorni di artefatti come base del progetto, adeguando la retention alle evidenze degli incidenti.

## 6. Cosa serve per descrivere il deploy nella presentazione

I file chiave da spiegare sono: **radice Terraform per ambiente, moduli condivisi, lock/backend, manifest del candidato, workflow GitHub Actions con OIDC, buildspec delle migrazioni e `amplify.yml`**. Gli script collegano questi elementi e controllano gli esiti.

La differenza con la demo è soprattutto nell'orchestrazione e nelle garanzie: deploy manuale e teardown nella demo; candidato collaudato, account separati, esame dei plan, promozione e recupero controllato nel progetto di produzione. Questa specifica documenta il percorso senza attivarlo.

Riferimenti: [backend S3 Terraform](https://developer.hashicorp.com/terraform/language/backend/s3), [GitHub Actions OIDC verso AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [CodeBuild nella VPC](https://docs.aws.amazon.com/codebuild/latest/userguide/vpc-support.html), [limite upload manuali SSR](https://docs.aws.amazon.com/amplify/latest/userguide/manual-deploys.html), [avvio job Amplify](https://docs.aws.amazon.com/cli/latest/reference/amplify/start-job.html).
