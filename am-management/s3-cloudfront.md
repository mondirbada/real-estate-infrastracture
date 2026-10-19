# S3 e CloudFront

Due bucket privati, entrambi con *Block Public Access* attivo e ACL disattivate
(*Object Ownership: bucket owner enforced*):

| Bucket | Contenuto | Letto da | Scritto da |
| --- | --- | --- | --- |
| `real-estate-prod-website-<SUFFIX>` | La SPA (HTML, JS, CSS) | Distribuzione CloudFront del sito | Chi fa il deploy |
| `real-estate-prod-files-<SUFFIX>` | File degli annunci, sotto `uploads/` | Distribuzione CloudFront dei file | Il browser, con il presigned POST |

I nomi dei bucket sono unici in tutto il mondo: `<SUFFIX>` li rende tali.

## CloudFront → S3 (OAC)

CloudFront non ha un ruolo: firma le richieste verso S3 con Origin Access Control, e la
**bucket policy** ammette solo quella distribuzione.

- Sito: [`s3-website-bucket-policy.json`](resource-policies/s3-website-bucket-policy.json).
- File: [`s3-files-bucket-policy.json`](resource-policies/s3-files-bucket-policy.json), solo `uploads/*`.

Ogni policy ha due statement:
1. `Allow` per il principal `cloudfront.amazonaws.com`, azione `s3:GetObject`, con la condizione
   `AWS:SourceArn` = ARN della distribuzione. Senza la condizione, una distribuzione CloudFront di
   un altro account potrebbe leggere il bucket.
2. `Deny` per tutti (`"Principal": "*"`) delle richieste senza TLS (`aws:SecureTransport = false`).
   Un Deny esplicito vince sempre su qualunque Allow.

CloudFront non ha `s3:ListBucket`: per un file che non esiste S3 risponde 403 invece di 404.
È per questo che la distribuzione del sito trasforma sia 403 sia 404 in `/index.html`.

I file degli utenti sono **pubblici tramite CloudFront**: chi ha il link li vede. Il bucket però
resta privato: nessuno lo legge direttamente.

## Upload: presigned POST

Il browser scrive nel bucket dei file senza credenziali AWS proprie: usa il presigned POST firmato
dalla Presigned Lambda, che ha `s3:PutObject` solo su `uploads/*` (vedi [`lambda.md`](lambda.md)).
Non serve aggiungere nulla alla bucket policy: nello stesso account basta il permesso del ruolo
che firma. Il CORS del bucket ([`config/s3-files-cors.json`](../config/s3-files-cors.json)) permette
il `POST` dall'origine del sito.

## Notifica S3 → Files Lambda

Quando un upload termina, S3 invoca la Files Lambda
([`config/s3-files-notification.json`](../config/s3-files-notification.json), solo prefisso `uploads/`).
La funzione lo ammette con una resource-based policy:
[`lambda-files-allow-s3.json`](resource-policies/lambda-files-allow-s3.json), principal
`s3.amazonaws.com`, con le condizioni `AWS:SourceArn` (il nostro bucket) e `AWS:SourceAccount`
(il nostro account; gli ARN dei bucket non contengono l'account, quindi la seconda condizione
evita che un bucket omonimo in un altro account possa invocare la funzione).

La Lambda sta nella VPC, ma l'invocazione non passa dalla sua rete: la fa il servizio Lambda.
Serve invece il **gateway endpoint S3** quando la Files Lambda cancella un oggetto.

## Riferimenti

- [Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [Presigned POST](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html)
- [Notifiche S3 verso Lambda](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)
