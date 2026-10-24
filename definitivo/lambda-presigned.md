# Presigned Lambda — `real-estate-prod-presigned`

Genera i **presigned POST** con cui il browser carica foto e video direttamente nel bucket dei file. Prima di firmare
controlla nel database che l'utente sia il proprietario dell'immobile; la firma si calcola in locale, quindi la Lambda
non chiama S3 e non fa da tramite per i dati. Sta nella VPC per il controllo nel database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [API Gateway](api-gateway.md) | `POST /properties/{id}/uploads`, invocazione sincrona |
| Chiama | [RDS Proxy](rds-proxy.md) → [Aurora](aurora.md) | PostgreSQL 5432, TLS, token IAM come `presigned_user` |
| Firma per | [S3](s3.md), bucket dei file | nessuna chiamata di rete: firma SigV4 locale con le credenziali del ruolo |
| Usato da | browser | il presigned POST va dal browser al bucket |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-presigned` |

Dopo l'upload subentra la [Files Lambda](lambda-files.md) con la notifica S3. Regole comuni: [lambda.md](lambda.md).

## Cosa fa

1. La SPA chiama `POST /properties/{id}/uploads` con tipo e dimensione del file (JWT obbligatorio).
2. La Lambda controlla nel database che l'utente sia attivo (`requireActiveUser`: niente `deleted_at` sulla sua riga,
   altrimenti 403), che il `sub` del token sia il proprietario dell'immobile e che l'immobile non sia ritirato
   (`status = 'active'`, altrimenti 409: [lambda-property.md](lambda-property.md#immobili-ritirati)).
3. Firma un presigned POST:
   - la **chiave** la decide lei: `uploads/<propertyId>/<uuid>.<ext>`, non il client. Il prefisso è per immobile (e
     non per utente, come in una prima proposta) perché il controllo di ownership è sull'immobile; l'UUID evita
     collisioni e nomi scelti dal client;
   - **scadenza** 5 minuti;
   - **tipo**: solo `image/` o `video/`;
   - **dimensione massima** con `content-length-range`.
4. Restituisce URL e campi del modulo; il browser invia il file direttamente al bucket.

Un presigned POST ammette **un solo prefisso di `Content-Type` per firma**: la Lambda sceglie le condizioni in base al
tipo dichiarato dal client, `image/` con un limite di 10 MB, `video/` con un limite più alto. Il presigned **PUT** è stato
scartato perché non permette di limitare la dimensione.

## Configurazione

Esempio leggibile delle condizioni per un'immagine (non è il formato di un'API AWS: nel codice le stesse condizioni si
passano all'SDK, per esempio `generate_presigned_post` in Python o `createPresignedPost` in JavaScript):

File: [`config/presigned-post-conditions.json`](config/presigned-post-conditions.json)

```json
{
  "expiresInSeconds": 300,
  "key": "uploads/<propertyId>/<uuid>.<ext>",
  "conditions": [
    {
      "bucket": "real-estate-prod-files-<SUFFIX>"
    },
    [
      "eq",
      "$key",
      "uploads/<propertyId>/<uuid>.<ext>"
    ],
    [
      "starts-with",
      "$Content-Type",
      "image/"
    ],
    [
      "content-length-range",
      1,
      10485760
    ]
  ]
}
```

- `expiresInSeconds: 300`: 5 minuti.
- `["eq", "$key", ...]`: il browser non può cambiare la chiave.
- `["starts-with", "$Content-Type", "image/"]`: solo immagini con questa firma (per un video, `video/`).
- `["content-length-range", 1, 10485760]`: da 1 byte a 10 MB.

Nella VPC, subnet A e B, security group `sg-lambda-internal`; utente PostgreSQL `presigned_user`.

## IAM

Ruolo `real-estate-prod-lambda-presigned-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json), policy
gestite `AWSLambdaBasicExecutionRole` e `AWSLambdaVPCAccessExecutionRole`, più:

File: [`iam/policies/lambda-presigned.json`](iam/policies/lambda-presigned.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsPresignedUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/presigned_user"
    },
    {
      "Sid": "SignUploadsUnderUploadsPrefix",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>/uploads/*"
    }
  ]
}
```

- `ConnectToProxyAsPresignedUser`: entrare nel proxy come `presigned_user` per il controllo di ownership.
- `SignUploadsUnderUploadsPrefix`: `s3:PutObject` solo su `uploads/*`. Un presigned POST ha **al massimo** i permessi di
  chi lo firma: nessun URL generato può scrivere altrove.
- Dimensione e tipo del file **non** si limitano con IAM ma con le conditions del POST.
- Nessun `sns:Publish`: non pubblica eventi.

Non serve nulla nella bucket policy: nello stesso account basta il permesso del ruolo che firma. Chi la può invocare:
API Gateway ([`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json),
`<FUNCTION_NAME>` = `real-estate-prod-presigned`).

## Sicurezza e rete

- In uscita: solo 5432 verso `sg-rds-proxy`; la firma non usa la rete.
- Il bucket ha Block Public Access attivo: il presigned POST funziona perché è firmato da un ruolo IAM.
- Il browser può caricare solo grazie alla regola CORS del bucket ([s3.md](s3.md#cors-del-bucket-dei-file)).

## All'orale

> **Perché non far passare il file dalla Lambda?**
> API Gateway accetta al massimo 10 MB e una Lambda sincrona 6 MB, e pagheremmo il tempo di trasferimento. Con il
> presigned POST il file va dal browser a S3.
>
> **Che permessi ha il presigned POST?**
> Al massimo quelli del ruolo che firma: `s3:PutObject` su `uploads/*`. In più valgono le conditions: chiave fissa,
> tipo, dimensione, scadenza di 5 minuti.
>
> **Perché POST e non PUT?**
> Solo il POST supporta `content-length-range`, quindi un limite di dimensione.
>
> **Perché è nella VPC se la firma è locale?**
> Perché prima di firmare controlla nel database che l'utente sia il proprietario dell'immobile. Fuori dalla VPC
> firmerebbe senza quel controllo.
>
> **Come fai a far caricare un video da 200 MB?**
> Con una firma `video/` che ha un limite più alto, sempre con un presigned POST diretto a S3, senza passare dal backend.
