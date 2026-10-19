# Configurazioni non IAM

Configurazioni dei servizi collegate ai permessi di [`am-management/`](../am-management/README.md).
Sono template: i segnaposto `<...>` si sostituiscono al provisioning. `<SITE_DOMAIN>` è il dominio
della distribuzione CloudFront del sito (per esempio `d1234abcd.cloudfront.net`).

| File | Dove si applica | Cosa fa |
| --- | --- | --- |
| [`http-api-cors.json`](http-api-cors.json) | HTTP API (`CorsConfiguration`) | Ammette solo l'origine del sito, i metodi usati e gli header `authorization` e `content-type`. L'API risponde da sola alle richieste preflight `OPTIONS` |
| [`s3-files-cors.json`](s3-files-cors.json) | Bucket dei file (`PutBucketCors`) | Permette al browser di fare il `POST` dell'upload dall'origine del sito |
| [`s3-files-notification.json`](s3-files-notification.json) | Bucket dei file (`PutBucketNotificationConfiguration`) | A ogni oggetto creato sotto `uploads/` invoca la Files Lambda. Va applicata dopo il permesso [`lambda-files-allow-s3.json`](../am-management/resource-policies/lambda-files-allow-s3.json), altrimenti S3 la rifiuta |
| [`sqs-notifications-queue-attributes.json`](sqs-notifications-queue-attributes.json) | Coda `real-estate-prod-notifications-queue` | Visibility timeout 180 s (6 volte il timeout della Mailer), retention 4 giorni, cifratura SSE-SQS, DLQ dopo 5 tentativi |
| [`sqs-notifications-dlq-attributes.json`](sqs-notifications-dlq-attributes.json) | DLQ `real-estate-prod-notifications-dlq` | Retention 14 giorni (il massimo), SSE-SQS, accetta solo messaggi dalla coda principale |
| [`sns-subscription-attributes.json`](sns-subscription-attributes.json) | Sottoscrizione topic → coda | `RawMessageDelivery`: la Mailer riceve il messaggio senza la busta JSON di SNS |
| [`presigned-post-conditions.json`](presigned-post-conditions.json) | Codice della Presigned Lambda | Esempio delle condizioni del presigned POST: chiave decisa dalla Lambda, tipo `image/*`, massimo 10 MB, scadenza 5 minuti |

Nella coda `RedrivePolicy` e `RedriveAllowPolicy` sono stringhe che contengono a loro volta un JSON:
è il formato che si aspetta l'API di SQS.

Il presigned POST ammette un solo prefisso di `Content-Type` per firma. La Lambda sceglie le condizioni
in base al tipo dichiarato dal client: `image/` con un limite di 10 MB, `video/` con un limite più alto.
Il file è un esempio leggibile, non il formato di un'API AWS: nel codice le stesse condizioni si passano
all'SDK (per esempio `generate_presigned_post` in Python o `createPresignedPost` in JavaScript).
