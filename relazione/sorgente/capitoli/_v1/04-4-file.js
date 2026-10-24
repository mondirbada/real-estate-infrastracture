// 4.4 Caricare e servire i file — upload con presigned POST, registrazione con la notifica S3, lettura con CloudFront, cancellazione.
const path = require("path");
const { Paragraph, AlignmentType } = require("docx");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;
  // Paragrafo che introduce un blocco di codice: meno spazio sotto, come nel capitolo modello.
  const intro = t => new Paragraph({ children: S.runs(t), spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED });

  return [
  h2("4.4 Caricare e servire i file"),
  p("Un agente pubblica un immobile con foto e video. I file finiscono nel bucket privato `real-estate-prod-files-<SUFFIX>`, sotto il prefisso `uploads/`, e da lì li legge chiunque guardi l'annuncio, attraverso la distribuzione CloudFront dei file. Il punto centrale del flusso è che **il file non passa mai dal nostro backend**: la Presigned Lambda non riceve i byte, li autorizza. Firma un *presigned POST*, cioè un modulo di upload firmato, e il browser lo usa per caricare il file direttamente su S3."),
  p("Il motivo è prima di tutto un limite: API Gateway accetta al massimo 10 MB per richiesta e una Lambda invocata in modo sincrono 6 MB. Un video non ci starebbe, e anche una foto grande sarebbe al limite. In più, far passare il file dalla Lambda vorrebbe dire pagare il tempo di trasferimento come tempo di esecuzione. In Spring Boot è la differenza tra un endpoint che riceve un `MultipartFile` e lo inoltra allo storage, e un endpoint che restituisce al client un permesso firmato per caricarlo da solo."),
  p("Il flusso ha tre parti, che usano meccanismi di autorizzazione diversi. L'**upload**: una firma IAM consegnata al browser, CORS e una notifica S3 che invoca la Files Lambda. La **lettura**: CloudFront con Origin Access Control e la bucket policy. La **cancellazione**: le Lambda che chiamano S3 dalla VPC attraverso il gateway endpoint."),
  ...figura(path.join(DIAGRAMMI, "file.png"), 2116, 2275,
    "Figura 4.4 — Upload, registrazione, lettura e cancellazione dei file nel diagramma v3 (frecce 4 e 5 del percorso dell'utente). Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  ...elencoNumerato([
    "La SPA chiama `POST /properties/{id}/uploads` con l'access token, indicando tipo e dimensione del file. L'authorizer JWT valida il token e API Gateway invoca la **Presigned Lambda**.",
    "La Presigned controlla nel database, attraverso il proxy come `presigned_user`, che il `sub` del token sia il **proprietario** dell'immobile.",
    "La Presigned **firma in locale** un presigned POST con le credenziali del proprio ruolo: chiave `uploads/<propertyId>/<uuid>.<ext>` decisa da lei, scadenza 5 minuti, tipo `image/` o `video/`, dimensione massima. Restituisce URL e campi del modulo.",
    "Il browser invia il file **direttamente al bucket** con un `POST`. Il browser lo permette grazie alla regola **CORS** del bucket; S3 lo accetta perché la firma è valida e le condizioni sono rispettate.",
    "A upload completato S3 emette una notifica `ObjectCreated` sul prefisso `uploads/` e **invoca in modo asincrono la Files Lambda**, che registra il file nel database (chiave, immobile, dimensione).",
    "Per mostrare l'annuncio, la SPA chiede `GET /properties/{id}/files` (pubblica) e scarica i file dalla **distribuzione CloudFront dei file**, che li legge dal bucket con **OAC**.",
    "Per cancellare un file, `DELETE /files/{id}`: la Files Lambda controlla l'ownership, toglie la riga e cancella l'oggetto passando dal **gateway endpoint S3**. Cancellando un immobile, la Property Lambda svuota tutto il prefisso `uploads/<propertyId>/`.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "SPA → HTTP API → Presigned Lambda", "`POST /properties/{id}/uploads`, invocazione sincrona", "Internet → API Gateway (fuori dalla VPC)", "authorizer JWT; resource policy `lambda-allow-api-gateway.json` sulla funzione"],
      ["2", "Presigned → RDS Proxy", "PostgreSQL 5432, TLS, token IAM", "`sg-lambda-internal` → `sg-rds-proxy`", "`rds-db:connect` come `presigned_user`; poi l'ownership nella query"],
      ["3", "Presigned → (S3)", "firma SigV4 locale del presigned POST", "nessuna: non c'è chiamata di rete", "`s3:PutObject` su `uploads/*` nel ruolo della Presigned, valutato da S3 al passo 4"],
      ["4", "Browser → bucket dei file", "`POST` del modulo firmato, HTTPS", "Internet → endpoint pubblico regionale di S3", "firma del ruolo della Presigned + conditions del POST; CORS `s3-files-cors.json` per il browser"],
      ["5", "S3 → Files Lambda", "notifica `ObjectCreated` su `uploads/`, invocazione asincrona", "interna ad AWS: la fa il servizio Lambda, non la rete della VPC", "resource policy `lambda-files-allow-s3.json` (`AWS:SourceArn` + `AWS:SourceAccount`)"],
      ["6", "Files → RDS Proxy", "registrazione della riga", "`sg-lambda-internal` → `sg-rds-proxy`", "`rds-db:connect` come `files_user`"],
      ["7", "Browser → CloudFront dei file", "HTTPS (HTTP reindirizzato)", "Internet → edge", "pubblica: chi ha il link"],
      ["8", "CloudFront → bucket dei file", "`s3:GetObject` firmato con OAC", "rete di AWS", "bucket policy `s3-files-bucket-policy.json` (`AWS:SourceArn` = la distribuzione)"],
      ["9", "Files / Property → bucket dei file", "`DeleteObject`; la Property anche `ListObjectsV2` e `DeleteObjects`", "gateway endpoint S3: rotta nelle route table, 443 verso la prefix list di S3", "ruolo della Files (`s3:DeleteObject`) o della Property (`s3:ListBucket` + `s3:DeleteObject`)"],
    ],
    [400, 2100, 2300, 2500, 2700],
  ),
  dopoTabella(),

  h3("Upload: chi firma cosa"),
  p("Il presigned POST è il cuore del flusso, ed è anche il punto in cui IAM lavora in un modo meno ovvio. L'utente Cognito non ha permessi IAM e il browser non ha credenziali AWS. Chi ha il permesso di scrivere nel bucket è il **ruolo della Presigned Lambda**; la Lambda usa le credenziali temporanee di quel ruolo per **firmare** un documento (la *policy* del POST, con le sue condizioni) e consegna la firma al browser. Quando il browser fa il `POST`, S3 verifica la firma e tratta la richiesta **come se arrivasse dal ruolo che ha firmato**."),
  intro("Da qui discende tutto. Il ruolo della Presigned ha questa policy:"),
  ...codice(leggiJson("iam/policies/lambda-presigned.json"), "iam/policies/lambda-presigned.json"),
  punto("**Un presigned POST ha al massimo i permessi di chi lo firma.** Il ruolo può fare `s3:PutObject` solo su `uploads/*` del bucket dei file: nessun modulo generato dalla Lambda può scrivere altrove, né in un altro bucket né fuori dal prefisso."),
  punto("**Il permesso si controlla al momento dell'upload, non della firma.** Firmare non chiama S3 e non verifica nulla: è un calcolo locale. Se il ruolo non avesse `s3:PutObject`, la Lambda firmerebbe senza errori e il browser riceverebbe `AccessDenied` caricando il file. Allo stesso modo, togliendo il permesso dal ruolo smettono di funzionare anche i moduli già firmati e non ancora usati."),
  punto("**La firma usa credenziali temporanee.** Il modulo contiene anche il token di sessione del ruolo, e smette di valere quando scadono quelle credenziali, se succede prima dei 5 minuti. Con le durate delle credenziali di Lambda non è un problema pratico, ma spiega perché non si firmano moduli a lunga scadenza."),
  punto("**IAM non limita tipo e dimensione.** Con `s3:PutObject` il ruolo potrebbe scrivere qualunque file sotto `uploads/`. A restringere il singolo upload sono le **conditions** del POST, che la Lambda inserisce nella firma e che il browser non può cambiare senza invalidarla."),
  punto("**Non serve nulla nella bucket policy.** Siamo nello stesso account, e basta l'identity policy del ruolo che firma. E il Block Public Access attivo sul bucket non blocca l'upload: la richiesta è firmata da un ruolo IAM, non è un accesso pubblico."),

  intro("**Le conditions.** La Presigned le costruisce per ogni richiesta; questo è l'esempio leggibile per un'immagine (nel codice le stesse condizioni si passano all'SDK, per esempio `createPresignedPost` in JavaScript):"),
  ...codice(leggiJson("config/presigned-post-conditions.json"), "config/presigned-post-conditions.json"),
  punto("`[\"eq\", \"$key\", ...]`: la **chiave la decide la Lambda**, `uploads/<propertyId>/<uuid>.<ext>`. Il prefisso è per immobile perché il controllo di ownership è sull'immobile; l'UUID evita collisioni e nomi scelti dal client. Che tutti i file di un immobile stiano sotto lo stesso prefisso servirà anche per cancellarli."),
  punto("`[\"starts-with\", \"$Content-Type\", \"image/\"]`: solo immagini con questa firma. Un presigned POST ammette un solo prefisso di `Content-Type`, quindi la Lambda sceglie le condizioni in base al tipo dichiarato: `image/` con 10 MB, `video/` con un limite più alto."),
  punto("`[\"content-length-range\", 1, 10485760]`: da 1 byte a 10 MB. È il motivo per cui usiamo il **POST** e non il presigned **PUT**: il PUT non permette di limitare la dimensione."),
  punto("`expiresInSeconds: 300`: il modulo vale 5 minuti."),
  p("Prima di firmare, la Presigned verifica l'ownership nel database: è la ragione per cui sta **nella VPC** anche se la firma non usa la rete. Ha quindi anche `rds-db:connect` come `presigned_user`, secondo lo schema del paragrafo 4.3. Non ha `sns:Publish` né altri permessi S3."),

  intro("**CORS: il browser deve poter fare il POST.** La SPA è servita dal dominio CloudFront del sito; il `POST` va al dominio del bucket. Sono due origini diverse, e senza una regola CORS il browser bloccherebbe la richiesta prima ancora di inviarla. La regola permette solo il `POST` e solo dall'origine del sito:"),
  ...codice(leggiJson("config/s3-files-cors.json"), "config/s3-files-cors.json"),
  p("CORS non è un controllo di sicurezza lato server: protegge l'utente nel browser, e uno script fuori dal browser lo ignora. L'autorizzazione vera dell'upload resta la firma. Per lo stesso motivo il dominio del bucket compare anche nella `connect-src` della Content Security Policy del sito: la pagina può mandare dati solo verso API, Cognito e il bucket degli upload."),

  h3("Registrare il file: la notifica S3 e la Files Lambda"),
  p("Il database deve sapere che il file esiste. Si potrebbe far chiamare alla SPA una route di conferma a upload finito, ma il client può mentire o non chiamare. Invece è **S3 stesso** a dirlo: quando un oggetto viene creato sotto `uploads/`, la notifica `ObjectCreated` invoca la Files Lambda, che registra chiave, immobile (ricavato dalla chiave) e dimensione. Il database viene aggiornato solo dagli upload riusciti. È l'equivalente di un `@EventListener` che reagisce a un fatto avvenuto."),
  ...codice(leggiJson("config/s3-files-notification.json"), "config/s3-files-notification.json"),
  intro("**Chi può invocare la Files Lambda.** Qui chi chiama è il servizio S3, non un nostro ruolo: il permesso sta nella **resource policy della funzione**."),
  ...codice(leggiJson("iam/resource-policies/lambda-files-allow-s3.json"), "iam/resource-policies/lambda-files-allow-s3.json"),
  punto("`AWS:SourceArn` = il bucket dei file: solo il nostro bucket può invocare la funzione."),
  punto("`AWS:SourceAccount` = il nostro account. Serve perché **gli ARN dei bucket non contengono l'account**: se il bucket venisse cancellato, un altro account potrebbe crearne uno con lo stesso nome, e quindi con lo stesso ARN. Le due condizioni insieme chiudono il *confused deputy* (paragrafo 3.1)."),
  punto("L'ordine di creazione conta: il permesso va creato **prima** della configurazione di notifica sul bucket, altrimenti S3 la rifiuta, perché verifica di poter invocare la funzione."),
  p("La Files Lambda sta nella VPC, ma questa invocazione **non passa dalla sua rete**: la fa il servizio Lambda. Non serve quindi un endpoint per riceverla. La Files non ha nemmeno `s3:GetObject`: chiave e dimensione arrivano nell'evento, e il file non le serve."),
  p("**L'invocazione è asincrona.** S3 consegna l'evento al servizio Lambda e non aspetta l'esito. Se la funzione fallisce, è Lambda a ritentare: con le impostazioni di default fa altri due tentativi, a uno e poi a due minuti di distanza; per la Files non è configurata una on-failure destination. Questo ha due conseguenze. Uno stesso evento può arrivare più di una volta (la documentazione di Lambda lo dice anche per le invocazioni riuscite), quindi la registrazione deve sopportare un duplicato (la chiave dell'oggetto identifica il file). E se tutti i tentativi falliscono, per esempio perché il database è irraggiungibile a lungo, il file resta su S3 senza riga nel database: non compare nell'annuncio, e la traccia sta nei log e nell'allarme sugli errori della funzione."),
  p("C'è anche un caso limite voluto: un upload firmato poco prima che l'immobile venga cancellato (il modulo vale 5 minuti) può arrivare dopo la cancellazione. La Files prova a registrarlo, non trova l'immobile, e **cancella l'oggetto**."),

  h3("Lettura: CloudFront dei file con OAC"),
  p("I file degli annunci sono **pubblici per chi ha il link**, come le foto di un annuncio, ma il bucket resta privato: Block Public Access attivo e ACL disattivate. Nessuno lo legge direttamente; lo legge solo la distribuzione CloudFront dei file. CloudFront non ha un ruolo: con **Origin Access Control** firma le sue richieste verso S3 come servizio `cloudfront.amazonaws.com`, e la bucket policy ammette solo quella distribuzione."),
  ...codice(leggiJson("iam/resource-policies/s3-files-bucket-policy.json"), "iam/resource-policies/s3-files-bucket-policy.json"),
  punto("Il primo statement permette `s3:GetObject` solo su `uploads/*` e solo alla distribuzione `<DIST_FILES_ID>`, con la condizione `AWS:SourceArn`, come per il bucket del sito (4.1)."),
  punto("Il secondo è un **Deny esplicito** per tutti delle richieste senza TLS (`aws:SecureTransport = false`). Un Deny vince su qualunque Allow, compreso quello della firma del presigned POST: anche l'upload deve essere HTTPS."),
  punto("CloudFront non ha `s3:ListBucket`: per un file che non esiste S3 risponde 403 invece di 404."),
  p("La distribuzione dei file è separata da quella del sito. Le pagine d'errore personalizzate valgono per un'intera distribuzione, e la regola della SPA \"403/404 → `/index.html`\" non deve toccare i file: un file mancante deve dare errore, non la pagina dell'applicazione. L'elenco dei file di un immobile lo dà invece la Files Lambda con `GET /properties/{id}/files`, una route pubblica; il browser compone i link verso il dominio della distribuzione."),

  h3("Cancellazione: le Lambda verso S3 dalla VPC"),
  p("Qui la direzione si inverte: è la Lambda a chiamare S3. Le Lambda nella VPC non hanno Internet, quindi passano dal **gateway endpoint S3**: gratuito, una rotta nelle route table delle due subnet verso la *prefix list* di S3, senza security group. In `sg-lambda-internal` c'è per questo una regola in uscita 443 verso la prefix list (`pl-...`), non verso un security group. Il gateway usa la policy di default: i permessi veri sono nei ruoli."),
  intro("**Un file alla volta: la Files Lambda.** `DELETE /files/{id}` richiede il JWT del proprietario. La Files controlla l'ownership nel database, toglie la riga e cancella l'oggetto. Il suo ruolo può solo questo:"),
  ...codice(leggiJson("iam/policies/lambda-files.json"), "iam/policies/lambda-files.json"),
  intro("**Tutti i file di un immobile: la Property Lambda.** `DELETE /properties/{id}` cancella prima la riga dell'immobile (le righe dei file spariscono in cascata, nella stessa transazione), poi elenca gli oggetti sotto `uploads/<propertyId>/` e li cancella a gruppi fino a 1000 chiavi. Si elenca il prefisso invece di leggere le chiavi dal database per prendere anche i file caricati ma non ancora registrati. Dalla policy della Property, gli statement che riguardano S3:"),
  ...codice(`{
  "Sid": "ListFilesOfDeletedProperty",
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>",
  "Condition": {
    "StringLike": {
      "s3:prefix": "uploads/*"
    }
  }
},
{
  "Sid": "DeleteFilesOfDeletedProperty",
  "Effect": "Allow",
  "Action": "s3:DeleteObject",
  "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>/uploads/*"
}`, "iam/policies/lambda-property.json (estratto)"),
  p("Sono due livelli di risorsa diversi: elencare è un'azione **sul bucket** (`arn:aws:s3:::bucket`, ristretta con la condizione `s3:prefix`), cancellare è un'azione **sugli oggetti** (`.../uploads/*`). Nessuna delle due Lambda ha `s3:GetObject` o `s3:PutObject`: caricare resta compito della Presigned, leggere di CloudFront."),
  p("L'ordine \"prima il database, poi S3\" è voluto: appena la riga sparisce l'annuncio non è più visibile e la Presigned rifiuta nuovi upload, perché il controllo di ownership non trova l'immobile. Se S3 non risponde dopo il commit, l'SDK ritenta; se fallisce ancora la Lambda scrive nel log `FILES_CLEANUP_FAILED` con il `propertyId`, su cui c'è un allarme, e risponde comunque 204. I file rimasti sono sotto un prefisso noto e si tolgono rilanciando la pulizia. Un file già nella cache degli edge di CloudFront può restare servito fino alla scadenza del TTL: la Lambda non invalida la cache, perché l'API di CloudFront non è raggiungibile da una VPC senza Internet, e il link non è più elencato da nessuna parte."),

  h3("Quando qualcosa va storto"),
  tabella(
    ["Situazione", "Cosa succede", "Effetto"],
    [
      ["L'utente non è il proprietario", "la Presigned risponde 403 e non firma", "nessun upload possibile"],
      ["File troppo grande o di tipo sbagliato", "S3 rifiuta il `POST` perché viola le conditions", "il file non entra nel bucket, nessuna notifica"],
      ["Modulo scaduto (oltre 5 minuti)", "S3 rifiuta il `POST`", "la SPA chiede una nuova firma"],
      ["Regola CORS mancante o origine diversa", "il browser blocca la richiesta", "errore in console; S3 non riceve nulla"],
      ["La Files Lambda fallisce registrando", "Lambda ritenta l'invocazione asincrona", "se i tentativi falliscono tutti, file su S3 senza riga nel database"],
      ["Upload che arriva dopo la cancellazione dell'immobile", "la Files non trova l'immobile e cancella l'oggetto", "nessun file orfano"],
      ["S3 non risponde durante `DELETE /properties/{id}`", "log `FILES_CLEANUP_FAILED` con allarme, risposta 204", "file da ripulire sotto un prefisso noto"],
    ],
    [2900, 3600, 3100],
  ),
  dopoTabella(),
  p("Resta un rischio dichiarato: i file caricati non vengono scansionati da un antivirus, che è uno sviluppo futuro. Il limite di tipo `image/` o `video/` riguarda il `Content-Type` dichiarato, non il contenuto reale del file."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["Upload diretto con presigned POST", "il file non passa dal backend: niente limiti di 10 MB e 6 MB, niente tempo di Lambda pagato per trasferire", "file inviato all'API e inoltrato dalla Lambda a S3"],
      ["POST e non PUT", "solo il POST permette `content-length-range` e la condizione sul `Content-Type`", "presigned PUT: non limita la dimensione"],
      ["Chiave decisa dalla Lambda, per immobile, con UUID", "il client non sceglie dove scrivere; un prefisso per immobile semplifica la cancellazione", "nome del file scelto dal client; prefisso per utente"],
      ["Registrazione con la notifica `ObjectCreated`", "il database riflette solo gli upload riusciti", "conferma dal client (`POST /files/confirm`): può mentire o non chiamare"],
      ["Bucket privato, lettura con CloudFront e OAC", "HTTPS, cache, nessun accesso diretto al bucket", "bucket pubblico; file privati con signed URL (non servono: i file sono pubblici per scelta)"],
      ["Distribuzione dei file separata da quella del sito", "la regola SPA 403/404 non deve toccare i file", "una distribuzione con un behavior `/files/*`"],
      ["Cancellazione tramite gateway endpoint S3", "gratuito, nessun security group da gestire", "NAT Gateway o interface endpoint S3, a pagamento"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Perché il file non passa dalla Lambda?** API Gateway accetta al massimo 10 MB e una Lambda sincrona 6 MB, e pagheremmo il trasferimento come tempo di esecuzione. La Lambda firma, il browser carica direttamente su S3.",
    "**Che permessi ha un presigned POST?** Al massimo quelli del ruolo che lo firma: `s3:PutObject` su `uploads/*`. S3 li valuta al momento dell'upload; tipo, dimensione, chiave e scadenza li limitano le conditions, non IAM.",
    "**Come sa il database che l'upload è riuscito?** S3 emette `ObjectCreated` su `uploads/` e invoca in modo asincrono la Files Lambda, ammessa dalla sua resource policy con `AWS:SourceArn` e `AWS:SourceAccount`.",
    "**Perché due condizioni nel permesso per S3?** `AWS:SourceArn` limita al nostro bucket, ma l'ARN di un bucket non contiene l'account: se il nostro bucket venisse cancellato, un altro account potrebbe ricrearlo con lo stesso nome e invocare la funzione. `AWS:SourceAccount` lo esclude.",
    "**Come cancella un file una Lambda in una VPC senza Internet?** Con il gateway endpoint S3: una rotta verso la prefix list di S3, gratuita e senza security group; il permesso è `s3:DeleteObject` nel suo ruolo.",
  ]),
];
};
