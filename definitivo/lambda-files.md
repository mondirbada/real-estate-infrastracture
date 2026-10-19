# Files Lambda — `real-estate-prod-files`

Tiene nel database i metadati dei file degli annunci. Riceve due tipi di evento: la **notifica S3** `ObjectCreated` a
upload completato (registra il file) e le **richieste HTTP** da API Gateway (elenco dei file di un immobile,
cancellazione di un file). Sta nella VPC perché usa il database.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [S3](s3.md), bucket dei file | notifica `ObjectCreated` sul prefisso `uploads/`, invocazione asincrona |
| Invocata da | [API Gateway](api-gateway.md) | `GET /properties/{id}/files`, `DELETE /files/{id}` |
| Chiama | [RDS Proxy](rds-proxy.md) → [Aurora](aurora.md) | PostgreSQL 5432, TLS, token IAM come `files_user` |
| Chiama | [S3](s3.md) | `DeleteObject` tramite il [gateway endpoint S3](vpc-endpoints.md) |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-files` |

Prima di lei: la [Presigned Lambda](lambda-presigned.md) firma l'upload. Regole comuni: [lambda.md](lambda.md).

## Cosa fa

| Evento | Accesso | Cosa fa |
| --- | --- | --- |
| Notifica S3 `ObjectCreated` su `uploads/` | solo S3 del nostro bucket | Registra il file nel database: chiave, immobile (dalla chiave `uploads/<propertyId>/...`), dimensione. I dati arrivano nell'evento |
| `GET /properties/{id}/files` | pubblica | Elenco dei file dell'immobile; il browser li scarica dalla distribuzione CloudFront dei file |
| `DELETE /files/{id}` | JWT, proprietario | Controlla l'ownership, toglie la riga dal database e cancella l'oggetto su S3 |

Il database viene aggiornato solo dagli upload riusciti, senza fidarsi di una conferma del client. Alternativa scartata:
la SPA chiama una route di conferma a upload finito; meno affidabile, perché il client può mentire o non chiamare.

## Configurazione

- Nella VPC, subnet A e B, security group `sg-lambda-internal` ([vpc.md](vpc.md)).
- Utente PostgreSQL `files_user`.
- La notifica S3 è configurata sul bucket ([s3.md](s3.md#notifica-objectcreated-verso-la-files-lambda)), solo per
  gli oggetti creati sotto `uploads/`:

File: [`config/s3-files-notification.json`](config/s3-files-notification.json)

```json
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "RegisterCompletedUploads",
      "LambdaFunctionArn": "arn:aws:lambda:eu-south-1:<ACCOUNT_ID>:function:real-estate-prod-files",
      "Events": [
        "s3:ObjectCreated:*"
      ],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "uploads/"
            }
          ]
        }
      }
    }
  ]
}
```

## IAM

### Execution role

Ruolo `real-estate-prod-lambda-files-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json), policy gestite
`AWSLambdaBasicExecutionRole` e `AWSLambdaVPCAccessExecutionRole`, più:

File: [`iam/policies/lambda-files.json`](iam/policies/lambda-files.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConnectToProxyAsFilesUser",
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds-db:eu-south-1:<ACCOUNT_ID>:dbuser:<PROXY_RESOURCE_ID>/files_user"
    },
    {
      "Sid": "DeleteUploadedFiles",
      "Effect": "Allow",
      "Action": "s3:DeleteObject",
      "Resource": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>/uploads/*"
    }
  ]
}
```

- `ConnectToProxyAsFilesUser`: entrare nel proxy come `files_user` per registrare e cancellare i metadati.
- `DeleteUploadedFiles`: `s3:DeleteObject` solo su `uploads/*`; la chiamata passa dal gateway endpoint S3.
- **Niente `s3:GetObject`**: chiave e dimensione arrivano nell'evento della notifica S3.
- **Niente `sns:Publish`**: non pubblica eventi di notifica.

### Chi la può invocare

Due resource policy sulla funzione:

1. API Gateway, con [`lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json) e
   `<FUNCTION_NAME>` = `real-estate-prod-files` ([api-gateway.md](api-gateway.md#iam)).
2. La notifica S3:

File: [`iam/resource-policies/lambda-files-allow-s3.json`](iam/resource-policies/lambda-files-allow-s3.json)

```json
{
  "Version": "2012-10-17",
  "Id": "default",
  "Statement": [
    {
      "Sid": "AllowFilesBucketNotifications",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-south-1:<ACCOUNT_ID>:function:real-estate-prod-files",
      "Condition": {
        "ArnLike": {
          "AWS:SourceArn": "arn:aws:s3:::real-estate-prod-files-<SUFFIX>"
        },
        "StringEquals": {
          "AWS:SourceAccount": "<ACCOUNT_ID>"
        }
      }
    }
  ]
}
```

- Principal `s3.amazonaws.com`, azione `lambda:InvokeFunction`.
- `AWS:SourceArn` = il bucket dei file: solo il nostro bucket.
- `AWS:SourceAccount` = il nostro account: gli ARN dei bucket non contengono l'account, quindi questa seconda
  condizione evita che un bucket omonimo in un altro account possa invocare la funzione.
- Va creata **prima** della configurazione di notifica sul bucket, altrimenti S3 la rifiuta.

## Sicurezza e rete

- La Lambda sta nella VPC, ma l'invocazione da S3 non passa dalla sua rete: la fa il servizio Lambda. Non serve un
  endpoint per riceverla.
- Per **cancellare** un oggetto invece la chiamata parte dalla Lambda: serve il **gateway endpoint S3** (gratuito), con
  la rotta nelle route table e l'uscita 443 verso la prefix list di S3 in `sg-lambda-internal`.

## Punti aperti

- **File di un immobile cancellato:** la riga sparisce dal database ma gli oggetti restano su S3. Accettato per il
  progetto; sviluppo futuro: un evento che fa cancellare i file a questa Lambda
  ([decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#punti-aperti)).

## All'orale

> **Come sa il database che un upload è finito?**
> S3 emette `ObjectCreated` sul prefisso `uploads/` e invoca questa Lambda, che registra il file. È come un listener
> di eventi in Spring (`@EventListener`) che reagisce a un fatto avvenuto, invece di fidarsi del client.
>
> **Perché due condizioni nel permesso per S3?**
> `AWS:SourceArn` limita al nostro bucket; ma l'ARN di un bucket non contiene l'account, quindi `AWS:SourceAccount`
> esclude un bucket con lo stesso nome in un altro account.
>
> **La Lambda è in VPC: come la raggiunge S3?**
> Non la raggiunge in rete: la invoca il servizio Lambda. Il gateway endpoint serve solo quando è la Lambda a chiamare
> S3, per cancellare.
>
> **Perché non ha `s3:GetObject`?**
> Non legge i file: chiave e dimensione sono nell'evento. Least privilege.
