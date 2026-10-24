// 4.3 Dalla Lambda al database — la catena Lambda → RDS Proxy → Aurora, con i due tratti autenticati in modo diverso.
const path = require("path");
const { Paragraph, AlignmentType } = require("docx");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;
  // Paragrafo che introduce un blocco di codice: meno spazio sotto, come nel capitolo modello.
  const intro = t => new Paragraph({ children: S.runs(t), spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED });

  return [
  h2("4.3 Dalla Lambda al database"),
  p("Cinque Lambda su sei usano il database: Property, Users, Offers, Presigned e Files. Nessuna di loro parla direttamente con Aurora. Si collegano all'**RDS Proxy** `real-estate-prod-db-proxy`, che tiene poche connessioni stabili verso il cluster `real-estate-prod-aurora` e ci smista le molte connessioni brevi delle Lambda. La catena è quindi Lambda → proxy → Aurora, e i due tratti **non si autenticano allo stesso modo**: le Lambda entrano nel proxy con un token IAM, il proxy entra in Aurora con la password dell'utente PostgreSQL, che legge da Secrets Manager con un ruolo suo."),
  p("Il motivo del proxy è il modello di esecuzione di Lambda. Ogni istanza di una funzione apre la propria connessione: con 200 invocazioni concorrenti ci sarebbero 200 connessioni, e PostgreSQL ha un limite (`max_connections`). In Spring Boot il problema lo risolve HikariCP dentro l'applicazione; qui le istanze sono tante e separate, quindi il pool deve stare **fuori**, condiviso tra tutte: il proxy è un pooler gestito da AWS, più simile a un PgBouncer. Con il traffico del progetto non è strettamente necessario, e lo diciamo; lo teniamo per robustezza, perché ci dà anche l'autenticazione IAM (nessuna password nelle Lambda) e un failover percepito più breve."),
  p("Separare i due tratti ha un effetto preciso: **la password del database la vede solo il proxy**. Le Lambda non hanno password nel codice, nelle variabili d'ambiente o in Git, e non hanno il permesso di leggere i secret. Se una Lambda venisse compromessa, l'attaccante avrebbe al massimo il permesso di entrare nel proxy come l'utente PostgreSQL di quella Lambda, con i suoi `GRANT`."),
  ...figura(path.join(DIAGRAMMI, "database.png"), 3216, 1163,
    "Figura 4.3 — La catena Lambda → RDS Proxy → Aurora nel diagramma v3, con la lettura dei secret. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  ...elencoNumerato([
    "All'avvio dell'ambiente di esecuzione il servizio Lambda assume l'**execution role** della funzione e passa al codice credenziali temporanee.",
    "Fuori dall'handler, il codice genera con l'SDK un **token di autenticazione** per il proxy (`generate-db-auth-token`): host del proxy, porta 5432, utente PostgreSQL della Lambda. È un calcolo locale firmato SigV4 con le credenziali del ruolo, senza chiamate di rete; il token vale 15 minuti.",
    "La Lambda apre una connessione PostgreSQL verso il proxy sulla porta **5432**, su **TLS**, usando il token **come password**. In rete passa da `sg-lambda-internal` a `sg-rds-proxy`.",
    "Il proxy verifica il token con IAM: il ruolo della Lambda deve avere `rds-db:connect` proprio su quella coppia proxy/utente.",
    "Per parlare con Aurora il proxy usa la **password** dell'utente, contenuta nel secret `real-estate/prod/database/<DB_USER>`. La legge con `GetSecretValue`, assumendo il proprio ruolo `real-estate-prod-rds-proxy-secrets-role`; Secrets Manager la decifra con la chiave KMS `aws/secretsmanager`.",
    "Il proxy apre (o riusa dal pool) una connessione TLS sulla porta 5432 verso il **writer** del cluster; `sg-rds` accetta solo `sg-rds-proxy`. Da lì in poi decidono i `GRANT` dell'utente PostgreSQL.",
  ]),

  h3("Chi parla con chi"),
  p("Come negli altri flussi, ogni freccia ha un controllo di rete e uno di identità. Qui i controlli di identità sono di tre tipi diversi: IAM per entrare nel proxy, una password per entrare in Aurora, i `GRANT` SQL per decidere cosa si fa sulle tabelle."),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "Servizio Lambda → execution role", "`sts:AssumeRole` all'avvio dell'ambiente", "interno ad AWS (non passa dalla VPC)", "trust `lambda.json` del ruolo (`lambda.amazonaws.com`)"],
      ["2", "Lambda → RDS Proxy", "PostgreSQL 5432, TLS obbligatorio, token IAM come password", "subnet privata; `sg-lambda-internal` esce su 5432 verso `sg-rds-proxy`, che accetta 5432 solo da lì", "`rds-db:connect` su `dbuser:<prx-ID>/<utente>` nell'execution role"],
      ["3", "Servizio RDS → ruolo del proxy", "`sts:AssumeRole`", "interno ad AWS", "trust `rds-proxy.json` (`rds.amazonaws.com`)"],
      ["4", "RDS Proxy → Secrets Manager", "`secretsmanager:GetSecretValue` via HTTPS (443)", "eventualmente tramite l'interface endpoint, *da verificare*: `sg-endpoint-secrets-manager` accetta 443 solo da `sg-rds-proxy`", "`rds-proxy-read-secrets.json` nel ruolo del proxy"],
      ["5", "Secrets Manager → KMS", "decifratura del secret", "interno ad AWS", "key policy della chiave gestita `aws/secretsmanager`; con una CMK anche `rds-proxy-decrypt-secrets.json`"],
      ["6", "RDS Proxy → Aurora (writer)", "PostgreSQL 5432, TLS, utente e password dal secret", "`sg-rds-proxy` esce su 5432 verso `sg-rds`, che accetta 5432 solo da lì", "credenziali PostgreSQL; poi i `GRANT` dell'utente"],
      ["7", "Aurora → reader", "replica sullo storage condiviso; promozione in caso di failover", "interno al cluster", "nessun permesso: lo gestisce Aurora"],
    ],
    [400, 2000, 2400, 2700, 2600],
  ),
  dopoTabella(),

  h3("Le autorizzazioni, passaggio per passaggio"),
  p("In questo flusso ci sono **due ruoli** (quello della Lambda e quello del proxy) e **due livelli di identità** (IAM per entrare nel proxy, l'utente PostgreSQL per entrare nel database). Conviene tenerli separati, perché sono l'errore più frequente: il ruolo della Lambda non sa nulla dei secret, il ruolo del proxy non ha `rds-db:connect`."),
  ...codice(`Lambda    --(1: assume l'execution role, trust lambda.amazonaws.com)--> credenziali temporanee
Lambda    --(2: token IAM firmato SigV4, rds-db:connect)--> RDS Proxy
RDS Proxy --(3: assume real-estate-prod-rds-proxy-secrets-role, trust rds.amazonaws.com)--> credenziali temporanee
RDS Proxy --(4: GetSecretValue)--> Secrets Manager -> username/password
RDS Proxy --(5: password PostgreSQL)--> Aurora`, "i due ruoli e i due livelli di identità (da rds-proxy.md)"),

  intro("**Passo 2 — entrare nel proxy con IAM.** Ogni execution role delle cinque Lambda ha un permesso `rds-db:connect` costruito su questo modello:"),
  ...codice(leggiJson("iam/policies/lambda-connect-proxy.json"), "iam/policies/lambda-connect-proxy.json"),
  punto("La risorsa è **una sola coppia** proxy/utente: `dbuser:<PROXY_RESOURCE_ID>/<DB_USER>`. La Offers può entrare solo come `offers_user`, la Files solo come `files_user`, e così via: le policy reali di ogni Lambda hanno già l'utente scritto."),
  punto("`<PROXY_RESOURCE_ID>` è l'ID risorsa del proxy, quello che inizia con `prx-`, non il nome `real-estate-prod-db-proxy`, non il suo ARN e non l'ID del cluster. È il punto in cui si sbaglia più spesso, e l'errore si vede solo come un rifiuto della connessione."),
  punto("Il token è una **firma**, non una chiamata: l'SDK lo calcola in locale con le credenziali temporanee del ruolo, quindi la Lambda non ha bisogno di raggiungere IAM o STS dalla VPC. Vale 15 minuti, ma una connessione già aperta non si chiude a quella scadenza: per questo la connessione si apre fuori dall'handler e si riusa nelle invocazioni successive, come un `DataSource` singleton."),
  punto("Le Lambda **non** assumono il ruolo del proxy e **non** hanno `secretsmanager:GetSecretValue`. La Mailer, che non usa il database, non ha `rds-db:connect`."),
  p("Sul proxy l'opzione che rende obbligatorio tutto questo è *Require IAM authentication* per i client, insieme a *Require TLS*: una Lambda che provasse a entrare con una password, o senza TLS, verrebbe rifiutata. La connessione usa `sslmode=require`, o `verify-full` con il bundle CA di RDS."),

  intro("**Passo 3 — il ruolo del proxy.** Il proxy non ha credenziali proprie: come le Lambda, usa un ruolo. Lo assume il servizio RDS, e la trust lo dice:"),
  ...codice(leggiJson("iam/trust-relationships/rds-proxy.json"), "iam/trust-relationships/rds-proxy.json"),
  p("È il caso di un servizio AWS che agisce nel nostro account con un ruolo che gli diamo, come Lambda con l'execution role. Per consegnarlo al proxy serve `iam:PassRole`, che ha solo l'identità di deploy, limitato ai ruoli `real-estate-prod-*` e ai servizi Lambda e RDS."),

  intro("**Passo 4 — leggere il secret.** La permissions policy del ruolo permette una sola azione, sui soli secret applicativi:"),
  ...codice(leggiJson("iam/policies/rds-proxy-read-secrets.json"), "iam/policies/rds-proxy-read-secrets.json"),
  punto("In `Resource` vanno gli ARN **completi** dei cinque secret `real-estate/prod/database/<utente>`, con il suffisso casuale che Secrets Manager aggiunge (`-AbCdEf`); gli stessi secret si associano alla configurazione del proxy."),
  punto("Il secret dell'utente master **non** c'è: resta riservato all'amministrazione e non è associato al proxy."),
  punto("Nessun permesso di modifica o cancellazione dei secret, di gestione del cluster o IAM. E nessun `rds-db:connect`: verso Aurora il proxy usa la password, non IAM."),
  p("Sul secret non c'è una resource policy: siamo nello stesso account e basta l'identity policy del ruolo. Ogni secret è un JSON `{\"username\": \"...\", \"password\": \"...\"}`, il formato che il proxy si aspetta, e corrisponde a un utente che esiste già in Aurora. Il secret **non crea** l'utente e non gli dà permessi: utente e `GRANT` si creano in PostgreSQL. I valori si inseriscono direttamente in Secrets Manager, mai nella repository."),

  intro("**Il ruolo di KMS.** Il secret è cifrato a riposo con KMS, con la chiave gestita da AWS `aws/secretsmanager`. Quando il proxy chiama `GetSecretValue`, è Secrets Manager a usare la chiave per decifrare il valore prima di restituirlo. Con KMS la **key policy** deve ammettere l'uso anche nello stesso account (è una delle eccezioni del paragrafo 3.1). La chiave gestita lo fa già da sola per le richieste che passano da Secrets Manager, quindi oggi non serve altro. Se un giorno scegliessimo una chiave del cliente (CMK), al ruolo del proxy andrebbe aggiunta questa policy, e la key policy della CMK dovrebbe ammettere il ruolo:"),
  ...codice(leggiJson("iam/policies/rds-proxy-decrypt-secrets.json"), "iam/policies/rds-proxy-decrypt-secrets.json"),
  p("La condizione `kms:ViaService` fa sì che il ruolo possa decifrare **solo attraverso Secrets Manager** nella nostra regione: non può usare la chiave direttamente per altro. La chiave che cifra lo storage di Aurora (`aws/rds`, da scegliere alla creazione del cluster) è una risorsa separata e non c'entra con questa policy."),

  intro("**Passo 6 — entrare in Aurora.** Qui IAM non c'è più. Il proxy si presenta ad Aurora con utente e password del secret, su TLS. Per questo:"),
  punto("agli utenti PostgreSQL applicativi **non** si assegna il ruolo `rds_iam`, che cambierebbe la loro modalità di autenticazione e li renderebbe inutilizzabili con la password;"),
  punto("la modalità scelta è \"secret per il proxy, IAM per i client\", e **non** `DefaultAuthScheme=IAM_AUTH`, la diversa modalità IAM end-to-end in cui spariscono i secret ma gli utenti devono avere `rds_iam`;"),
  punto("IAM **non sostituisce** i `GRANT`: IAM decide chi entra nel proxy e con quale utente; i `GRANT` SQL decidono cosa quell'utente può fare su tabelle e sequenze. Come in Spring si userebbe un utente del datasource diverso da `postgres`, ogni Lambda ha il suo utente (`property_user`, `users_user`, `offers_user`, `files_user`, `presigned_user`) con i soli `GRANT` che le servono."),
  p("Aurora stessa usa il service-linked role `AWSServiceRoleForRDS`, gestito da AWS, che serve al servizio per gestire le sue risorse (per esempio le interfacce di rete). Non dà accesso ai dati a nessuno, e il ruolo del proxy va associato al proxy, non alle istanze."),

  h3("La rete: porta 5432, TLS e la catena di security group"),
  p("Il proxy vive **solo nella VPC**, nelle due subnet private `private_subnet_A` e `private_subnet_B`, senza endpoint pubblico. È il motivo per cui le cinque Lambda di business stanno nella VPC con il security group `sg-lambda-internal`. Per questo flusso la catena dei security group del paragrafo 3.2 si riduce a tre anelli, ognuno dei quali accetta solo il precedente: `sg-lambda-internal` esce su 5432 verso `sg-rds-proxy`, che accetta 5432 solo da lì; `sg-rds-proxy` esce su 5432 verso `sg-rds` (e su 443 verso `sg-endpoint-secrets-manager`); `sg-rds` accetta 5432 solo dal proxy. Il risultato è che **le Lambda non raggiungono Aurora direttamente**: `sg-rds` non le ammette."),
  p("TLS è obbligatorio su entrambi i tratti: dalle Lambda al proxy (*Require TLS*) e dal proxy ad Aurora. Il traffico non lascia mai la VPC, ma la cifratura in transito vale ovunque, come la cifratura a riposo di Aurora con `aws/rds`."),

  intro("**L'endpoint di Secrets Manager, \"da verificare\".** La VPC non ha NAT né Internet Gateway. Secrets Manager è un servizio regionale fuori dalla VPC, quindi in teoria il proxy, che sta in subnet senza Internet, dovrebbe raggiungerlo con l'interface endpoint `com.amazonaws.eu-south-1.secretsmanager`, con Private DNS e il security group `sg-endpoint-secrets-manager`. Ma la documentazione AWS non dice se il proxy ne abbia bisogno: né le pagine sui prerequisiti di rete né quelle di troubleshooting lo chiariscono. Per questo nel diagramma è tratteggiato e segnato \"da verificare\"."),
  p("La decisione è di tenerlo nel piano e verificarlo alla creazione del proxy: se il target risulta `AVAILABLE` senza endpoint, lo togliamo insieme alla regola `sg-rds-proxy` → `sg-endpoint-secrets-manager`, e risparmiamo il costo di un interface endpoint su due AZ. L'endpoint usa la policy di default: il filtro vero è il ruolo del proxy."),

  h3("Writer, reader e failover"),
  p("Il cluster ha un'istanza **writer** in AZ-1 (`eu-south-1a`) e una **reader** in AZ-2 (`eu-south-1b`). In Aurora calcolo e storage sono separati: le istanze fanno solo calcolo, mentre i dati stanno in un volume distribuito su 3 AZ con 6 copie. Per questo una reader può diventare writer in poco tempo: i dati li ha già."),
  p("Il proxy ha come target il **cluster**, non un'istanza, e il suo endpoint di default manda tutto al writer. Se il writer cade, Aurora promuove la reader, in genere in decine di secondi, e il cluster endpoint si aggiorna. Il proxy nel frattempo tiene aperte le connessioni delle Lambda e si ricollega al nuovo writer: il failover che le Lambda percepiscono è più breve di quello che vedrebbero collegandosi direttamente. Proxy, Lambda ed endpoint hanno già ENI in entrambe le subnet, quindi la caduta di una AZ non li isola."),
  p("Oggi la reader **serve solo per il failover**: non riceve letture. Per distribuire le letture servirebbe un endpoint di sola lettura del proxy, che resta un punto aperto. Utenti, secret e ruoli non si duplicano per AZ: appartengono al cluster."),

  h3("Quando qualcosa va storto"),
  tabella(
    ["Sintomo", "Causa probabile", "Dove guardare"],
    [
      ["La Lambda va in timeout aprendo la connessione", "rete: manca la regola 5432 tra `sg-lambda-internal` e `sg-rds-proxy`, o la Lambda non è nelle subnet della VPC", "security group, configurazione VPC della funzione"],
      ["Il proxy rifiuta l'autenticazione", "`rds-db:connect` con il nome del proxy invece dell'ID `prx-...`, utente sbagliato, token scaduto o generato per un altro host", "policy del ruolo della Lambda; IAM Policy Simulator"],
      ["Il proxy rifiuta la connessione senza TLS", "client senza `sslmode=require`", "configurazione del client PostgreSQL"],
      ["Il target del proxy non è disponibile", "il proxy non legge il secret: ARN senza suffisso, secret non associato, ruolo senza trust; oppure non raggiunge Secrets Manager (endpoint)", "stato del target del proxy, policy e trust del ruolo"],
      ["Connessione riuscita ma `permission denied` sulle tabelle", "mancano i `GRANT` dell'utente PostgreSQL: IAM ha fatto la sua parte", "`GRANT` in PostgreSQL"],
      ["Errori per qualche decina di secondi", "failover del writer in corso", "eventi del cluster; il proxy si ricollega da solo"],
    ],
    [2800, 4000, 2800],
  ),
  dopoTabella(),
  p("Restano due rischi dichiarati. Il primo è il **connection pinning**: alcune operazioni (come `SET` o certi prepared statement) legano una connessione del pool a un solo client e riducono il multiplexing, quindi il codice delle Lambda deve evitarle. Il secondo è che nulla di questo è stato provato su un account reale: una connessione di prova, il comportamento durante il failover e il bisogno dell'endpoint di Secrets Manager sono da verificare creando le risorse. Il costo, infine, non è trascurabile: writer, reader e proxy si pagano anche a vuoto, e sono la voce più cara del progetto."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["RDS Proxy tra Lambda e Aurora", "pooling condiviso tra istanze, autenticazione IAM, failover più breve", "nessun proxy: possibile con poche Lambda e connessioni riusate, ma rischio su `max_connections` e niente IAM"],
      ["Lambda → proxy con IAM e TLS", "nessuna password nelle Lambda; credenziali temporanee che scadono da sole", "password nelle variabili d'ambiente o letta dalle Lambda in Secrets Manager"],
      ["Proxy → Aurora con password da Secrets Manager", "modello più comune e documentato; la password la vede solo il proxy", "IAM end-to-end (`IAM_AUTH`): niente secret, endpoint e KMS, ma utenti con `rds_iam`"],
      ["Un utente PostgreSQL e un secret per Lambda", "least privilege anche dentro il database, con i `GRANT`", "un solo utente applicativo per tutte le Lambda"],
      ["Chiave gestita `aws/secretsmanager`", "gratuita, nessuna key policy da scrivere", "CMK: controllo e audit, ma ~1 $ al mese, key policy e `rds-proxy-decrypt-secrets.json`"],
      ["Endpoint di Secrets Manager tenuto \"da verificare\"", "non sappiamo se serve; lo si toglie se il proxy funziona senza", "toglierlo subito o darlo per necessario senza prova"],
      ["Reader solo per il failover", "il carico non richiede di distribuire le letture", "endpoint di sola lettura del proxy (punto aperto)"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Differenza tra l'autenticazione Lambda → proxy e proxy → Aurora?** La Lambda entra con un token IAM di 15 minuti firmato con il suo ruolo (`rds-db:connect`); il proxy entra in Aurora con la password del secret, che legge con il suo ruolo. Le Lambda non vedono mai la password.",
    "**Cosa metti nella risorsa del permesso di connessione?** In `rds-db:connect` va `dbuser:<prx-ID>/<utente>`, con l'ID risorsa del proxy (`prx-...`) e non il nome: una sola coppia proxy/utente per ruolo.",
    "**Perché la trust del ruolo del proxy è verso il servizio RDS?** Perché è `rds.amazonaws.com` ad assumerlo per leggere i secret. Senza la trust non potrebbe; senza `GetSecretValue` lo assumerebbe ma non leggerebbe niente.",
    "**Che c'entra KMS?** Il secret è cifrato con `aws/secretsmanager`, che Secrets Manager usa per decifrarlo. Con una CMK servirebbero la key policy e `kms:Decrypt` con `kms:ViaService`, così la chiave si usa solo tramite Secrets Manager.",
    "**Cosa succede se cade il writer?** Aurora promuove la reader in decine di secondi; il proxy tiene le connessioni delle Lambda e si ricollega al nuovo writer.",
  ]),
];
};
