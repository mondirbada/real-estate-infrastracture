// 4. Sicurezza e IAM — viene dopo i flussi: raccoglie e mette in ordine ciò che il capitolo 3 ha mostrato.
// 4.1 le tre facce di IAM, 4.2 la rete come secondo livello, 4.3 la mappa delle autorizzazioni.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h1, h2, h3, punto, codice, tabella, dopoTabella, figura } = S;
  const gruppo = t => [`**${t}**`, "", ""];

  return [
  h1("4. Sicurezza e IAM"),
  p("Nei flussi ogni freccia è una richiesta, e ogni richiesta è stata permessa **due volte**: dalla rete, che decide se i pacchetti arrivano, e da IAM, che decide se chi chiama può fare quell'operazione su quella risorsa. Qui mettiamo in ordine le regole che il capitolo 3 ha applicato caso per caso. Gli utenti finali (`buyer`, `agent`, `admin`) non sono identità IAM: li autenticano Cognito e l'authorizer JWT, e la Lambda controlla gruppo e ownership (3.2). Qui parliamo dei servizi."),

  // ───────────────────────────── 4.1 ─────────────────────────────
  h2("4.1 Le tre facce di IAM"),
  p("IAM risponde a una domanda: **chi** può fare **quale azione** su **quale risorsa**, a **quali condizioni**. Di default la risposta è no. Nessun componente ha credenziali proprie: le Lambda e l'RDS Proxy usano **ruoli**, identità senza password che il servizio assume ricevendo da STS credenziali temporanee. Nel codice e nel repository non c'è nessuna chiave."),
  p("Ogni permesso del progetto sta in uno di tre documenti, con la stessa grammatica (`Effect`, `Action`, `Resource`, `Condition`) ma attaccati a cose diverse:"),
  punto("**Identity policy**, su un ruolo: *cosa può fare* chi lo indossa. Esempio: `lambda-offers.json` concede `rds-db:connect` come `offers_user` e `sns:Publish` sul topic."),
  punto("**Resource policy**, su una risorsa (funzione, bucket, coda, endpoint): *chi può usarla*. Esempio: la queue policy ammette `sns.amazonaws.com` dal nostro topic."),
  punto("**Trust relationship**, su un ruolo: *chi può assumerlo*. È la resource policy del ruolo."),
  p("L'**execution role** di una Lambda le mette insieme. La trust, uguale per i sei ruoli delle Lambda, permette al servizio Lambda di assumerlo; le identity policy dicono cosa fa il codice; chi può invocare la funzione sta invece nella resource policy della funzione. Il ruolo del proxy ha la stessa struttura con `rds.amazonaws.com` (3.3)."),
  ...codice(leggiJson("iam/trust-relationships/lambda.json"), "iam/trust-relationships/lambda.json"),

  h3("Come si valuta una richiesta"),
  p("AWS raccoglie tutte le policy che riguardano la richiesta e decide così: un `Deny` esplicito vince su tutto; altrimenti serve almeno un `Allow`; altrimenti è no. **Nello stesso account** basta che l'`Allow` stia nella identity policy **oppure** nella resource policy. Fanno eccezione le trust e le key policy di KMS, che devono ammettere il principal comunque. Il `Deny` esplicito del progetto è nelle due bucket policy, che rifiutano ogni richiesta senza TLS, anche dai nostri ruoli."),
  p("Per questo molte frecce hanno solo la identity policy: la Files Lambda cancella oggetti, la Mailer legge la coda, il proxy legge i secret, e nessuna di queste risorse nomina il ruolo. Quando invece chi chiama è **un servizio AWS** (API Gateway, S3, CloudFront, SNS), il suo principal non ha identity policy nel nostro account: l'unico posto per il suo `Allow` è la resource policy della risorsa che chiama. È il caso delle cinque Lambda di business, della Files Lambda, dei due bucket e della coda."),
  p("Per la stessa eccezione la coda è cifrata con SSE-SQS e non con `aws/sqs`: la key policy di quella chiave non ammette `sns.amazonaws.com` e non si può modificare (Appendice B). L'**endpoint policy** infine non concede nulla: filtra. Una richiesta che passa dall'endpoint SNS deve essere permessa dall'endpoint **e** dal ruolo."),

  h3("Confused deputy"),
  p("Ammettere `sns.amazonaws.com` vuol dire ammettere il servizio intero, cioè i topic di tutti i clienti AWS: un altro account potrebbe usare SNS come intermediario per scrivere nella nostra coda. È il **confused deputy**. Ogni nostra resource policy verso un servizio ha quindi `aws:SourceArn`, che il servizio valorizza con la risorsa per cui agisce: la nostra API, il nostro bucket, la nostra distribuzione, il nostro topic. Solo verso S3 aggiungiamo `aws:SourceAccount`, perché gli ARN di S3 non contengono l'account e un bucket cancellato potrebbe essere ricreato da altri con lo stesso nome (la policy della Files Lambda è in 3.4)."),

  h3("Privilegio minimo e iam:PassRole"),
  punto("**Un ruolo per Lambda**: se la Offers fosse compromessa non potrebbe cancellare file né leggere la coda, e CloudTrail dice quale funzione ha fatto cosa."),
  punto("**Un utente PostgreSQL per Lambda**: `rds-db:connect` vale per una sola coppia proxy/utente, poi i `GRANT` limitano le tabelle (3.3)."),
  punto("**Policy gestite da AWS solo per log e interfacce di rete**; tutto il resto in policy nostre, su ARN precisi."),
  punto("**Condizioni che stringono**: `ses:FromAddress` per il mittente, `s3:prefix` per l'elenco della Property, `kms:ViaService` per un'eventuale chiave del cliente."),
  p("Nessun ruolo ha `s3:GetObject` (i file li legge solo CloudFront) e nessuna Lambda ha `secretsmanager:GetSecretValue` (la password la vede solo il proxy)."),
  p("Chi decide quale ruolo indossa una funzione è chi la crea, e per farlo serve `iam:PassRole` su quel ruolo. Senza questo controllo un'identità con pochi permessi potrebbe creare una Lambda, consegnarle un ruolo potente e ottenerne i permessi tramite il codice. La nostra identità di deploy può consegnare solo i ruoli `real-estate-prod-*` e solo a Lambda e RDS (`deploy-pass-role.json`); i ruoli applicativi non hanno permessi di provisioning. Ruoli e policy completi sono nell'Appendice A."),

  // ───────────────────────────── 4.2 ─────────────────────────────
  h2("4.2 La rete come secondo livello"),
  p("IAM decide chi può fare cosa; la rete decide **chi può raggiungere chi**. Dentro la VPC valgono tutti e due; fuori la rete non è nostra e resta solo IAM."),
  ...figura(path.join(DIAGRAMMI, "rete.png"), 3238, 1704,
    "Figura 4.1 — La VPC con le due subnet private, i security group e gli endpoint."),
  p("`real-estate-prod-vpc` non ha Internet Gateway né NAT: le due subnet private, `10.0.1.0/24` in `eu-south-1a` e `10.0.2.0/24` in `eu-south-1b`, hanno solo la rotta locale e quella verso il gateway S3. Dentro ci sono solo Aurora, l'RDS Proxy, le interfacce di rete delle cinque Lambda di business e gli interface endpoint; perché niente NAT e perché due zone lo spiega il 2.3."),
  p("I security group usano come sorgente **altri security group**, non indirizzi IP, e formano una catena:"),
  tabella(
    ["Security group", "In entrata", "In uscita"],
    [
      ["`sg-lambda-internal` (5 Lambda)", "nessuna", "5432 → proxy; 443 → endpoint SNS; 443 → prefix list S3"],
      ["`sg-rds-proxy`", "5432 da Lambda", "5432 → Aurora; 443 → endpoint Secrets Manager"],
      ["`sg-rds` (Aurora)", "5432 dal proxy", "nessuna"],
      ["`sg-endpoint-sns`", "443 da Lambda", "nessuna"],
      ["`sg-endpoint-secrets-manager`", "443 dal proxy", "nessuna"],
    ],
    [3200, 2400, 4000],
  ),
  dopoTabella(),
  p("Le Lambda non raggiungono Aurora direttamente, nessuno entra nelle Lambda, e ogni endpoint accetta solo chi lo usa."),
  p("Senza Internet i servizi AWS si raggiungono dagli **endpoint VPC**, di due tipi. Il **gateway** di S3 è una rotta verso la prefix list, gratuita e senza security group. Gli **interface** di SNS e Secrets Manager sono interfacce di rete con IP privato in ogni subnet, a pagamento, con Private DNS: l'SDK usa il nome di sempre. L'endpoint SNS ha un'**endpoint policy** che lascia passare solo `sns:Publish` sul nostro topic da identità del nostro account; gli altri usano quella di default. Tutto il resto, Mailer compresa, sta fuori dalla VPC e si protegge solo con IAM."),

  // ───────────────────────────── 4.3 ─────────────────────────────
  h2("4.3 La mappa delle autorizzazioni"),
  p("Tutti i passaggi del sistema, per flusso: su quale rete viaggiano e che cosa li autorizza. Il dettaglio è nel capitolo 3, il testo delle policy nell'Appendice A."),
  tabella(
    ["Da → A", "Rete", "Autorizzato da"],
    [
      gruppo("3.1 Scaricare l'applicazione"),
      ["Browser → CloudFront del sito", "Internet, HTTPS", "nessuno: contenuto pubblico"],
      ["CloudFront → bucket del sito", "AWS, firma OAC", "bucket policy con `aws:SourceArn`; Deny senza TLS"],
      gruppo("3.2 Login e chiamate all'API"),
      ["Browser → Cognito", "Internet, HTTPS", "credenziali dell'utente, code con PKCE"],
      ["Browser → HTTP API", "Internet, HTTPS", "CORS; authorizer JWT"],
      ["HTTP API → 5 Lambda", "AWS", "resource policy della funzione con `aws:SourceArn`"],
      ["Servizio Lambda → execution role", "STS", "trust relationship"],
      gruppo("3.3 Dalla Lambda al database"),
      ["5 Lambda → RDS Proxy", "VPC, 5432 TLS", "`rds-db:connect` nel ruolo"],
      ["Servizio RDS → ruolo del proxy", "STS", "trust relationship"],
      ["Proxy → Secrets Manager", "VPC, endpoint 443", "`GetSecretValue` nel ruolo del proxy"],
      ["Proxy → Aurora", "VPC, 5432 TLS", "password PostgreSQL, poi `GRANT`"],
      gruppo("3.4 Caricare e servire i file"),
      ["Browser → bucket, upload", "Internet, HTTPS", "presigned POST firmato col ruolo della Presigned; CORS"],
      ["S3 → Files Lambda", "AWS", "resource policy con `aws:SourceArn` e `aws:SourceAccount`"],
      ["Browser → CloudFront → bucket", "Internet; AWS con OAC", "bucket policy, solo `uploads/*`"],
      ["Files, Property → S3, cancellazione", "VPC, gateway S3", "`DeleteObject` nel ruolo"],
      gruppo("3.5 Notifiche e DLQ"),
      ["Property, Users, Offers → SNS", "VPC, endpoint 443", "`sns:Publish` nel ruolo; endpoint policy"],
      ["SNS → coda", "AWS", "queue policy con `aws:SourceArn`"],
      ["Coda → Mailer", "AWS", "lettura della coda nel ruolo della Mailer"],
      ["Mailer → Cognito, SES", "endpoint regionali", "`AdminGetUser`, `SendEmail` nel ruolo"],
      ["Coda → DLQ; redrive", "SQS; console", "`RedrivePolicy`; policy dell'operatore"],
      gruppo("3.6 Gestione dell'account"),
      ["Browser → Cognito", "Internet, HTTPS", "access token dell'utente"],
      ["SPA → `/users/me`", "come 3.2", "authorizer JWT, `sub` dei claim"],
      gruppo("3.7 Log, metriche e allarmi"),
      ["Lambda → CloudWatch Logs", "servizio Lambda", "`AWSLambdaBasicExecutionRole`"],
      ["Allarme → topic degli allarmi", "AWS, poi email", "stesso account: nessuna topic policy"],
    ],
    [3600, 2300, 3700],
  ),
  dopoTabella(),
  p("Ne escono tre gruppi: le frecce che partono dalla VPC hanno **rete e IAM**; quelle tra servizi gestiti **solo IAM**; quelle del browser non passano da IAM, e le autorizzano Cognito, l'authorizer JWT, la firma del presigned POST e la Lambda."),
  ];
};
