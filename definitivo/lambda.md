# Lambda — regole comuni

Le Lambda eseguono il codice del backend su evento, senza server da gestire: si paga per invocazione e per durata, e il
servizio scala da zero a molte istanze. Il progetto ha **sei funzioni**: cinque di business, una per *scope*, dentro la
VPC perché usano il database; la Mailer, che invia le email, fuori dalla VPC. Questo file raccoglie ciò che vale per
tutte; ogni funzione ha il suo file.

## Collegamenti

| Funzione | Chi la invoca | Chi chiama | File |
| --- | --- | --- | --- |
| `real-estate-prod-property` | API Gateway | RDS Proxy, SNS | [lambda-property.md](lambda-property.md) |
| `real-estate-prod-users` | API Gateway | RDS Proxy, SNS | [lambda-users.md](lambda-users.md) |
| `real-estate-prod-offers` | API Gateway | RDS Proxy, SNS | [lambda-offers.md](lambda-offers.md) |
| `real-estate-prod-presigned` | API Gateway | RDS Proxy (la firma S3 è locale) | [lambda-presigned.md](lambda-presigned.md) |
| `real-estate-prod-files` | API Gateway, notifica S3 | RDS Proxy, S3 | [lambda-files.md](lambda-files.md) |
| `real-estate-prod-mailer` | event source mapping della coda SQS | Cognito (`AdminGetUser`), SES | [lambda-mailer.md](lambda-mailer.md) |

Servizi collegati: [api-gateway.md](api-gateway.md), [rds-proxy.md](rds-proxy.md), [vpc.md](vpc.md),
[vpc-endpoints.md](vpc-endpoints.md), [sns.md](sns.md), [sqs.md](sqs.md), [s3.md](s3.md), [cloudwatch.md](cloudwatch.md).

## Modello di esecuzione

