# Domora — Dimensionamento e costi

Questa parte traduce [carico e qualità](07-carico-e-requisiti-qualita.md) in capacità iniziali e costo dello stack progettato. Include [ambienti e rilascio](14-ambienti-e-rilascio.md) e [osservabilità](13-osservabilita-e-piano-operativo.md).

**Stato:** ipotesi tecniche e stima economica, non benchmark, preventivo contrattuale o risorse configurate. Tariffe pubbliche AWS consultate il **7 ottobre 2026** per Francoforte, salvo CloudFront europeo e sonda pubblica in Irlanda. Importi in **USD, prima di imposte**, senza conversione in euro, crediti, sconti o impegni pluriennali.

## 1. Base del conto

Si usa un mese commerciale di trenta giorni per i volumi e **730 ore** per i servizi mantenuti accesi: è una convenzione prudente per confrontare le voci, non il numero di ore di ogni mese. La fattura effettiva usa consumi e durata reali.

| Grandezza | Consumo mensile di riferimento | Origine |
| --- | --- | --- |
| API applicative | 6 milioni | 200.000/giorno, comprese le letture chiamate dal frontend SSR |
| Rendering SSR | 1,8 milioni | 60.000/giorno; esecuzioni aggiuntive di hosting, non nuove API duplicate |
| Immagini ai visitatori | 18 milioni di richieste, circa 2,7 TB decimali | 20.000 sessioni/giorno × trenta immagini da 150 KB |
| Upload | 9.000 immagini e 3.000 documenti; 33 GB di originali | 300 immagini e 100 PDF/giorno |
| Varianti nuove | 4,5 GB | 0,15 GB/giorno |
| Avvisi email | 120.000 — nuova ipotesi | 90.000 avvisi per messaggi, inclusi gli iniziali, e 30.000 per altri eventi; nessun doppio conteggio automatico dei nuovi contatti |
| Utenti Cognito attivi mensili | 25.000 — nuova ipotesi | Account distinti attivi nel mese; non tutti i 100.000 registrati |
| Latenza media Lambda API | 300 ms con 1 GB — ipotesi di calcolo | La media serve al costo e alla concorrenza; non dimostra il percentile 95 |
| SSR per richiesta | 0,5 GB per 300 ms — ipotesi di calcolo | Valore effettivo misurato sul runtime ospitato |
| Traffico frontend, senza media | 120 GB — nuova ipotesi | HTML, JavaScript, CSS e altri asset |

Per fatturare storage e trasferimento il listino usa le proprie unità. Nel conto si arrotondano prudenzialmente **2,1 TB decimali a 2.100 GB fatturabili** e **2,7 TB a 2.700 GB**: non sono conversioni esatte in GiB. Questa maggiorazione evita una falsa precisione; l'implementazione userà byte misurati e unità del servizio.

Il mese ordinario non include campagne. Un picco straordinario aggiunge 180.000 API e, con la stessa distribuzione SSR, 54.000 rendering per evento. Non si inventa una frequenza mensile; l'effetto è calcolato separatamente.

## 2. Capacità iniziali da provare

| Componente | Produzione: punto di partenza | Motivo e limite |
| --- | --- | --- |
| Aurora PostgreSQL Serverless v2 Standard | Writer e reader, ciascuno con range 2–16 ACU, nessuna pausa automatica | Mantiene capacità minima e margine di crescita; non prova le novanta ricerche/s |
| Reader di riserva | Promotion tier 1, altra zona | Preparazione al subentro; cresce almeno al livello del writer e ha un costo proprio |
| Database | 30 GB consumati nel conto, crescita monitorata | Dati e indici separati dai file; nessun limite fisso di trenta GB imposto al servizio |
| RDS Proxy | Endpoint writer, connessioni corte e pool client massimo uno per esecuzione | Riduce accumulo di sessioni; pinning e transazioni lunghe limitano il riuso |
| Lambda API | 1 GB; timeout iniziale dieci secondi | Memoria e durata da misurare per area; timeout distinto dal target di latenza |
| Worker media | 2 GB, massimo quattro esecuzioni contemporanee; timeout 120 s | Decodifica fino a quaranta megapixel e varianti; verifica memoria sui file limite |
| Worker notifiche | 512 MB, massimo due esecuzioni; timeout 30 s | Carico modesto, controllato dalla quota SES |
| Worker operazioni di servizio | 512 MB, massimo quattro esecuzioni; timeout 60 s | Priorità agli annullamenti e lavoro a gruppi riprendibili |
| Dispatcher | 512 MB, una esecuzione concorrente; timeout 30 s | Evitare sovrapposizioni; consegna confermata e recuperabile |

