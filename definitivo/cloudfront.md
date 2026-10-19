# CloudFront — distribuzione del sito e distribuzione dei file

CloudFront è la CDN di AWS: una rete di *edge location* nel mondo che servono i contenuti in HTTPS dal punto più
vicino all'utente, tenendoli in cache. Nel progetto rende accessibili sul web due bucket S3 privati con due
distribuzioni separate: una per la SPA, una per i file pubblici degli annunci. Non partecipa all'autenticazione.

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Browser → distribuzione del sito | utenti | HTTPS (HTTP reindirizzato su HTTPS) | pubblica |
| Distribuzione del sito → bucket del sito | [s3.md](s3.md) | OAC, richieste firmate SigV4 | bucket policy del sito |
| Browser → distribuzione dei file | utenti | HTTPS | pubblica (chi ha il link) |
| Distribuzione dei file → bucket dei file | [s3.md](s3.md) | OAC | bucket policy dei file, solo `uploads/*` |

CloudFront **non** parla con Cognito né con le Lambda: l'API è su [API Gateway](api-gateway.md), chiamata direttamente
dal browser.

## Come funziona

Una **distribuzione** ha una o più *origin* (qui un bucket S3). A ogni richiesta l'edge guarda la cache: se il
contenuto c'è (*cache hit*) risponde subito; altrimenti (*cache miss*) lo recupera dall'origin, lo salva secondo le
regole di cache (TTL) e risponde. Dopo un deploy del sito si invalida la cache (`/*`) perché gli utenti vedano la nuova
versione.

Concetti usati: *behavior* (regole per path pattern), *cache policy* (cosa entra nella chiave di cache: header, query
string, cookie), *origin request policy* (cosa viene inoltrato all'origin), *default root object* (`index.html`), pagine
d'errore personalizzate, OAC.

## Configurazione

| | Distribuzione del sito | Distribuzione dei file |
| --- | --- | --- |
| ID | `<DIST_SITE_ID>` | `<DIST_FILES_ID>` |
| Origin | `real-estate-prod-website-<SUFFIX>` | `real-estate-prod-files-<SUFFIX>` |
| Accesso all'origin | OAC | OAC |
| Default root object | `index.html` | — |
| Errori 403/404 | → `/index.html` con codice 200 (routing della SPA) | nessuna regola |
| Contenuto | HTML, JS, CSS della SPA | foto e video sotto `uploads/` |
| Viewer protocol | redirect HTTP → HTTPS | redirect HTTP → HTTPS |

- **Due distribuzioni e non una**: le pagine d'errore personalizzate valgono per tutta una distribuzione, e la regola
  "403/404 → `/index.html`" non deve toccare i file (un file mancante deve dare errore, non la SPA). Anche cache ed
  errori hanno regole diverse. Alternativa scartata: una distribuzione con un behavior `/files/*`.
- **Perché anche il 403**: CloudFront non ha `s3:ListBucket`, quindi per un file che non esiste S3 risponde 403 invece
  di 404. Per una SPA entrambi diventano `/index.html`, così il routing resta gestito dal frontend.
- **Dominio**: per la presentazione usiamo `*.cloudfront.net`. Con un dominio personalizzato il certificato ACM per
  CloudFront andrebbe creato in **`us-east-1`**, non a Milano.
- **File pubblici**: chiunque abbia il link vede un file, come le foto di un annuncio. Il bucket resta comunque privato
  e nessuno lo legge direttamente.

## IAM

CloudFront **non ha un ruolo**: firma le richieste verso S3 con **Origin Access Control** (OAC, sostituisce il vecchio
OAI), e la **bucket policy** ammette solo quella distribuzione con la condizione `AWS:SourceArn` sull'ARN della
distribuzione. Le due bucket policy hanno anche un Deny delle richieste senza TLS (spiegato in
[s3.md](s3.md#bucket-policy)).

Distribuzione del sito → bucket del sito:

File: [`iam/resource-policies/s3-website-bucket-policy.json`](iam/resource-policies/s3-website-bucket-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontSiteDistributionReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::real-estate-prod-website-<SUFFIX>/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DIST_SITE_ID>"
        }
      }
    },
    {
      "Sid": "DenyRequestsWithoutTls",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::real-estate-prod-website-<SUFFIX>",
        "arn:aws:s3:::real-estate-prod-website-<SUFFIX>/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

Distribuzione dei file → bucket dei file, solo `uploads/*`:

File: [`iam/resource-policies/s3-files-bucket-policy.json`](iam/resource-policies/s3-files-bucket-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontFilesDistributionReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>/uploads/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DIST_FILES_ID>"
        }
      }
    },
    {
      "Sid": "DenyRequestsWithoutTls",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::real-estate-prod-files-<SUFFIX>",
        "arn:aws:s3:::real-estate-prod-files-<SUFFIX>/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

Senza la condizione `AWS:SourceArn`, una distribuzione CloudFront di un altro account potrebbe leggere il bucket.

## Sicurezza e rete

- Servizio globale, fuori dalla VPC: niente security group.
- HTTPS verso il browser (redirect da HTTP) e verso S3; le bucket policy negano comunque le richieste senza TLS.
- AWS WAF si può associare a CloudFront (rate limiting, regole OWASP); come il certificato ACM, il WAF per CloudFront
  si crea in `us-east-1` e non a Milano. È anche il modo per proteggere in futuro
  l'HTTP API mettendole CloudFront davanti ([api-gateway.md](api-gateway.md#throttling)).
- Niente Lambda@Edge o CloudFront Functions: il sito statico è pubblico, i dati stanno dietro l'API.

## Costi

Si pagano il trasferimento verso Internet e le richieste; c'è un livello gratuito mensile che basta per il progetto.

## Riferimenti

- [Origin Access Control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)

## All'orale

> **Perché CloudFront e non un bucket S3 pubblico con "static website hosting"?**
> HTTPS, cache vicino all'utente, bucket privato con accesso solo da OAC, possibilità di WAF. È come mettere Nginx
> davanti ai file statici invece di esporre la cartella.
>
> **Cos'è OAC e dove sta il permesso?**
> CloudFront firma le richieste a S3 come servizio `cloudfront.amazonaws.com`; il permesso sta nella bucket policy, con
> `AWS:SourceArn` della nostra distribuzione. CloudFront non ha ruoli.
>
> **Perché due distribuzioni?**
> La regola SPA "403/404 → `/index.html`" vale per tutta la distribuzione e romperebbe i file; sito e file hanno regole
> di cache e di errore diverse.
>
> **Perché trasformate anche il 403 in `index.html`?**
> CloudFront non ha `s3:ListBucket`, quindi S3 risponde 403 per un oggetto che non esiste. Per la SPA è un percorso
> del router React.
>
> **Cosa succede dopo un deploy del sito?**
> Si caricano i file nuovi nel bucket e si invalida la cache (`/*`), altrimenti gli edge servono la versione vecchia fino
> alla scadenza del TTL.
>
> **CloudFront autentica gli utenti?**
> No. Serve solo file; il login lo fa la SPA con Cognito e i dati protetti stanno dietro l'API.
