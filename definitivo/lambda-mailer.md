# Mailer Lambda — `real-estate-prod-mailer`

Consuma la coda delle notifiche e invia le email con SES. L'evento porta il destinatario come `recipientSub` e i dati
dell'email; l'indirizzo la Mailer lo chiede a **Cognito** con `AdminGetUser`. Non le serve il database: per questo sta
**fuori dalla VPC**.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Invocata da | [SQS](sqs.md), coda `real-estate-prod-notifications-queue` | event source mapping: il servizio Lambda legge la coda a batch e invoca la funzione |
| Chiama | [Cognito](cognito.md), user pool `<USER_POOL_ID>` | `cognito-idp:AdminGetUser` con `Username = recipientSub`, via API pubblica regionale |
| Chiama | [SES](ses.md) | `ses:SendEmail` via API, dal mittente `<MAIL_FROM>` |
| Scrive i log in | [CloudWatch](cloudwatch.md) | log group `/aws/lambda/real-estate-prod-mailer`, log strutturati in JSON |

A monte: le Lambda Property, Users, Offers → [SNS](sns.md) → SQS. Regole comuni: [lambda.md](lambda.md).

## Cosa fa

1. L'event source mapping fa *polling* della coda e invoca la Mailer con un **batch** di al massimo 10 messaggi.
2. Per ogni messaggio la Mailer legge l'evento, chiede a Cognito l'email del destinatario, compone l'email e chiama SES.
3. Risponde con l'elenco dei soli messaggi falliti per un errore temporaneo (**batch item failures**). L'event source
   mapping cancella dalla coda tutti gli altri; quelli elencati tornano visibili dopo il visibility timeout e vengono
   ritentati; dopo 5 ricezioni finiscono nella DLQ ([sqs.md](sqs.md#ciclo-di-vita-di-un-messaggio)).

### Da dove arriva l'email

Il destinatario arriva come `recipientSub` ([sns.md](sns.md#formato-degli-eventi)). Per ogni messaggio la Mailer chiama
`AdminGetUser` con `UserPoolId = <USER_POOL_ID>` e `Username = recipientSub`, e dalla risposta legge gli attributi
`email` ed `email_verified`.

- Funziona perché il pool usa l'**email come attributo di accesso** (`UsernameAttributes: ["email"]`): in questo caso
  Cognito assegna come `username` interno un identificativo uguale al `sub`, e `AdminGetUser` accetta il `sub`
  ([cognito.md](cognito.md#user-pool-lemail-è-lattributo-di-accesso)).
- Se `email_verified` non è `true` la Mailer non invia: è un errore permanente (vedi sotto).
- L'email è sempre quella attuale: un cambio fatto su Cognito vale dalla notifica successiva.
- Raggiunge `cognito-idp.eu-south-1.amazonaws.com` perché è fuori dalla VPC: nessun endpoint, nessun NAT.

### Batch parziali (adottati)

L'event source mapping ha `FunctionResponseTypes: ["ReportBatchItemFailures"]`, e la Mailer restituisce

```json
{
  "batchItemFailures": [
    {
      "itemIdentifier": "<messageId>"
    }
  ]
}
```

con il `messageId` dei soli messaggi da ritentare. Una lista vuota vuol dire "tutto il batch è andato".

Perché: senza batch parziali, un solo messaggio fallito fa fallire l'invocazione e **tutto il batch** torna in coda.
Le altre nove email, già inviate, partono una seconda volta (email doppie), e i messaggi buoni accumulano ricezioni come
quello cattivo, avanzando anche loro verso la DLQ. Con i batch parziali torna in coda solo il messaggio fallito.

Attenzione: se la funzione **lancia un'eccezione** o va in **timeout**, Lambda considera fallito l'intero batch. Per
questo il ciclo cattura gli errori di ogni messaggio e la funzione non lancia mai.

### Classificazione degli errori

| Tipo | Esempi | Cosa fa la Mailer | Esito |
| --- | --- | --- | --- |
| **Temporaneo** | throttling (`TooManyRequestsException`) o errori 5xx di SES o Cognito, timeout di rete, invio sospeso dell'account SES (`SendingPausedException`) | mette il `messageId` in `batchItemFailures`, log a livello `WARN` | torna visibile dopo il visibility timeout, viene ritentato; dopo 5 ricezioni va in DLQ |
| **Permanente** | messaggio malformato (JSON non valido, campi mancanti), `UserNotFoundException` (l'utente ha cancellato l'account), email non verificata, `MessageRejected` di SES (per esempio destinatario non verificato in sandbox) | log strutturato a livello `ERROR` con `code = "MAIL_PERMANENT_FAILURE"`; per `UserNotFoundException` livello `INFO`, perché è un caso previsto | il messaggio si considera elaborato e viene cancellato: ritentarlo non cambierebbe niente |

Gli errori permanenti non arrivano nella DLQ, quindi l'allarme della DLQ non li vede. Li rende visibili un *metric
filter* di CloudWatch sui log `MAIL_PERMANENT_FAILURE` con il suo allarme ([cloudwatch.md](cloudwatch.md#configurazione)).

### Il codice, in breve

```javascript
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

// Client creati fuori dall'handler: riusati tra le invocazioni.
const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({});
const USER_POOL_ID = process.env.USER_POOL_ID;
const MAIL_FROM = process.env.MAIL_FROM;

class PermanentError extends Error {}

const PERMANENT_AWS_ERRORS = new Set(["UserNotFoundException", "MessageRejected", "InvalidParameterException"]);

export const handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      if (isPermanent(err)) {
        // Ritentare non serve: si logga e il messaggio viene cancellato con il resto del batch.
        const expected = err.name === "UserNotFoundException";
        log(expected ? "INFO" : "ERROR", {
          code: expected ? "RECIPIENT_DELETED" : "MAIL_PERMANENT_FAILURE",
          messageId: record.messageId,
          error: err.name,
          reason: err.message,
        });
      } else {
        // Temporaneo: il messaggio torna in coda dopo il visibility timeout.
        log("WARN", { code: "MAIL_RETRY", messageId: record.messageId, error: err.name });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  }
  return { batchItemFailures };
};

async function processRecord(record) {
  let evt;
  try {
    evt = JSON.parse(record.body);
  } catch {
    throw new PermanentError("JSON non valido");
  }
  if (!evt.type || !evt.recipientSub) throw new PermanentError("campi obbligatori mancanti");

  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: evt.recipientSub }));
  const attr = Object.fromEntries(user.UserAttributes.map((a) => [a.Name, a.Value]));
  if (attr.email_verified !== "true") throw new PermanentError("email non verificata");

  const { subject, text } = render(evt); // modello dell'email in base a evt.type
  await ses.send(new SendEmailCommand({
    FromEmailAddress: MAIL_FROM,
    Destination: { ToAddresses: [attr.email] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
  }));
  log("INFO", { code: "MAIL_SENT", messageId: record.messageId, eventId: evt.eventId, type: evt.type });
}

function isPermanent(err) {
  return err instanceof PermanentError || PERMANENT_AWS_ERRORS.has(err.name);
}

function log(level, fields) {
  console.log(JSON.stringify({ level, ...fields })); // niente email nei log: basta il messageId
}
```

- L'SDK ritenta già da solo alcune volte gli errori temporanei dentro la stessa invocazione; i ritentativi di SQS
  arrivano dopo, se l'SDK non ce la fa.
- Nei log non si scrive l'indirizzo email: per ricostruire un caso bastano `messageId`, `eventId` e il tipo di evento.
  È anche il modo in cui l'operatore collega un messaggio della DLQ ai log ([sqs.md](sqs.md#procedura-operativa-quando-scatta-lallarme)).

### Idempotenza

La coda standard consegna *at-least-once*: raramente lo stesso messaggio arriva due volte, e allora parte un'email
doppia. Lo **accettiamo e lo dichiariamo**: per un avviso di offerta un doppione è fastidioso, non dannoso, e una vera
deduplicazione richiederebbe una tabella di messaggi già inviati (che la Mailer, senza database, non ha). I batch
parziali riducono molto i doppioni, perché un errore non fa più ripetere le email già partite.

## Configurazione

- **Fuori dalla VPC**: nessuna subnet né security group; raggiunge SES e Cognito sulla rete di AWS senza endpoint.
- **Timeout 30 secondi**: la coda ha visibility timeout 180 s, cioè 6 volte, come consiglia AWS.
- Variabili d'ambiente `USER_POOL_ID` e `MAIL_FROM`.
- Riceve il messaggio così come è stato pubblicato, senza la busta JSON di SNS (`RawMessageDelivery`, [sns.md](sns.md)).

### Event source mapping

File: [`config/lambda-mailer-event-source-mapping.json`](config/lambda-mailer-event-source-mapping.json)

```json
{
  "EventSourceArn": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue",
  "FunctionName": "real-estate-prod-mailer",
  "Enabled": true,
  "BatchSize": 10,
  "MaximumBatchingWindowInSeconds": 0,
  "FunctionResponseTypes": [
    "ReportBatchItemFailures"
  ],
  "ScalingConfig": {
    "MaximumConcurrency": 2
  }
}
```

| Campo | Valore | Perché |
| --- | --- | --- |
| `BatchSize` | 10 | Al massimo 10 email per invocazione: in 30 secondi ci stanno largamente. Oltre 10 AWS richiede una finestra di batching di almeno 1 secondo |
| `MaximumBatchingWindowInSeconds` | 0 (il default per SQS) | Si invoca appena ci sono messaggi: le notifiche partono subito. Con una finestra maggiore di 0 andrebbe aggiunta al visibility timeout |
| `FunctionResponseTypes` | `ReportBatchItemFailures` | Batch parziali ([sopra](#batch-parziali-adottati)) |
| `ScalingConfig.MaximumConcurrency` | 2 | Il **minimo consentito** (da 2 a 1000). Al massimo due invocazioni insieme: protegge SES, che in sandbox accetta 1 email al secondo, e la quota di Cognito. Non garantisce da sola 1 email al secondo: se SES rallenta con `TooManyRequestsException` il messaggio è temporaneo e si ritenta |

`MaximumConcurrency` è un'impostazione dell'event source mapping e non costa niente: limita le invocazioni senza
rifiutarle, i messaggi restano semplicemente in coda.

## IAM

Ruolo `real-estate-prod-lambda-mailer-role`: trust [`lambda.json`](iam/trust-relationships/lambda.json), policy gestita
`AWSLambdaBasicExecutionRole` (solo log: niente policy VPC perché è fuori dalla VPC), più:

File: [`iam/policies/lambda-mailer.json`](iam/policies/lambda-mailer.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeNotificationQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue"
    },
    {
      "Sid": "ReadRecipientEmailFromUserPool",
      "Effect": "Allow",
      "Action": "cognito-idp:AdminGetUser",
      "Resource": "arn:aws:cognito-idp:eu-south-1:<ACCOUNT_ID>:userpool/<USER_POOL_ID>"
    },
    {
      "Sid": "SendEmailFromProjectAddressOnly",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:eu-south-1:<ACCOUNT_ID>:identity/*",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "<MAIL_FROM>"
        }
      }
    }
  ]
}
```

- `ConsumeNotificationQueue`: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` solo sulla coda del
  progetto. Sono le azioni che servono all'event source mapping, che legge la coda **con il ruolo della Mailer**. Sulla
  DLQ la Mailer non ha nessun permesso: lo spostamento lo fa SQS.
- `ReadRecipientEmailFromUserPool`: `cognito-idp:AdminGetUser` sul **solo ARN del nostro user pool**. È un'operazione
  amministrativa, autorizzata con la firma IAM del ruolo; nessun'altra azione su Cognito (non può creare, modificare o
  cancellare utenti, né elencarli con `ListUsers`).
- `SendEmailFromProjectAddressOnly`: `ses:SendEmail` ha come risorse tutte le identità SES dell'account
  (`identity/*`), perché in sandbox anche i destinatari sono identità verificate; la condizione `ses:FromAddress`
  permette di inviare solo da `<MAIL_FROM>`.

Chi la può invocare: **nessuna resource policy**. Non la invoca un servizio esterno: l'event source mapping è una
risorsa del servizio Lambda che usa il ruolo della funzione stessa.

## Sicurezza e rete

- Non ha accesso al database né permessi di pubblicazione: se compromessa, può leggere quella coda, leggere i profili
  degli utenti del pool e inviare email da quel mittente. Il secondo punto è il prezzo dell'email fuori dal database;
  è un rischio piccolo, perché chi controlla la Mailer può già scrivere a quegli utenti.
- Fuori dalla VPC: meno cold start, nessun endpoint per SQS, SES e Cognito, meno costi.
- **Dipende da Cognito**: se `AdminGetUser` non risponde, il messaggio è temporaneo, torna in coda e al limite va nella
  DLQ, da cui si rimanda con il redrive quando Cognito è tornato.

## Riferimenti

- [Gestione degli errori con SQS ed event source mapping (batch parziali, `batchItemFailures`)](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)
- [Configurare l'event source mapping SQS (batch size, finestra, visibility timeout, `maxReceiveCount`)](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- [Concorrenza massima dell'event source mapping SQS (da 2 a 1000)](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [`AdminGetUser`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUser.html)
- [`SendEmail` di SES v2 (errori `MessageRejected`, `TooManyRequestsException`, `SendingPausedException`)](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)

## All'orale

> **Da dove prende l'email del destinatario?**
> Da Cognito: l'evento porta `recipientSub`, la Mailer chiama `AdminGetUser` con quel `sub` come `Username` e legge
> `email` ed `email_verified`. Funziona perché il pool usa l'email come attributo di accesso, e allora lo username
> interno è il `sub`. Il permesso è uno solo, `cognito-idp:AdminGetUser` sul nostro pool.
>
> **Perché la Mailer è fuori dalla VPC?**
> Non usa il database. In VPC servirebbero endpoint per SES, SQS e Cognito, e per Cognito non funzionerebbe nemmeno
> con un pool che ha un dominio. Fuori ha meno cold start e nessun costo di endpoint.
>
> **Cosa sono i batch parziali e perché li usate?**
> La Mailer risponde con `batchItemFailures`, la lista dei soli messaggi da ritentare. Senza, un'email fallita su dieci
> farebbe ripetere tutto il batch: nove email doppie e nove messaggi buoni spinti verso la DLQ.
>
> **Quali errori ritentate e quali no?**
> Ritentiamo quelli temporanei: throttling, 5xx, timeout. Non ritentiamo quelli permanenti: messaggio malformato, utente
> cancellato, email non verificata, `MessageRejected` di SES. Quelli si loggano e si cancellano; un metric filter con un
> allarme li rende visibili.
>
> **Chi legge la coda: la Lambda o SQS?**
> Il servizio Lambda, con l'event source mapping, usando il ruolo della Mailer. Per questo il ruolo ha
> `ReceiveMessage`, `DeleteMessage` e `GetQueueAttributes`, e non serve una resource policy sulla funzione. È simile a
> un `@KafkaListener` o `@RabbitListener` gestito dal framework.
>
> **Perché concorrenza massima 2?**
> È il minimo che AWS permette. SES in sandbox accetta 1 email al secondo e Cognito ha una quota per `AdminGetUser`:
> poche invocazioni insieme evitano di saturarli. I messaggi in più aspettano in coda.
>
> **Può arrivare un'email doppia?**
> Raramente sì: la coda standard consegna almeno una volta. Lo accettiamo, e i batch parziali riducono i doppioni.
>
> **Cosa succede se va in timeout?**
> L'intero batch conta come fallito: i messaggi non vengono cancellati, tornano visibili dopo 180 secondi e vengono
> ritentati; dopo 5 ricezioni vanno nella DLQ e scatta l'allarme.
>
> **Come limitate da chi parte l'email?**
> Con la condizione `ses:FromAddress = <MAIL_FROM>` su `ses:SendEmail`.
