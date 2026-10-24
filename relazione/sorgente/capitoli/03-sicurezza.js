// 3. Il modello di sicurezza — le tre facce di IAM, la rete come secondo lucchetto, la mappa delle autorizzazioni.
// È la base dei flussi del capitolo 4: qui i concetti e la visione d'insieme, là il dettaglio di ogni passaggio.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h1, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;

  return [
  h1("3. Il modello di sicurezza"),
  p("Ogni freccia del diagramma è una richiesta che qualcuno fa a qualcun altro, e ogni richiesta deve essere **permessa due volte**: dalla rete, che decide se i pacchetti arrivano, e da IAM, che decide se chi chiama può fare quell'operazione su quella risorsa. Questo capitolo spiega le regole del gioco una volta per tutte; i flussi del capitolo 4 le applicano passaggio per passaggio e rimandano qui."),
  p("Prima di cominciare conviene separare tre livelli che è facile confondere:"),
  tabella(
    ["Livello", "Chi è il soggetto", "Chi decide", "Dove si vede"],
    [
      ["Utenti finali", "visitatore, `buyer`, `agent`, `admin`", "Cognito li autentica; l'authorizer JWT controlla il token; la Lambda controlla gruppo e ownership nel database. **Non sono identità IAM**", "flusso 4.2"],
      ["Servizi", "Lambda, RDS Proxy, CloudFront, SNS, S3, API Gateway…", "**IAM**: ruoli, identity policy, resource policy, trust", "questo capitolo"],
      ["Dentro il database", "gli utenti PostgreSQL (`property_user`, `offers_user`…)", "IAM decide chi entra nel proxy e con quale utente; i `GRANT` SQL cosa quell'utente può fare sulle tabelle", "flusso 4.3"],
    ],
    [1700, 2400, 4000, 1500],
  ),
  dopoTabella(),
  p("Per chi viene da Spring Security: il primo livello è il `SecurityFilterChain` con `oauth2ResourceServer().jwt()` e i `@PreAuthorize`; il secondo non ha un vero equivalente in un'applicazione monolitica, perché lì i componenti si chiamano tra loro nello stesso processo. In AWS invece ogni componente è un servizio separato, e ogni chiamata tra servizi passa da IAM. È questo secondo livello il tema del capitolo."),

  // ───────────────────────────── 3.1 ─────────────────────────────
  h2("3.1 Chi può fare cosa: le tre facce di IAM"),
  p("IAM risponde a una domanda: **chi** (il *principal*) può fare **quale azione** su **quale risorsa**, a **quali condizioni**. Di default la risposta è no: un permesso esiste solo se una policy lo concede. I principal non sono solo persone: nel nostro progetto quasi tutti sono **servizi AWS** (`lambda.amazonaws.com`, `sns.amazonaws.com`, `cloudfront.amazonaws.com`…) o **ruoli** indossati da un servizio."),

  h3("Ruoli, non credenziali"),
  p("Nessun componente del progetto ha credenziali proprie. Le Lambda e l'RDS Proxy usano **ruoli IAM**: identità senza password né access key, che un soggetto autorizzato *assume* ricevendo da STS credenziali temporanee che scadono da sole. Nel codice, nelle variabili d'ambiente e nel repository non c'è nessuna chiave. È l'opposto di scrivere username e password in `application.properties` o in un `.env` dentro il container: qui non c'è nulla da rubare che duri più di qualche ora, e nulla da ruotare a mano."),

  h3("Le tre facce"),
  p("Ogni permesso del progetto sta in uno di tre tipi di documento. Sono tutti JSON con la stessa grammatica (`Effect`, `Action`, `Resource`, `Condition`), ma rispondono a domande diverse e stanno attaccati a cose diverse:"),
  tabella(
    ["Documento", "Attaccato a", "Risponde a", "`Principal`", "Esempio nel progetto"],
    [
      ["**Identity policy**", "un ruolo (o utente)", "*cosa può fare* chi indossa questa identità", "implicito: è l'identità stessa", "`lambda-offers.json`: `rds-db:connect` come `offers_user` e `sns:Publish` sul topic"],
      ["**Resource policy**", "una risorsa (bucket, coda, funzione, endpoint, chiave)", "*chi può usare* questa risorsa", "esplicito", "la queue policy della coda: ammette `sns.amazonaws.com` dal nostro topic"],
      ["**Trust policy**", "un ruolo (è la sua resource policy)", "*chi può assumere* il ruolo", "esplicito, di solito un servizio", "`lambda.json`: `lambda.amazonaws.com` può fare `sts:AssumeRole`"],
    ],
    [1600, 1800, 2000, 1500, 2700],
  ),
  dopoTabella(),
  p("**L'execution role** di una Lambda è l'esempio in cui le tre facce si incontrano. Ha una trust policy, uguale per i sei ruoli delle Lambda, che permette al servizio Lambda di assumerlo a ogni avvio dell'ambiente di esecuzione:"),
  ...codice(leggiJson("iam/trust-relationships/lambda.json"), "iam/trust-relationships/lambda.json"),
  p("E ha le sue identity policy: due gestite da AWS (log e, per le cinque Lambda nella VPC, interfacce di rete) più una scritta da noi, che dice cosa fa il codice. Quella della Offers Lambda è tutta qui:"),
  ...codice(leggiJson("iam/policies/lambda-offers.json"), "iam/policies/lambda-offers.json"),
  p("Senza la trust, il servizio Lambda non riesce ad assumere il ruolo e la funzione non parte; senza la identity policy la funzione parte ma non può fare niente. L'altro ruolo di servizio del progetto, quello del proxy, ha la stessa struttura con un altro principal: `rds.amazonaws.com` (si vede nel flusso 4.3)."),
  p("**La resource policy** sta invece dall'altra parte della freccia. Chi può invocare una Lambda non è scritto nel suo ruolo ma **sulla funzione**: il ruolo dice cosa fa la funzione, la resource policy chi la può chiamare. In termini Spring, il primo è cosa può fare il tuo service verso il database, il secondo chi può chiamare il tuo controller. La policy che ammette la nostra HTTP API sulle cinque Lambda di business è commentata nel flusso 4.2."),
  p("Nel progetto compaiono tutti i tipi di resource policy che AWS prevede, anche se non tutti hanno bisogno di essere scritti:"),
  tabella(
    ["Tipo", "Sulla risorsa", "Chi ammette", "Flusso"],
    [
      ["Bucket policy", "bucket del sito e bucket dei file", "`cloudfront.amazonaws.com` dalla sola distribuzione giusta; Deny a tutti senza TLS", "4.1, 4.4"],
      ["Resource policy di una Lambda", "le 5 Lambda di business; la Files Lambda una seconda volta", "`apigateway.amazonaws.com` dalla nostra API; `s3.amazonaws.com` dal bucket dei file", "4.2, 4.4"],
      ["Queue policy", "`real-estate-prod-notifications-queue`", "`sns.amazonaws.com` dal nostro topic", "4.5"],
      ["Endpoint policy", "interface endpoint SNS (facoltativa)", "solo `sns:Publish` sul nostro topic, da identità del nostro account", "4.5"],
      ["Key policy di KMS", "chiavi `aws/rds`, `aws/secretsmanager`", "**nessuna da scrivere**: sono chiavi gestite da AWS, con una key policy fissa", "4.3"],
      ["Trust policy", "i ruoli delle Lambda e del proxy", "`lambda.amazonaws.com`, `rds.amazonaws.com`", "4.2, 4.3"],
      ["Policy del secret, topic policy", "secret di Secrets Manager, topic SNS", "**nessuna**: nello stesso account basta l'identity policy di chi li usa", "4.3, 4.5"],
    ],
    [2000, 2600, 3900, 1100],
  ),
  dopoTabella(),

  h3("Come AWS valuta una richiesta"),
  p("Quando una richiesta arriva, AWS raccoglie **tutte** le policy che la riguardano (quelle dell'identità che chiama, quella della risorsa, eventuali confini) e le valuta in quest'ordine, come descritto nella guida IAM sulla *policy evaluation logic*:"),
  ...elencoNumerato([
    "**Deny implicito.** Il punto di partenza è sempre il rifiuto.",
    "**Deny esplicito.** Se una qualunque policy applicabile contiene un `Deny` che corrisponde alla richiesta, la risposta è no, e nessun `Allow` la può ribaltare.",
    "**Allow.** Altrimenti serve almeno un `Allow`. **Nello stesso account**, per la maggior parte delle risorse basta che lo conceda la identity policy **oppure** la resource policy: i permessi effettivi sono l'unione delle due.",
    "**Le eccezioni.** Le trust policy dei ruoli e le key policy di KMS devono ammettere esplicitamente il principal anche nello stesso account; alcuni altri servizi possono chiedere lo stesso. Tra account diversi servono sempre entrambe le parti.",
    "Permissions boundary, SCP di AWS Organizations e session policy possono solo **togliere**: nel progetto non le usiamo.",
  ]),
  p("In breve: **Deny esplicito > Allow > deny di default**. Il Deny esplicito nel progetto si vede nelle due bucket policy (testo nei flussi 4.1 e 4.4), che rifiutano qualunque richiesta non cifrata, da chiunque arrivi."),
  p("Lo statement `DenyRequestsWithoutTls` del bucket dei file vale anche per i nostri ruoli: la Files Lambda ha `s3:DeleteObject` nella sua identity policy, ma una sua richiesta in HTTP semplice sarebbe rifiutata comunque, perché il Deny vince. L'SDK usa HTTPS, quindi in pratica la regola blocca solo chi prova a farne a meno."),

  h3("Basta un lato solo? Dipende da chi chiama"),
  p("La regola \"nello stesso account basta uno dei due lati\" spiega perché molte frecce del progetto hanno **solo la identity policy**: la Files Lambda cancella oggetti dal bucket dei file anche se la bucket policy non la nomina; la Mailer legge la coda anche se la queue policy non nomina il suo ruolo; il proxy legge i secret senza che i secret abbiano una policy. In tutti questi casi chi chiama è un **nostro ruolo**, e il permesso sta dove è più naturale: nel ruolo."),
  p("Diverse frecce però vanno nell'altro verso: chi chiama è **un servizio AWS**, con il suo *principal di servizio*. Un principal di servizio non ha identity policy nel nostro account, non è un nostro ruolo e non possiamo attaccargli niente. L'unico posto in cui può stare il suo `Allow` è **la resource policy della risorsa** che chiama. Per questo, anche se tutto è nello stesso account, quelle risorse hanno bisogno di una policy scritta da noi:"),
  tabella(
    ["Freccia", "Chi chiama davvero", "Dove sta l'Allow", "Perché lì"],
    [
      ["Files Lambda → S3 (`DeleteObject`)", "il ruolo `real-estate-prod-lambda-files-role`", "identity policy del ruolo", "è un nostro ruolo: basta un lato"],
      ["Mailer → coda (event source mapping)", "il servizio Lambda, **con il ruolo della Mailer**", "identity policy della Mailer", "l'event source mapping usa l'execution role: è ancora un nostro ruolo"],
      ["Proxy → Secrets Manager", "il ruolo `real-estate-prod-rds-proxy-secrets-role`", "identity policy del ruolo", "nostro ruolo, nessuna policy sul secret"],
      ["API Gateway → Lambda", "`apigateway.amazonaws.com`", "resource policy della funzione", "principal di servizio: non ha identity policy"],
      ["S3 → Files Lambda (notifica)", "`s3.amazonaws.com`", "resource policy della funzione", "principal di servizio"],
      ["CloudFront → bucket", "`cloudfront.amazonaws.com` (firma OAC)", "bucket policy", "principal di servizio; CloudFront non ha un ruolo"],
      ["SNS → coda SQS", "`sns.amazonaws.com`", "queue policy", "principal di servizio"],
      ["Proxy → KMS (con una CMK)", "il ruolo del proxy", "identity policy **e** key policy", "eccezione di KMS: la key policy deve ammetterlo comunque"],
    ],
    [2300, 2500, 2100, 2700],
  ),
  dopoTabella(),
  p("Il caso di KMS spiega anche una scelta che altrimenti sembrerebbe arbitraria. La coda delle notifiche è cifrata con **SSE-SQS** e non con la chiave gestita `aws/sqs`: la key policy di `aws/sqs` non ammette `sns.amazonaws.com` e non si può modificare, quindi SNS non riuscirebbe a consegnare. Con SSE-SQS la cifratura la gestisce SQS stesso, senza key policy di mezzo (è l'attributo `SqsManagedSseEnabled` della coda, nel flusso 4.5). Per i secret invece la chiave `aws/secretsmanager` va bene così: la sua key policy ammette già chi usa il secret attraverso Secrets Manager. Se un giorno passassimo a una chiave del cliente, servirebbero sia la key policy sia `rds-proxy-decrypt-secrets.json` nel ruolo del proxy (flusso 4.3)."),
  p("Infine l'**endpoint policy** non concede nulla: è un filtro in più. Una richiesta che passa dall'interface endpoint di SNS deve essere permessa dall'endpoint policy **e** dalle policy di chi chiama; se l'endpoint policy la ammette ma il ruolo non ha `sns:Publish`, la richiesta è rifiutata (flusso 4.5)."),

  h3("Principal di servizio e confused deputy"),
  p("Scrivere `\"Principal\": { \"Service\": \"sns.amazonaws.com\" }` in una resource policy vuol dire ammettere il servizio SNS **in quanto tale**, cioè tutti i topic di tutti i clienti AWS. Un altro account potrebbe creare un suo topic, sottoscrivergli la nostra coda e usare SNS come intermediario per scriverci. Il servizio, che ha il permesso, verrebbe \"ingannato\" a usarlo per conto di chi non lo ha: è il problema del **confused deputy**."),
  p("La guida IAM raccomanda di usare le chiavi di condizione `aws:SourceArn` e `aws:SourceAccount` ogni volta che si concede l'accesso a un principal di servizio: il servizio le valorizza con la risorsa e l'account per conto dei quali sta agendo. Tutte le nostre resource policy verso servizi AWS hanno la condizione:"),
  tabella(
    ["Resource policy", "Principal", "Condizione", "Cosa garantisce"],
    [
      ["`lambda-allow-api-gateway.json`", "`apigateway.amazonaws.com`", "`AWS:SourceArn` = `arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*`", "solo la nostra HTTP API invoca le funzioni"],
      ["`lambda-files-allow-s3.json`", "`s3.amazonaws.com`", "`AWS:SourceArn` = bucket dei file, `AWS:SourceAccount` = nostro account", "solo le notifiche del nostro bucket"],
      ["`s3-website-bucket-policy.json`", "`cloudfront.amazonaws.com`", "`AWS:SourceArn` = distribuzione del sito", "solo la nostra distribuzione legge il sito"],
      ["`s3-files-bucket-policy.json`", "`cloudfront.amazonaws.com`", "`AWS:SourceArn` = distribuzione dei file", "solo la nostra distribuzione legge `uploads/*`"],
      ["`sqs-notifications-queue-policy.json`", "`sns.amazonaws.com`", "`aws:SourceArn` = topic `real-estate-prod-notifications`", "solo il nostro topic scrive nella coda"],
    ],
    [2600, 2100, 3000, 1900],
  ),
  dopoTabella(),
  p("Il caso di S3 è l'unico con due condizioni, e c'è un motivo. Gli ARN di S3 non contengono né la regione né l'account (`arn:aws:s3:::real-estate-prod-files-<SUFFIX>`): se il bucket venisse cancellato, un altro account potrebbe ricrearlo con lo stesso nome e lo stesso ARN; `aws:SourceAccount` lega il permesso anche al nostro account, come raccomanda la documentazione di Lambda. Gli altri ARN contengono già `<ACCOUNT_ID>`, quindi `aws:SourceArn` basta. La policy completa è nel flusso 4.4."),
  p("Le due trust policy invece non hanno condizioni: il servizio Lambda o RDS assume il ruolo solo per la funzione o il proxy a cui il ruolo è stato **consegnato**, e consegnarlo richiede `iam:PassRole`, che più sotto limitiamo ai soli ruoli del progetto."),

  h3("Il privilegio minimo"),
  p("Ogni componente ha **solo i permessi che gli servono**, sugli ARN precisi e non su `*`. In pratica questo si traduce in quattro regole, che si ritrovano in tutti i flussi:"),
  punto("**Un execution role per Lambda**, non uno condiviso. Se la Offers fosse compromessa non potrebbe cancellare file né leggere la coda delle email; e in CloudTrail si vede quale funzione ha fatto cosa."),
  punto("**Un utente PostgreSQL per Lambda.** `rds-db:connect` è concesso per una sola coppia proxy/utente (`dbuser:<PROXY_RESOURCE_ID>/offers_user`): la Offers entra nel database solo come `offers_user`, e i `GRANT` di quell'utente limitano le tabelle (flusso 4.3)."),
  punto("**Policy gestite da AWS solo dove non si può fare meglio.** `AWSLambdaBasicExecutionRole` per i log e `AWSLambdaVPCAccessExecutionRole` per le interfacce di rete, le cui azioni `ec2:*NetworkInterface*` non si possono limitare a una risorsa. Tutto il resto (SNS, SQS, S3, SES, Cognito, `rds-db`) è in policy nostre: per la Mailer, per esempio, non usiamo `AWSLambdaSQSQueueExecutionRole`."),
  punto("**Condizioni che stringono ancora.** `ses:FromAddress` limita il mittente della Mailer, `s3:prefix` limita l'elenco della Property al prefisso `uploads/`, `kms:ViaService` limita l'uso di una eventuale chiave del cliente a Secrets Manager."),
  p("La tabella mostra cosa può fare ciascun ruolo oltre a log e interfacce di rete. Le caselle vuote sono la parte interessante: dicono cosa un ruolo **non** può fare."),
  tabella(
    ["Ruolo", "Database (`rds-db:connect`)", "`sns:Publish`", "S3 (bucket dei file)", "Altro"],
    [
      ["`lambda-property-role`", "`property_user`", "sì", "`ListBucket` su `uploads/`, `DeleteObject` su `uploads/*`", "—"],
      ["`lambda-users-role`", "`users_user`", "sì", "—", "—"],
      ["`lambda-offers-role`", "`offers_user`", "sì", "—", "—"],
      ["`lambda-presigned-role`", "`presigned_user`", "—", "`PutObject` su `uploads/*` (per firmare)", "—"],
      ["`lambda-files-role`", "`files_user`", "—", "`DeleteObject` su `uploads/*`", "—"],
      ["`lambda-mailer-role`", "—", "—", "—", "lettura della coda, `AdminGetUser` sul pool, `SendEmail` da `<MAIL_FROM>`"],
      ["`rds-proxy-secrets-role`", "— (verso Aurora usa la password)", "—", "—", "`GetSecretValue` sui soli secret applicativi"],
    ],
    [2000, 2000, 1100, 2500, 2000],
  ),
  dopoTabella(),
  p("Nessun ruolo ha `s3:GetObject`: i file li legge solo CloudFront. Nessuna Lambda ha `secretsmanager:GetSecretValue`: la password del database la vede solo il proxy. Nei nomi dei ruoli abbiamo omesso il prefisso `real-estate-prod-`; l'elenco completo, con trust e file, è nell'Appendice A."),

  h3("iam:PassRole e la policy di deploy"),
  p("Resta una domanda: chi decide che la Offers Lambda indossa proprio `real-estate-prod-lambda-offers-role`? Lo decide chi crea la funzione, cioè l'**identità di deploy** del team, e per farlo deve avere `iam:PassRole` su quel ruolo. Il permesso esiste per impedire una scorciatoia: un'identità con pochi permessi che crea una Lambda e le *consegna* un ruolo potente otterrebbe, tramite il codice della funzione, permessi che lei non ha. Con `PassRole` si può consegnare solo un ruolo che si è autorizzati a consegnare."),
  ...codice(leggiJson("iam/policies/deploy-pass-role.json"), "iam/policies/deploy-pass-role.json"),
  punto("`Resource` = `arn:aws:iam::<ACCOUNT_ID>:role/real-estate-prod-*`: si possono consegnare solo i ruoli del progetto."),
  punto("`iam:PassedToService` limitato a `lambda.amazonaws.com` e `rds.amazonaws.com`: i ruoli si consegnano solo alle Lambda e al proxy, non per esempio a un'istanza EC2 creata per l'occasione."),
  p("I ruoli applicativi non hanno nessun permesso di provisioning: nessuno di loro può creare ruoli, modificare policy o consegnare ruoli ad altri. È la separazione tra chi costruisce l'infrastruttura e chi la usa."),

  // ───────────────────────────── 3.2 ─────────────────────────────
  h2("3.2 La rete come secondo lucchetto"),
  p("IAM decide chi può fare cosa; la rete decide **chi può raggiungere chi**. Dentro la VPC valgono tutti e due: anche se un ruolo avesse permessi sbagliati, un pacchetto che nessun security group ammette non arriva. Fuori dalla VPC, invece, la rete non è nostra e resta solo IAM. Sapere da quale parte sta ogni servizio è quindi il primo passo per capire come è protetto."),
  ...figura(path.join(DIAGRAMMI, "rete.png"), 3238, 1704,
    "Figura 3.1 — La rete nel diagramma v3: la VPC con le due subnet private, i security group e gli endpoint. Gli elementi che non partecipano sono sbiaditi."),

  h3("Una VPC senza porte verso Internet"),
  tabella(
    ["Risorsa", "Valore"],
    [
      ["VPC", "`real-estate-prod-vpc`, `10.0.0.0/16`, `enableDnsSupport` ed `enableDnsHostnames` attivi (servono al Private DNS degli endpoint)"],
      ["`private_subnet_A`", "`10.0.1.0/24`, `eu-south-1a` (AZ-1)"],
      ["`private_subnet_B`", "`10.0.2.0/24`, `eu-south-1b` (AZ-2)"],
      ["Route table", "solo la rotta locale della VPC più la rotta verso il gateway endpoint S3 (prefix list di S3)"],
      ["Internet Gateway, NAT, subnet pubbliche", "nessuno"],
    ],
    [3000, 6600],
  ),
  dopoTabella(),
  p("Dentro la VPC c'è solo ciò che deve stare vicino al database: Aurora, l'RDS Proxy, le interfacce di rete (ENI) delle cinque Lambda di business e gli interface endpoint. Le due subnet sono **private**: nessuna delle due ha una rotta `0.0.0.0/0` verso un Internet Gateway. Il traffico degli utenti entra da CloudFront e da API Gateway, che stanno fuori dalla VPC, e il backend non chiama API esterne: un NAT sarebbe un costo fisso orario, per AZ, che non serve a nulla. È come una rete interna di Docker Compose in cui il container del database non pubblica la porta sull'host."),
  p("Le subnet sono due, in due zone di disponibilità, perché il *DB subnet group* di Aurora e l'RDS Proxy lo richiedono, e perché così il sistema sopravvive alla caduta di un data center. Le `/24` lasciano spazio: il proxy vuole almeno 10 indirizzi liberi per subnet, e altri ne usano le ENI delle Lambda e degli endpoint."),

  h3("La catena dei security group"),
  p("Un security group è un firewall **stateful** attaccato a una ENI, con sole regole *allow*: se una connessione è permessa, la risposta torna indietro da sola. La scelta importante è che le regole non usano indirizzi IP ma **altri security group** come sorgente: \"accetta 5432 da `sg-lambda-internal`\" resta vero anche quando le ENI delle Lambda cambiano indirizzo. È lo stesso principio per cui in Docker Compose si nomina un servizio e non il suo IP."),
  tabella(
    ["Security group", "Attaccato a", "In entrata", "In uscita"],
    [
      ["`sg-lambda-internal`", "ENI delle 5 Lambda di business", "nessuna regola", "5432 → `sg-rds-proxy`; 443 → `sg-endpoint-sns`; 443 → prefix list di S3 (gateway endpoint)"],
      ["`sg-rds-proxy`", "RDS Proxy", "5432 da `sg-lambda-internal`", "5432 → `sg-rds`; 443 → `sg-endpoint-secrets-manager`"],
      ["`sg-rds`", "istanze Aurora", "5432 da `sg-rds-proxy`", "nessuna regola"],
      ["`sg-endpoint-sns`", "interface endpoint SNS", "443 da `sg-lambda-internal`", "nessuna regola"],
      ["`sg-endpoint-secrets-manager`", "interface endpoint Secrets Manager", "443 da `sg-rds-proxy`", "nessuna regola"],
    ],
    [2400, 2200, 2200, 2800],
  ),
  dopoTabella(),
  p("Letta come una catena, la tabella dice tre cose. Le Lambda **non raggiungono Aurora direttamente**: `sg-rds` accetta solo il proxy, e il proxy accetta solo le Lambda. Nessuno entra nelle Lambda: `sg-lambda-internal` non ha regole in entrata, perché le Lambda non ricevono connessioni, vengono invocate dal servizio Lambda. E ogni endpoint accetta solo chi lo deve usare: quello di SNS le Lambda, quello di Secrets Manager il proxy."),
  tabella(
    ["Da", "A", "Porta", "Perché", "Flusso"],
    [
      ["`sg-lambda-internal`", "`sg-rds-proxy`", "5432", "le Lambda si collegano al proxy", "4.3"],
      ["`sg-rds-proxy`", "`sg-rds`", "5432", "il proxy si collega ad Aurora", "4.3"],
      ["`sg-lambda-internal`", "`sg-endpoint-sns`", "443", "Property, Users, Offers pubblicano su SNS", "4.5"],
      ["`sg-rds-proxy`", "`sg-endpoint-secrets-manager`", "443", "il proxy legge i secret, se l'endpoint serve", "4.3"],
      ["`sg-lambda-internal`", "prefix list S3 (`pl-...`)", "443", "Files e Property cancellano oggetti tramite il gateway endpoint, che non ha security group", "4.4"],
    ],
    [2200, 2400, 800, 3300, 900],
  ),
  dopoTabella(),

  h3("Endpoint: gateway e interface"),
  p("Senza Internet, le Lambda e il proxy raggiungono i servizi AWS solo attraverso gli **endpoint VPC**. Ne usiamo tre, di due tipi molto diversi:"),
  tabella(
    ["Endpoint", "Tipo", "Come funziona", "Usato da", "Controllo di rete"],
    [
      ["`com.amazonaws.eu-south-1.s3`", "**Gateway**", "una rotta nelle route table verso la prefix list di S3; gratuito; esiste solo per S3 e DynamoDB", "Files, Property (cancellazione dei file)", "nessun security group sull'endpoint; uscita 443 verso la prefix list in `sg-lambda-internal`"],
      ["`com.amazonaws.eu-south-1.sns`", "**Interface**", "una ENI con IP privato in ciascuna subnet (AWS PrivateLink), a pagamento per ora e per AZ", "Property, Users, Offers", "`sg-endpoint-sns`: 443 da `sg-lambda-internal`"],
      ["`com.amazonaws.eu-south-1.secretsmanager`", "**Interface**", "come sopra", "RDS Proxy, se ne ha bisogno", "`sg-endpoint-secrets-manager`: 443 da `sg-rds-proxy`"],
    ],
    [2500, 1200, 2700, 1600, 1600],
  ),
  dopoTabella(),
  p("Gli interface endpoint hanno il **Private DNS** attivo: il nome standard `sns.eu-south-1.amazonaws.com` si risolve sull'IP privato dell'endpoint, quindi l'SDK lo chiama come sempre e il codice non cambia. Il gateway S3 non ha una ENI: è una rotta, e per questo l'uscita verso di lui si apre verso la prefix list di S3 e non verso un security group."),
  p("Ogni endpoint può avere una **endpoint policy**, che si somma ai controlli IAM come filtro. Di default permette tutto. Sull'endpoint SNS ne abbiamo scritta una che lascia passare solo `sns:Publish` sul nostro topic e solo da identità del nostro account (`aws:PrincipalAccount`): anche una Lambda compromessa non potrebbe usare l'endpoint per inviare dati verso un topic di un altro account. Il testo è nel flusso 4.5; l'endpoint di Secrets Manager e il gateway S3 usano la policy di default."),
  p("Resta un punto aperto: se il proxy abbia davvero bisogno dell'endpoint di Secrets Manager. Lo discutiamo nel flusso 4.3."),

  h3("Chi sta fuori dalla VPC, e perché"),
  p("La maggior parte dei servizi del progetto non ha ENI nella nostra VPC e quindi **non può avere security group**: si protegge solo con IAM. Non è un buco: è il modello dei servizi gestiti, raggiunti sui loro endpoint regionali pubblici con richieste firmate e cifrate."),
  tabella(
    ["Dove", "Servizi", "Come si proteggono"],
    [
      ["Globale", "CloudFront, IAM", "IAM; CloudFront legge S3 con OAC e bucket policy"],
      ["Regionale, fuori dalla VPC", "S3, API Gateway, Cognito, SNS, SQS, SES, CloudWatch, Secrets Manager, la Mailer Lambda", "identity policy e resource policy; niente security group"],
      ["Dentro la VPC", "Aurora, RDS Proxy, le ENI delle 5 Lambda di business, gli interface endpoint", "security group **e** IAM"],
    ],
    [2000, 4400, 3200],
  ),
  dopoTabella(),
  p("Sta fuori anche una Lambda, la **Mailer**: non usa il database, quindi non ha motivo di stare nella VPC. Fuori raggiunge SQS, Cognito e SES sulla rete di AWS senza bisogno di endpoint, con meno cold start e meno costi. Le cinque Lambda di business invece devono stare dentro perché il proxy è raggiungibile solo dalla VPC. Per lo stesso motivo **non ci sono endpoint** per Cognito, SQS e SES (li usa solo la Mailer), né per CloudWatch Logs e per le credenziali dei ruoli, che il servizio Lambda gestisce senza passare dalla rete della funzione. La Presigned non ha bisogno di S3: firma il presigned POST in locale."),

  // ───────────────────────────── 3.3 ─────────────────────────────
  h2("3.3 La mappa delle autorizzazioni"),
  p("Questa tabella mette in fila **tutti** i passaggi del sistema. Per ognuno dice su quale rete viaggia e quale meccanismo lo autorizza, con il file in cui sta il permesso e il flusso del capitolo 4 che lo spiega. È il modo più rapido per controllare che ogni freccia del diagramma abbia il suo controllo, e che dove ne manca uno ci sia un motivo."),
  tabella(
    ["#", "Da → A", "Rete", "Meccanismo di autorizzazione", "File"],
    [
      // 4.1
      ["1", "Browser → CloudFront del sito (4.1)", "Internet, HTTPS (redirect da HTTP)", "contenuto pubblico: nessuna autenticazione", "—"],
      ["2", "CloudFront del sito → bucket del sito (4.1)", "rete AWS, richiesta firmata con OAC", "bucket policy: `cloudfront.amazonaws.com` con `AWS:SourceArn` = distribuzione; Deny senza TLS", "`s3-website-bucket-policy.json`"],
      // 4.2
      ["3", "Browser → Cognito: registrazione e login (4.2)", "Internet, HTTPS", "credenziali dell'utente; app client pubblico con authorization code e PKCE. Nessun IAM", "`config/cognito-app-client.json`"],
      ["4", "Browser → HTTP API (4.2)", "Internet, HTTPS", "CORS (solo l'origine del sito); authorizer JWT: firma, issuer, `client_id`, scadenza dell'access token", "`config/http-api-cors.json`"],
      ["5", "Authorizer → chiavi pubbliche del pool (4.2)", "interno ad AWS", "nessuno: il JWKS è pubblico, l'authorizer non agisce nell'account", "—"],
      ["6", "HTTP API → 5 Lambda di business (4.2)", "rete AWS, invocazione sincrona", "resource policy della funzione: `apigateway.amazonaws.com` con `AWS:SourceArn` = la nostra API", "`lambda-allow-api-gateway.json`"],
      ["7", "Servizio Lambda → execution role (4.2)", "interno ad AWS (STS)", "trust policy: `lambda.amazonaws.com` può fare `sts:AssumeRole`", "`trust-relationships/lambda.json`"],
      ["8", "Lambda → logica applicativa (4.2)", "dentro la funzione", "gruppo da `cognito:groups`, `token_use` = `access`, ownership con una query: non è IAM", "—"],
      // 4.3
      ["9", "5 Lambda → RDS Proxy (4.3)", "VPC, TCP 5432 con TLS; `sg-lambda-internal` → `sg-rds-proxy`", "token IAM come password: `rds-db:connect` per il proprio utente PostgreSQL nel ruolo", "`lambda-<scope>.json` (template `lambda-connect-proxy.json`)"],
      ["10", "Servizio RDS → ruolo del proxy (4.3)", "interno ad AWS (STS)", "trust policy: `rds.amazonaws.com` può fare `sts:AssumeRole`", "`trust-relationships/rds-proxy.json`"],
      ["11", "RDS Proxy → Secrets Manager (4.3)", "VPC → interface endpoint (se serve); `sg-rds-proxy` → `sg-endpoint-secrets-manager` su 443", "`secretsmanager:GetSecretValue` sui soli secret applicativi nel ruolo del proxy; nessuna policy sul secret", "`rds-proxy-read-secrets.json`"],
      ["12", "Secrets Manager → KMS (4.3)", "interno ad AWS", "key policy della chiave gestita `aws/secretsmanager`; con una CMK anche `kms:Decrypt` con `kms:ViaService` e una key policy", "`rds-proxy-decrypt-secrets.json` (solo con CMK)"],
      ["13", "RDS Proxy → Aurora (4.3)", "VPC, TCP 5432 con TLS; `sg-rds-proxy` → `sg-rds`", "password PostgreSQL letta dal secret; poi i `GRANT` dell'utente", "—"],
      ["14", "RDS → risorse di rete di Aurora (4.3)", "interno ad AWS", "service-linked role `AWSServiceRoleForRDS`, gestito da AWS", "—"],
      // 4.4
      ["15", "Presigned Lambda → firma del POST (4.4)", "nessuna rete: firma locale", "il POST vale con i permessi del ruolo: `s3:PutObject` su `uploads/*`; conditions su chiave, tipo, dimensione, scadenza 5 minuti", "`lambda-presigned.json`, `config/presigned-post-conditions.json`"],
      ["16", "Browser → bucket dei file, upload (4.4)", "Internet, HTTPS", "firma del presigned POST; CORS del bucket per l'origine del sito; Deny senza TLS", "`config/s3-files-cors.json`, `s3-files-bucket-policy.json`"],
      ["17", "S3 → Files Lambda, notifica `ObjectCreated` (4.4)", "rete AWS, invocazione asincrona", "resource policy della funzione: `s3.amazonaws.com` con `AWS:SourceArn` = bucket e `AWS:SourceAccount`", "`lambda-files-allow-s3.json`, `config/s3-files-notification.json`"],
      ["18", "Browser → CloudFront dei file → bucket (4.4)", "Internet, HTTPS; poi rete AWS con OAC", "file pubblici per chi ha il link; bucket policy: solo la distribuzione dei file, solo `uploads/*`", "`s3-files-bucket-policy.json`"],
      ["19", "Files Lambda → S3, cancellazione (4.4)", "VPC → gateway endpoint S3; 443 verso la prefix list", "`s3:DeleteObject` su `uploads/*` nel ruolo", "`lambda-files.json`"],
      ["20", "Property Lambda → S3, file di un immobile cancellato (4.4)", "VPC → gateway endpoint S3; 443 verso la prefix list", "`s3:ListBucket` con `s3:prefix` = `uploads/*`, `s3:DeleteObject` su `uploads/*` nel ruolo", "`lambda-property.json`"],
      // 4.5
      ["21", "Property, Users, Offers → SNS (4.5)", "VPC → interface endpoint; `sg-lambda-internal` → `sg-endpoint-sns` su 443", "`sns:Publish` sul topic nel ruolo; endpoint policy (facoltativa); topic con la policy di default", "`lambda-property.json`, `lambda-users.json`, `lambda-offers.json`, `vpc-endpoint-sns-policy.json`"],
      ["22", "SNS → coda SQS (4.5)", "rete AWS", "queue policy: `sns.amazonaws.com` con `aws:SourceArn` = il nostro topic", "`sqs-notifications-queue-policy.json`"],
      ["23", "Coda → Mailer Lambda (4.5)", "rete AWS (la Mailer è fuori dalla VPC)", "event source mapping con il ruolo della Mailer: `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`", "`lambda-mailer.json`, `config/lambda-mailer-event-source-mapping.json`"],
      ["24", "Mailer → Cognito, `AdminGetUser` (4.5)", "endpoint pubblico regionale", "`cognito-idp:AdminGetUser` sul solo user pool, nel ruolo", "`lambda-mailer.json`"],
      ["25", "Mailer → SES, `SendEmail` (4.5)", "endpoint pubblico regionale", "`ses:SendEmail` con `ses:FromAddress` = `<MAIL_FROM>`, nel ruolo", "`lambda-mailer.json`"],
      ["26", "Coda → DLQ (4.5)", "interno a SQS", "nessun permesso IAM: `RedrivePolicy` sulla coda, `RedriveAllowPolicy` sulla DLQ", "`config/sqs-notifications-queue-attributes.json`, `config/sqs-notifications-dlq-attributes.json`"],
      ["27", "Operatore → DLQ → coda, redrive (4.5)", "console o CLI", "policy dell'operatore: DLQ, `sqs:SendMessage` sulla sola coda principale, log della Mailer", "`ops-dlq-redrive.json`"],
      // 4.6
      ["28", "Browser → Cognito: cambio email o password, `DeleteUser` (4.6)", "Internet, HTTPS", "access token dell'utente con lo scope `aws.cognito.signin.user.admin`. Nessun IAM", "`config/cognito-app-client.json`"],
      ["29", "SPA → `DELETE /users/me` e `PUT /users/me` (4.6)", "come le righe 4 e 6", "authorizer JWT; la Users Lambda usa il `sub` dei claim", "come le righe 4 e 6"],
      // 4.7
      ["30", "Lambda → CloudWatch Logs (4.7)", "gestito dal servizio Lambda, non dalla rete della funzione", "`AWSLambdaBasicExecutionRole` nel ruolo", "—"],
      ["31", "Servizio Lambda → ENI nelle subnet (3.2)", "interno ad AWS", "`AWSLambdaVPCAccessExecutionRole` nel ruolo delle 5 Lambda in VPC", "—"],
      ["32", "HTTP API → CloudWatch Logs (4.7)", "interno ad AWS", "basta il log group nello stage: il ruolo CloudWatch dell'account serve solo alle REST API", "—"],
      ["33", "Allarme → topic `real-estate-prod-ops-alerts` → team (4.7)", "interno ad AWS, poi email", "stesso account e nessuna chiave del cliente: nessuna topic policy", "`config/cloudwatch-alarm-notifications-dlq.json`"],
      // deploy
      ["34", "Identità di deploy → ruoli dei servizi", "console, CLI o strumenti di provisioning", "`iam:PassRole` sui soli ruoli `real-estate-prod-*`, verso Lambda e RDS", "`deploy-pass-role.json`"],
    ],
    [400, 2400, 2200, 3000, 1800],
  ),
  dopoTabella(),
  p("I file senza cartella sono in `iam/policies/` o `iam/resource-policies/`, quelli con `config/` sono configurazioni non IAM. Il testo di ogni policy è nell'Appendice A."),

  h3("Dove manca un controllo, e perché"),
  p("Guardando le colonne si vedono tre gruppi di frecce, e ciascuno ha la sua spiegazione."),
  punto("**Rete e IAM insieme** (righe 9, 11, 19, 20, 21): sono le frecce che partono dalla VPC. Un security group (o la rotta del gateway S3) lascia passare il pacchetto, e un permesso del ruolo autorizza l'operazione. Sono le più protette perché toccano il database o escono dalla VPC."),
  punto("**Solo IAM** (righe 2, 6, 17, 22-25, 33): servizi gestiti fuori dalla VPC, che non hanno ENI nostre. Qui il permesso sta nel ruolo di chi chiama oppure, quando chi chiama è un servizio AWS, nella resource policy con `aws:SourceArn`."),
  punto("**Né IAM né rete nostra** (righe 1, 3, 4, 16, 28): sono le richieste del browser. L'utente finale non è un'identità IAM: lo autorizzano Cognito, l'authorizer JWT, la firma del presigned POST e, dentro la Lambda, il gruppo e l'ownership. La riga 13 è simile: tra proxy e Aurora vale l'autenticazione di PostgreSQL, non IAM, ma la rete è la più chiusa del progetto."),
  p("Restano i passaggi interni ai servizi (righe 5, 26, 30-32), che non hanno bisogno di permessi scritti da noi: lo spostamento nella DLQ lo esegue SQS secondo la configurazione della coda, i log li invia il servizio Lambda con i permessi del ruolo, l'authorizer legge chiavi pubbliche."),

  ...riquadro("All'orale, in breve", [
    "**Differenza tra identity policy, resource policy e trust policy?** La prima dice cosa può fare un'identità, la seconda chi può usare una risorsa, la terza chi può assumere un ruolo. L'execution role di una Lambda ha una trust verso `lambda.amazonaws.com` e le identity policy; chi può invocare la funzione sta nella sua resource policy.",
    "**Nello stesso account basta un lato: perché allora scrivete le resource policy?** Perché in quelle frecce chi chiama è un servizio AWS (API Gateway, S3, CloudFront, SNS), che nel nostro account non ha identity policy: l'unico posto per il suo Allow è la risorsa. E per KMS e per le trust la resource policy serve sempre.",
    "**Cos'è il confused deputy?** Un servizio AWS usato da un altro account per arrivare alle nostre risorse. Lo chiudiamo con `aws:SourceArn` in ogni resource policy verso un servizio, più `aws:SourceAccount` per S3, i cui ARN non contengono l'account.",
    "**Si può mettere un security group su S3 o SQS?** No: non hanno ENI nella nostra VPC. Si proteggono con IAM. Dentro la VPC invece valgono tutti e due i controlli, e le Lambda non raggiungono Aurora direttamente.",
    "**A cosa serve `iam:PassRole`?** A impedire che chi crea una risorsa le consegni un ruolo più potente di sé. Ce l'ha solo l'identità di deploy, sui ruoli `real-estate-prod-*` e verso Lambda e RDS.",
  ]),
  ];
};