Una ACU corrisponde a circa 2 GiB di memoria, con CPU e rete associate: **non è un numero fisso di query al secondo**. Il range di produzione equivale indicativamente a 4–32 GiB per istanza. Con promotion tier 1 non si conta il reader come una riserva economica sempre ferma al minimo mentre il writer cresce. [Capacità e scaling Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html).

Il conto centrale assume **3 ACU medie per istanza**, sei complessive: è un profilo di consumo ipotetico fra minimo e massimo, non un risultato dedotto dagli account registrati. Se entrambe restassero a due ACU, il compute sarebbe inferiore; se restassero a sedici, molto superiore.

Staging parte da **0,5–4 ACU per istanza**, sempre due istanze e due zone, senza auto-pausa durante il collaudo. Per prove rappresentative si adegua al range e ai volumi della produzione. La permanenza al minimo è soltanto l'ipotesi della sua stima economica.

### Concorrenza e database

La relazione iniziale è `richieste/s × durata media = esecuzioni medie contemporanee`. A 200 richieste/s e 300 ms risultano circa **60 esecuzioni API**; se la media sale a 800 ms, diventano 160. Non si usa il percentile 95 come se fosse la durata media; si considerano attese e richieste che durano molto più della media.

Come proposta iniziale di reserved concurrency: catalogo 100, agenzie/annunci 25, contatti/visite 25, profilo/preferiti 8 e amministrazione 2, per **160 slot API**. I worker e il dispatcher aggiungono undici slot. Sono limiti e ripartizioni da verificare, non istanze preriscaldate o capacità database garantita. La concorrenza dei consumer SQS deve essere coerente con quella della rispettiva funzione.

La distribuzione protegge contatti e controllo dei permessi dalla sola saturazione del catalogo. Con pool client di uno si limita l'apertura di connessioni da ogni esecuzione; il proxy non converte automaticamente 171 client in altrettante query simultanee. Migrazioni e sonde aggiungono lavoro da considerare.

Il massimo delle connessioni backend del proxy si configura rispetto al limite effettivo Aurora, lasciando margine a manutenzione e failover. Non si assegna una percentuale universale: occorre misurare attese, query attive e lock al minimo ACU, non soltanto leggere `max_connections`, che può riflettere il massimo del range. Prima di aumentare concorrenza si verifica il collo di bottiglia.

Le novanta ricerche/s usano filtro di visibilità e indici SQL nella stessa query. Si controllano piani di esecuzione, filtri poco selettivi, ordinamenti, righe esaminate e transazioni di modifica concorrenti. Il reader non aggiunge capacità alle letture ordinarie, che restano sul writer per la freschezza richiesta.

### File e crescita dei record

Una stima a un anno considera circa 1,1 milioni di messaggi: con **2 KB medi**, circa 2,2 GB di solo testo. I 365.000 contatti con 1 KB medio aggiungono circa 0,37 GB; annunci, immobili, relazioni media, visite, preferiti, storico e indici completano il volume. Questi valori medi sono ipotesi, non i limiti massimi dei campi.

Trenta GB iniziali per il conto lasciano margine rispetto ai soli payload. Si misurano dimensioni effettive di tabelle e indici, dati morti, vacuum, statistiche e crescita; una policy di dodici mesi per contatti chiusi non elimina tutte le pratiche ancora attive. La capacità va rivista nel tempo.

Le immagini aggiunte richiedono CPU/memoria al worker; i 2,1 TB già presenti non vengono rielaborati ogni mese. Un caricamento iniziale completo e l'eventuale scansione di tutto il patrimonio sono costi una tantum, separati dal normale mese di upload.

### Arretrato

Con dieci secondi medi per immagine e quattro worker, la capacità teorica è 24 immagini/minuto, prima dei limiti dello scanner e del database. Un esempio di 500 immagini già verificate dallo scanner richiede circa 21 minuti, con nuovi arrivi ordinari piccoli rispetto a quel ritmo. Per 5.000 avvisi, due worker a 200 ms richiedono circa otto minuti, se SES consente il ritmo.