- **Handler**: la funzione d'ingresso, che riceve `event` e `context`.
- **Ambiente di esecuzione** (micro-VM): creato al primo uso (*cold start*: scarica il codice, avvia il runtime, esegue
  l'inizializzazione), poi riusato per le richieste successive (*warm*). Ciò che sta fuori dall'handler sopravvive tra
  un'invocazione e l'altra.
- **Concorrenza**: un'istanza gestisce una richiesta alla volta; più richieste simultanee creano più istanze. Si può
  limitare (*reserved concurrency*) o tenere pronta (*provisioned concurrency*).
- **Configurazione**: memoria da 128 MB a 10 GB (la CPU cresce con la memoria), timeout massimo 15 minuti, variabili
  d'ambiente, layer, architettura x86 o ARM (Graviton, più economica). Versioni immutabili e alias (`prod`).
- **Modelli di invocazione**: sincrona (API Gateway), asincrona (notifica S3, con retry e possibilità di DLQ o *destination* per i fallimenti), *event source mapping* (la
  funzione legge a batch da una coda SQS; i fallimenti li gestisce la DLQ della coda, non quella della funzione:
  [sqs.md](sqs.md#perché-la-dlq-sta-sulla-coda-e-non-sulla-lambda)).

## Una Lambda per scope, con router interno

Ogni Lambda di business ha un handler che fa da routing interno dello scope: riceve l'evento, guarda metodo e percorso
e lo passa alla logica giusta (per esempio `UpdateUserInformation` o `DeleteUser` nella Users, che lavorano sui dati del
database). Svantaggi da conoscere: un ruolo IAM per scope e non per route, cold start più pesante, un bug può fermare
tutto lo scope. Alternativa: una Lambda per route, con permessi più fini e più cose da gestire. La scelta è per
semplicità.

## Lambda nella VPC

Le cinque funzioni di business sono nella VPC, in **entrambe le subnet private** (`private_subnet_A`,
`private_subnet_B`), con il security group `sg-lambda-internal`: è l'unico modo per raggiungere l'RDS Proxy, che non ha
un endpoint fuori dalla VPC. La Presigned è dentro perché controlla nel database che l'utente possa caricare file su
quella proprietà.

- Configurando subnet e security group, Lambda crea ENI (*Hyperplane*, condivise tra le istanze: oggi l'impatto sul cold
  start è ridotto).
- Una Lambda nella VPC **non ha accesso a Internet** nemmeno in una subnet pubblica: per i servizi AWS usa gli endpoint
  VPC ([vpc-endpoints.md](vpc-endpoints.md)).
- La **Mailer** non usa il database e sta **fuori**: niente endpoint per SQS e SES, meno cold start, meno costi.

Cosa raggiunge ogni Lambda e come:

| Chi | Chiama | Come ci arriva |
| --- | --- | --- |
| 5 Lambda di business | RDS Proxy | rete VPC, `sg-lambda-internal` → `sg-rds-proxy` su 5432 |
| 5 Lambda di business | token IAM per il proxy | calcolato in locale dall'SDK (firma SigV4), nessuna chiamata di rete |
| Tutte | credenziali del ruolo, log su CloudWatch | li gestisce il servizio Lambda, non la rete della funzione: nessun endpoint |
| Property, Users, Offers | SNS | interface endpoint SNS |
| Presigned | S3 | nessuna chiamata: il presigned POST si firma in locale |
| Files, Property | S3 (cancellazione; la Property solo quando cancella un immobile) | gateway endpoint S3 |
| Users | Cognito | nessuna chiamata: l'account lo gestisce il frontend |
| Mailer (fuori VPC) | SQS, Cognito, SES | rete di AWS; la coda la legge il servizio Lambda (event source mapping) |

## Connessione al database

Ogni istanza apre la propria connessione: con 200 invocazioni concorrenti ci sarebbero 200 connessioni, e PostgreSQL ha
un limite (`max_connections`). Per questo c'è l'RDS Proxy ([rds-proxy.md](rds-proxy.md)), e la connessione si apre
**fuori dall'handler**, per riusarla tra le invocazioni.

Le Lambda si autenticano al proxy con un **token IAM** (valido 15 minuti) usato come password, su TLS; ciascuna con il
proprio utente PostgreSQL (`property_user`, `users_user`, `offers_user`, `files_user`, `presigned_user`). Nel codice e
nelle variabili d'ambiente non ci sono password e le Lambda non leggono mai i secret.

## IAM

### Execution role

Ogni funzione ha il **proprio execution role**: è l'identità con cui il codice chiama gli altri servizi AWS. Ruoli
separati significano permessi minimi e log di audit chiari: se la Lambda delle offerte venisse compromessa non potrebbe
cancellare file né leggere la coda delle email.

Trust, uguale per tutti i ruoli: il servizio `lambda.amazonaws.com` assume il ruolo a ogni avvio dell'ambiente di
esecuzione e passa alla funzione credenziali temporanee; nel codice non ci sono chiavi.

File: [`iam/trust-relationships/lambda.json`](iam/trust-relationships/lambda.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLambdaToAssumeRole",
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

| Funzione | Ruolo | In VPC | Policy gestite AWS | Policy del progetto |
| --- | --- | --- | --- | --- |
| `real-estate-prod-property` | `real-estate-prod-lambda-property-role` | sì | `AWSLambdaBasicExecutionRole`, `AWSLambdaVPCAccessExecutionRole` | [`lambda-property.json`](iam/policies/lambda-property.json) |
| `real-estate-prod-users` | `real-estate-prod-lambda-users-role` | sì | come sopra | [`lambda-users.json`](iam/policies/lambda-users.json) |
| `real-estate-prod-offers` | `real-estate-prod-lambda-offers-role` | sì | come sopra | [`lambda-offers.json`](iam/policies/lambda-offers.json) |
| `real-estate-prod-files` | `real-estate-prod-lambda-files-role` | sì | come sopra | [`lambda-files.json`](iam/policies/lambda-files.json) |
| `real-estate-prod-presigned` | `real-estate-prod-lambda-presigned-role` | sì | come sopra | [`lambda-presigned.json`](iam/policies/lambda-presigned.json) |
| `real-estate-prod-mailer` | `real-estate-prod-lambda-mailer-role` | no | `AWSLambdaBasicExecutionRole` | [`lambda-mailer.json`](iam/policies/lambda-mailer.json) |

Cosa concedono le policy del progetto:

| Ruolo | Azioni | Risorsa | Perché |
| --- | --- | --- | --- |
| property, users, offers | `rds-db:connect` | `dbuser:<prx-ID>/<utente>` del proprio utente PostgreSQL | collegarsi al proxy con un token IAM |
| property, users, offers | `sns:Publish` | topic `real-estate-prod-notifications` | pubblicare gli eventi da notificare via email |
| property | `s3:ListBucket` con condizione `s3:prefix` = `uploads/*`; `s3:DeleteObject` | bucket dei file; `real-estate-prod-files-<SUFFIX>/uploads/*` | cancellare i file di un immobile cancellato (gateway endpoint S3) |
| files | `rds-db:connect` | `dbuser:<prx-ID>/files_user` | registrare e cancellare i metadati dei file |
| files | `s3:DeleteObject` | `real-estate-prod-files-<SUFFIX>/uploads/*` | cancellare un file (passa dal gateway endpoint S3) |
| presigned | `rds-db:connect` | `dbuser:<prx-ID>/presigned_user` | controllare che l'utente sia il proprietario dell'immobile |
| presigned | `s3:PutObject` | `real-estate-prod-files-<SUFFIX>/uploads/*` | firmare il presigned POST |
| mailer | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` | coda `real-estate-prod-notifications-queue` | le azioni che servono all'event source mapping per leggere la coda |
| mailer | `cognito-idp:AdminGetUser` | il solo user pool `userpool/<USER_POOL_ID>` | leggere l'email del destinatario dal `recipientSub` dell'evento |
| mailer | `ses:SendEmail` con condizione `ses:FromAddress` | `identity/*` della regione | inviare email solo dal mittente del progetto |

### Policy gestite da AWS

- `AWSLambdaBasicExecutionRole`: crea il log group della funzione e ci scrive (`logs:CreateLogGroup`,
  `logs:CreateLogStream`, `logs:PutLogEvents`).
- `AWSLambdaVPCAccessExecutionRole`: crea e rimuove le interfacce di rete (ENI) nelle subnet private. Le azioni
  `ec2:*NetworkInterface*` non si possono limitare a una risorsa e hanno `Resource: "*"`: è il motivo per cui usiamo la
  policy gestita invece di riscriverla.
- Le policy gestite sono comode ma larghe (`Resource: "*"`). Per mostrare il least privilege, log e VPC usano quelle
  gestite, mentre SQS, SNS, S3, SES e `rds-db` hanno policy nostre sull'ARN preciso (per esempio non usiamo
  `AWSLambdaSQSQueueExecutionRole` per la Mailer).

### Template generico per il proxy

Il permesso `rds-db:connect` di ogni ruolo segue il template
[`iam/policies/lambda-connect-proxy.json`](iam/policies/lambda-connect-proxy.json), spiegato in
[rds-proxy.md](rds-proxy.md#accesso-delle-lambda-al-proxy).

### Chi può invocare le funzioni

Non è un permesso del ruolo ma una **resource-based policy sulla funzione**:

- le 5 Lambda di business ammettono API Gateway ([api-gateway.md](api-gateway.md#iam));
- la Files Lambda ammette anche la notifica S3 ([lambda-files.md](lambda-files.md#iam));
- la Mailer non ne ha bisogno: la coda la legge l'event source mapping con il ruolo della Mailer stessa.

Ruolo = cosa fa la funzione; resource policy = chi può chiamare la funzione.

## Costi

Si paga per richiesta e per GB-secondo, con un livello gratuito generoso. Le Lambda in VPC senza NAT non hanno costi di
rete in più; gli interface endpoint sì ([vpc-endpoints.md](vpc-endpoints.md#costi)).

## Riferimenti

- [Execution role di Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
- [Lambda in VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Lambda con SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)

## All'orale

> **Cos'è un cold start e come lo riducete?**
> Il primo avvio di un ambiente: scarica il codice, avvia il runtime, esegue l'init. Lo riduciamo tenendo fuori dalla
> VPC chi non usa il DB e aprendo la connessione fuori dall'handler; esiste la provisioned concurrency. È come il
> tempo di avvio del contesto Spring, che con le Lambda si paga a ogni nuova istanza.
>
> **Perché la connessione al database si apre fuori dall'handler?**
> Perché l'ambiente viene riusato: la connessione sopravvive tra le invocazioni warm, come un bean singleton che tiene
> il `DataSource`.
>
> **Perché non tutte le Lambda sono nella VPC?**
> Ci stanno solo quelle che parlano con il proxy, che vive solo nella VPC. La Mailer non usa il database: fuori evita
> endpoint per SQS e SES e cold start.
>
> **Ogni Lambda ha il suo ruolo: perché?**
> Least privilege e audit chiaro: la Offers non può cancellare file né leggere la coda. Il prezzo è avere più ruoli da
> gestire.
>
> **Una Lambda in VPC in una subnet pubblica ha Internet?**
> No: non ha IP pubblico. Servirebbe un NAT, oppure endpoint per i servizi AWS, che è la nostra scelta.
>
> **Perché una Lambda per scope e non una per route?**
> Per semplicità, come un controller per risorsa in Spring. Il prezzo è un ruolo per scope e un cold start più pesante.
