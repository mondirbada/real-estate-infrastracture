// 3.4 Caricare e servire i file — upload con presigned POST, registrazione con la notifica S3, lettura con CloudFront, cancellazione.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, tabella, dopoTabella, figura } = S;

  return [
  h2("3.4 Caricare e servire i file"),
  p("Un agente pubblica foto e video, e chiunque guardi l'annuncio deve vederli. Far passare i file dall'API non funziona: API Gateway accetta al massimo 10 MB per richiesta e una Lambda sincrona 6 MB, e il tempo di trasferimento lo pagheremmo come esecuzione. La soluzione è che **il file non passi mai dal backend**: la Presigned Lambda non riceve i byte, li autorizza. Firma un *presigned POST*, un modulo di upload firmato, e il browser lo usa per caricare il file direttamente nel bucket privato `real-estate-prod-files-<SUFFIX>`, sotto `uploads/`."),
  ...figura(path.join(DIAGRAMMI, "file.png"), 2116, 2275,
    "Figura 3.4 — Upload, registrazione, lettura e cancellazione dei file. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso"),
  ...elencoNumerato([
    "La SPA chiama `POST /properties/{id}/uploads` con l'access token. La Presigned Lambda controlla nel database che l'utente sia il **proprietario** dell'immobile.",
    "La Presigned **firma in locale** un presigned POST: chiave `uploads/<propertyId>/<uuid>.<ext>` decisa da lei, scadenza 5 minuti, tipo `image/` o `video/`, dimensione massima.",
    "Il browser invia il file **direttamente al bucket**; lo permette la regola **CORS** del bucket.",
    "S3 emette una notifica `ObjectCreated` e **invoca in modo asincrono la Files Lambda**, che registra il file nel database.",
    "Per mostrare l'annuncio la SPA scarica i file dalla **distribuzione CloudFront dei file**, che li legge dal bucket con **OAC**.",
    "Per cancellare, la Files Lambda (un file) o la Property Lambda (tutti i file di un immobile) chiamano S3 passando dal **gateway endpoint**.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["SPA → API → Presigned", "`POST /properties/{id}/uploads`, sincrona", "authorizer JWT; ownership verificata nel database"],
      ["Browser → bucket", "`POST` del modulo firmato, HTTPS", "la firma del ruolo della Presigned e le conditions del modulo; CORS per il browser"],
      ["S3 → Files Lambda", "notifica `ObjectCreated` su `uploads/`, asincrona", "resource policy della funzione"],
      ["CloudFront → bucket", "`s3:GetObject` firmato con OAC", "bucket policy, solo la distribuzione dei file"],
      ["Files / Property → bucket", "`DeleteObject` (la Property anche `ListBucket`), via gateway endpoint", "execution role della Lambda"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),

  h3("Le autorizzazioni"),
  p("**Chi firma l'upload.** L'utente Cognito non ha permessi IAM e il browser non ha credenziali AWS. Il permesso di scrivere nel bucket ce l'ha il **ruolo della Presigned Lambda**: la funzione usa le sue credenziali temporanee per firmare il modulo, e quando il browser lo invia S3 tratta la richiesta come se arrivasse da quel ruolo."),
  ...codice(leggiJson("iam/policies/lambda-presigned.json"), "iam/policies/lambda-presigned.json"),
  punto("**Un presigned POST ha al massimo i permessi di chi lo firma**: nessun modulo può scrivere fuori da `uploads/*` del bucket dei file."),
  punto("**Il permesso si controlla all'upload, non alla firma.** Firmare è un calcolo locale: senza `s3:PutObject` la Lambda firmerebbe senza errori e il browser riceverebbe `AccessDenied`."),
  punto("**IAM non limita tipo e dimensione.** Lo fanno le *conditions* del modulo, che la Lambda inserisce nella firma e il client non può cambiare senza invalidarla. Usiamo il POST e non il presigned PUT proprio perché solo il POST permette di limitare la dimensione (le conditions complete sono nel repository)."),
  p("Il Block Public Access non blocca l'upload: la richiesta è firmata, non pubblica. La regola **CORS** del bucket ammette solo il `POST` e solo dall'origine del sito; come quella dell'API (3.2) protegge l'utente nel browser, non il bucket: l'autorizzazione vera resta la firma."),
  p("**Chi può invocare la Files Lambda.** Qui chi chiama è il servizio S3, non un nostro ruolo, e il permesso sta nella resource policy della funzione:"),
  ...codice(leggiJson("iam/resource-policies/lambda-files-allow-s3.json"), "iam/resource-policies/lambda-files-allow-s3.json"),
  p("Le due condizioni servono insieme: `AWS:SourceArn` limita al nostro bucket, `AWS:SourceAccount` al nostro account, perché l'ARN di un bucket non lo contiene (vedi 4.1)."),
  p("**La lettura** funziona come per il sito (3.1), con la bucket policy del bucket dei file:"),
  ...codice(leggiJson("iam/resource-policies/s3-files-bucket-policy.json"), "iam/resource-policies/s3-files-bucket-policy.json"),
  p("`s3:GetObject` vale solo su `uploads/*` e solo per la distribuzione dei file, grazie ad `AWS:SourceArn`. Il `Deny` senza TLS vale per tutti, upload firmati compresi. Le distribuzioni sono due perché la regola della SPA \"403/404 → `/index.html`\" non deve valere per i file."),
  p("**La cancellazione.** Le Lambda nella VPC raggiungono S3 con il **gateway endpoint** (4.2). Il ruolo della Files Lambda, che registra i file e ne cancella uno alla volta:"),
  ...codice(leggiJson("iam/policies/lambda-files.json"), "iam/policies/lambda-files.json"),
  p("Entra nel proxy come `files_user` e può solo cancellare oggetti sotto `uploads/`: non legge, non scrive, non elenca il bucket. La Property, che cancellando un immobile ne svuota il prefisso, ha in più `s3:ListBucket` e il permesso di pubblicare le notifiche (3.5):"),
  ...codice(leggiJson("iam/policies/lambda-property.json"), "iam/policies/lambda-property.json"),
  p("`s3:ListBucket` si applica al bucket, non agli oggetti: la condizione `s3:prefix` lo limita a `uploads/*`."),

  h3("Quando qualcosa va storto"),
  p("Se l'utente non è il proprietario, la Presigned risponde 403. Un file troppo grande, di tipo sbagliato o inviato dopo i 5 minuti lo rifiuta S3, senza notifica."),
  p("La notifica è un'**invocazione asincrona**: S3 non aspetta l'esito. Se la Files fallisce, Lambda ritenta altre due volte, a uno e poi a due minuti di distanza. Uno stesso evento può quindi arrivare più di una volta, e la registrazione deve sopportare il duplicato. Se tutti i tentativi falliscono il file resta su S3 senza riga: non compare nell'annuncio, e la traccia sta nei log e nell'allarme sugli errori della funzione. Un upload firmato poco prima della cancellazione dell'immobile può arrivare dopo: la Files non trova l'immobile e cancella l'oggetto."),
  p("Cancellando un immobile, la Property toglie prima la riga e poi i file; se S3 non risponde scrive nel log `FILES_CLEANUP_FAILED`, su cui c'è un allarme (3.7), e la pulizia si rilancia sul prefisso noto. Un file già nella cache di CloudFront può restare servito fino alla scadenza del TTL. Resta un rischio dichiarato: i file non passano da un antivirus, e il tipo controllato è quello dichiarato, non il contenuto."),

  h3("Le scelte"),
  p("Registrare il file con la notifica di S3, invece che con una conferma della SPA, fa sì che il database rifletta solo gli upload riusciti: il client potrebbe mentire o non chiamare. La chiave la decide la Lambda, per immobile e con un UUID, così il client non sceglie dove scrivere e la cancellazione lavora su un solo prefisso. Le alternative sono nel capitolo 5."),
];
};