Sono esempi di verifica, non volumi ricavati dal picco API: quel picco non specifica quanti upload o avvisi genera. Il target di recupero in trenta minuti richiede una prova con scanner, quote, retry e arrivi simultanei. Gli esiti incerti non diventano reinvii automatici per svuotare la coda.

## 3. Tariffe verificate e metodo

Per le voci regionali sono stati letti i listini pubblici AWS, senza credenziali o accesso a un account. Si riportano le tariffe utili al calcolo, oltre alle pagine che ne spiegano il modello. I link `current` cambiano nel tempo: data e valori sotto fissano la base di questa stima.

| Voce | Tariffa usata, USD | Fonte |
| --- | --- | --- |
| Aurora Standard Serverless v2 | 0,14 / ACU-ora | [Listino RDS Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-central-1/index.json) |
| Storage Aurora / I/O | 0,119 / GB-mese; 0,22 / milione I/O | Stesso listino RDS |
| RDS Proxy su Aurora Serverless v2 | 0,018 / ACU-ora sottostante | Stesso listino; [modello Proxy](https://aws.amazon.com/rds/proxy/pricing/) |
| NAT, ore e dati | 0,052 / zona-ora; 0,052 / GB elaborato | [Tabella pubblica NAT](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/natgateway.json), [modello regionale](https://aws.amazon.com/vpc/pricing/) |
| IPv4 pubblico | 0,005 / indirizzo-ora | [Listino VPC Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/eu-central-1/index.json) |
| API REST | 3,70 / milione richieste nel primo scaglione | [Listino API Gateway Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/eu-central-1/index.json) |
| Lambda x86, primo scaglione | 0,0000166667 / GB-s; 0,20 / milione invocazioni | [Listino Lambda Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/eu-central-1/index.json) |
| S3 Standard | 0,0245 / GB-mese nel primo scaglione | [Listino S3 Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-central-1/index.json) |
| Backup S3, vault standard caldo | 0,06 / GB-mese; restore 0,024 / GB | [Listino Backup Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBackup/current/eu-central-1/index.json) |
| Scanner S3, tariffa pagante | 0,129 / GB; 0,000308 / oggetto | [Listino GuardDuty Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/eu-central-1/index.json) |
| CloudFront verso utenti europei | 0,085 / GB nel primo scaglione; 0,012 / 10.000 HTTPS | [Listino CloudFront globale](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json) |
| Cognito Essentials | 0,015 / utente attivo mensile, prima delle franchigie | [Prezzi Cognito](https://aws.amazon.com/cognito/pricing/) |
| Amplify SSR, build e trasferimento | 0,30 / milione SSR; 0,20 / GB-ora; build standard 0,01 / minuto; 0,15 / GB | [Listino Amplify Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSAmplify/current/eu-central-1/index.json) |
| Amplify con WAF | 15 / applicazione-mese, oltre ai costi WAF | [Prezzi Amplify](https://aws.amazon.com/amplify/pricing/) |
| WAF base | 5 / ACL-mese; 1 / regola-mese; 0,60 / milione richieste | [Prezzi WAF](https://aws.amazon.com/waf/pricing/) |
| SES, invio base | 0,10 / mille email, oltre ai dati inviati | [Prezzi SES](https://aws.amazon.com/ses/pricing/) |
| Synthetics | 0,0016 / run Francoforte; 0,0014 / run Irlanda, oltre alle risorse esecutive | [Listino CloudWatch Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/eu-central-1/index.json), [Irlanda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/eu-west-1/index.json) |

Il conto considera prezzi lordi prima delle franchigie. La loro applicazione dipende dall'account, dai servizi e dalla condivisione nell'organizzazione: non si moltiplica il free tier per ogni ambiente. Non si sommano come costi sia risorse già incluse in un bundle sia la stessa risorsa a consumo.

Cognito **Essentials** diventa il piano di base: supporta managed login e rotazione refresh previsti, senza introdurre le funzionalità di rischio del piano Plus. Il costo segue i MAU e non il numero di login o registrazioni. Il listino prevede una franchigia di 10.000 MAU per account/organizzazione per Lite/Essentials: se interamente disponibile a Domora, 25.000 MAU passano da 375 a **225 USD**. Il totale prudente non applica questa riduzione.

## 4. Conto mensile della produzione

| Voce | Formula o ipotesi | USD/mese, circa |
| --- | --- | ---: |
| Aurora compute | 2 istanze × 3 ACU medie × 730 h × 0,14 | 613,20 |
| RDS Proxy | 6 ACU complessive medie × 730 h × 0,018 | 78,84 |
| Aurora storage, I/O e backup aggiuntivo | 30 GB × 0,119 + 100 milioni I/O × 0,22 + 3 di riserva backup | 28,57 |
| NAT e IPv4 | 2 zone × 730 h × 0,052 + 2 IPv4 × 730 h × 0,005 + 100 GB × 0,052 | 88,42 |
| Cognito Essentials | 25.000 MAU × 0,015, senza franchigia | 375,00 |
| API REST | 6 milioni × 3,70 | 22,20 |
| Lambda API | 6 milioni × 1 GB × 0,3 s × tariffa compute + invocazioni | 31,20 |
| Worker e dispatcher | Lavorazioni ordinarie, retry e margine iniziale | 5,00 |
| S3 operativo | 2.100 GB + 20% per versioni/temporanei, × 0,0245 | 61,74 |
| Backup S3 | 2.100 GB × 0,06 + 20 per incrementi e operazioni | 146,00 |
| Scanner | 33 GB × 0,129 + 12.000 oggetti × 0,000308 | 7,95 |
| CloudFront media a consumo | 2.700 GB × 0,085 + 18 milioni HTTPS × 0,0000012 | 251,10 |
| Amplify | SSR circa 15,54; frontend 18; build 200 min e storage, arrotondati | 36,00 |
| WAF e associazione Amplify | Tre ACL con cinque regole fatturabili ciascuna, circa 9,25 milioni richieste e quota Amplify | 51,00 |
| SES | 120.000 email + dati e margine | 13,00 |
| Osservabilità | Sonde, esecuzioni, log, metriche, allarmi, tracce e audit | 302,00 |
| Altri servizi e trasferimenti | SQS/EventBridge/Scheduler, segreti, DNS, artefatti, CodeBuild, richieste S3 e trasferimenti residui | 20,00 |
| **Totale centrale** | Somma delle voci, prima delle franchigie | **2.131,22** |
| **Budget iniziale con 20% di margine** | Arrotondato; il margine non è una voce AWS | **2.560** |

Le righe di riserva sono **allocazioni di budget**, non tariffe misurate. I/O Aurora, durata, traffico NAT e MAU richiedono riscontri reali. Il calcolo Proxy segue le ACU dei due membri registrati: modalità di fatturazione effettiva e eventuali condizioni minime vanno confermate prima di impegnare spesa, senza dedurre un minimo universale da esempi di altre regioni.

Il costo NAT assume un IPv4 per zona: espansione o indirizzi aggiuntivi cambiano la voce. I download immagini non attraversano NAT; confonderli con i 2,7 TB CDN aumenterebbe artificialmente la stima. Trasferimenti API, tra zone, documenti privati e altri percorsi residui sono nella riserva, da misurare separatamente se crescono.

Lo storage Aurora è condiviso dal cluster: non si raddoppiano trenta GB perché ci sono writer e reader. I/O fisici non equivalgono a richieste API o righe SQL: i cento milioni sono un'ipotesi di budget, da verificare sui contatori del servizio.

I backup S3 periodici sono incrementali dopo la copia iniziale: non si stimano quattordici copie complete settimanali. Il budget parte da un patrimonio protetto equivalente al principale e riserva operazioni/cambiamenti; consumo effettivo, numero di versioni e oggetti protetti devono essere verificati. Un restore completo di 2.100 GB aggiunge circa **50,40 USD** di tariffa restore, oltre a richieste e risorse temporanee. [Modello dei costi AWS Backup](https://aws.amazon.com/backup/pricing/), [Backup e versioni S3](https://docs.aws.amazon.com/aws-backup/latest/devguide/s3-backups.html).

### Il costo del monitoraggio

Tre controlli al minuto producono 129.600 run/mese; la scrittura ogni quindici minuti altri 2.880. Francoforte totalizza **132.480 run × 0,0016 = 211,97 USD**. La sonda esterna ogni cinque minuti aggiunge **8.640 × 0,0014 = 12,10 USD**.

Con 1 GB e dieci secondi medi per run, si riservano circa 23,52 USD alle esecuzioni Lambda delle sonde, oltre alle invocazioni. Log, metriche, allarmi, artefatti, tracce e audit completano i circa 302 USD. Le sonde aggiungono anche richieste API/hosting; il loro contributo non cambia l'ordine di grandezza del conto e resta compreso nell'arrotondamento operativo. Le chiamate Cognito ripetute dello stesso account di controllo non creano un MAU per run. [Costi aggiuntivi delle sonde — CloudWatch](https://aws.amazon.com/cloudwatch/pricing/).

**Motivazione:** il controllo al minuto è collegato al budget mensile di disponibilità; ridurne la frequenza riduce il costo, ma anche la precisione. Il costo è abbastanza grande da dover essere spiegato nella presentazione, invece di considerare il monitoraggio gratuito.

## 5. Sensibilità e alternative concrete

| Cambiamento isolato | Effetto indicativo rispetto al conto centrale |
| --- | --- |
| Due istanze Aurora sempre al minimo di 2 ACU | Compute 408,80 invece di 613,20; varia anche Proxy |
| Entrambe a 16 ACU per tutto il mese | Solo compute 3.270,40; il massimo configurato non è un tetto del conto complessivo |
| 10.000 / 50.000 / 100.000 MAU | Cognito lordo 150 / 750 / 1.500 USD, rispetto ai 375 centrali |
| Immagini medie da 75 / 300 KB | Traffico CDN circa metà / doppio; numero delle richieste invariato |
| Un picco straordinario | Circa 0,67 di API e 0,94 di Lambda API; circa 0,47 di SSR con le ipotesi medie |
| I/O Aurora da 10 a 500 milioni | Da 2,20 a 110 USD, invece di 22 |

Il costo diretto delle 180.000 API del picco è modesto rispetto a capacità persistente, identità e monitoraggio. Può però far crescere ACU, errori, retry, email o download: il costo di questi effetti non è contenuto nei soli 2,08 USD di API/Lambda/SSR dell'esempio. Non si ricava il traffico immagini del picco senza sapere quante sessioni e pagine aggiunge.

### Aurora oppure RDS PostgreSQL Multi-AZ

Il listino di Francoforte riporta **0,401 USD/ora** per `db.m7g.large` PostgreSQL Multi-AZ: circa **292,73 USD/mese** di compute, già per il deployment Multi-AZ, non da raddoppiare. Con cento GB GP3 a 0,274/GB-mese e proxy su due vCPU a 0,018/vCPU-ora, il sottototale è circa **346,41 USD**, prima di backup extra e trasferimenti. [Listino RDS Francoforte](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-central-1/index.json).

Il confronto Aurora centrale per compute, proxy, storage e I/O è circa 718 USD, prima della piccola riserva backup. **RDS è quindi un'alternativa economica seria**. La sua istanza da 8 GiB e capacità fissa non è equivalente a un writer Aurora che può salire a sedici ACU: la tariffa non dimostra che sostenga le novanta ricerche/s insieme alle modifiche e al recupero locale richiesto.

Aurora rimane la base progettata per la capacità variabile, con writer/reader già definiti. Non viene presentata come l'opzione più economica. Prima di un'implementazione con budget reale si confrontano i due candidati sugli stessi dati e picchi: se RDS soddisfa latenza, failover e crescita con costo minore, sostituire Aurora è una semplificazione legittima. Non serve aggiungere un motore di ricerca per mantenere la scelta iniziale.

### CloudFront a consumo oppure piano fisso

Il conto usa CloudFront a consumo, per mantenere esplicite le configurazioni di cache e intestazioni già progettate. Esistono piani fissi: **Business costa 200 USD/distribuzione-mese** e comprende regole cache e response header personalizzate. Pro costa meno, ma non offre tutte queste configurazioni, necessarie per separare cache CDN e `no-store` verso il browser.

Business è da confrontare con circa 251 USD di media a consumo, verificando domini, credito S3 e compatibilità effettiva. Il suo bundle riguarda quella distribuzione: non sostituisce automaticamente WAF regionale API/Cognito o i costi di Amplify. Non si deducono risparmi contando crediti due volte. [Piani CloudFront](https://aws.amazon.com/cloudfront/pricing/), [Compatibilità delle configurazioni](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).

Non si introducono I/O-Optimized, provisioned concurrency, interface endpoint o piani di impegno senza misure che ne giustifichino il costo. La ricerca PostgreSQL conserva il vantaggio di non mantenere OpenSearch e la relativa sincronizzazione.

## 6. Staging e dimostrazione scolastica

Staging permanente mantiene due zone, due istanze e le stesse integrazioni, ma con dati sintetici: ipotesi economica di 5 GB database, 20 GB file, meno di cento MAU e traffico limitato. I tre controlli principali girano ogni cinque minuti, la scrittura ogni quindici; si riporta al minuto durante le prove del piano operativo. Non serve la sonda esterna continuativa di staging.

| Gruppo | Budget staging, USD/mese circa |
| --- | ---: |
| Aurora al minimo di 0,5 ACU per ciascuna istanza | 102 |
| Proxy, dati e I/O contenuti | 17 |
| NAT, IPv4 e poco traffico | 84 |
| Monitoraggio a frequenza ridotta e relative esecuzioni | 80 |
| WAF e quota Amplify | 46 |
| Identità, file/backup/scanner, build, email e altri servizi | 26 |
| **Totale indicativo** | **355** |

Il totale staging dipende dalla permanenza al minimo; non comprende grandi test di carico o restore. Produzione centrale e staging permanente arrivano a circa **2.486 USD/mese**, oppure **3.000 USD/mese di budget arrotondato con margine del 20%**. Non è un costo adeguato a una semplice esercitazione lasciata accesa senza controllo.

Per la dimostrazione si può realizzare **solo staging**, con fixture piccole e una finestra di collaudo. Senza risorse AWS, questa fase documentale non genera i costi progettati. Un ambiente temporaneo per pochi giorni paga ore effettive, storage residuo e voci con proprie regole di fatturazione: non si divide automaticamente 355 per trenta e non si presume che fermare il database elimini NAT, segreti, backup e hosting.

Ridurre a una sola zona o eliminare scanner/backup sarebbe un prototipo diverso, da etichettare; non dimostrerebbe l'architettura descritta. La strategia preferita è mantenere le proprietà del collaudo e limitarne durata e dati, anziché dichiarare equivalenti due sistemi diversi.

## 7. Controllo della spesa e verifiche prima dell'implementazione

Si prevede un budget per ambiente con avvisi al 50%, 80% e 100% e analisi degli scostamenti per servizio. Gli avvisi non sono un blocco della fatturazione. Un teardown degli ambienti temporanei è un'attività pianificata, con verifica dei residui, senza cancellare backup necessari o state per errore. [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

Prima del provisioning si verificano disponibilità e quote effettive per Lambda/API Gateway, capacità Aurora/proxy, IP/subnet/NAT, invio SES, Cognito e scanner. La presenza di una tariffa regionale non prova che l'account abbia già la quota o l'abilitazione necessaria.

Il collaudo produce dati su ACU nel tempo, latenza ed errori ai picchi, query/lock, connessioni, durata/memoria dei worker, backlog, quote SES, byte distribuiti, MAU e costi delle sonde. Il conto viene aggiornato con quei dati; aumento di capacità e riduzione di funzioni richiedono una motivazione riferita al requisito.

Sono esclusi imposte, dominio acquistato, abbonamenti GitHub, piano di supporto AWS, lavoro umano e reperibilità, consulenze e gestione privacy. Caricamento iniziale, migrazioni estese, restore e prove con capacità aggiuntiva sono spese straordinarie. La riserva non copre un attacco illimitato o uso arbitrario fuori scenario.

**Valutazione:** lo stack è coerente con il progetto completo, ma il suo costo principale non è Lambda. Pesano capacità database pronta, identità attiva, monitoraggio, media e doppio ambiente. Per la presentazione si difende ogni voce con il requisito che serve; per un'implementazione economica si rivalutano prima Aurora/RDS, CDN e frequenze di collaudo, preservando le regole sui dati e sui permessi.

La [sintesi finale](16-sintesi-e-presentazione.md) collega decisioni, rischi residui e percorso espositivo, mantenendo distinti ipotesi e risultati da provare.
