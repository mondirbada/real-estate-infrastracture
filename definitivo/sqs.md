# SQS — coda delle notifiche e dead-letter queue

SQS è una coda di messaggi gestita. La coda `real-estate-prod-notifications-queue` riceve dal topic SNS gli eventi da
notificare e li tiene finché la Mailer Lambda non li ha elaborati; i messaggi che falliscono troppe volte finiscono nella
**dead-letter queue** `real-estate-prod-notifications-dlq`.

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Riceve da | [SNS](sns.md), topic `real-estate-prod-notifications` | sottoscrizione | queue policy (sotto) |
| Letta da | [Mailer Lambda](lambda-mailer.md) | event source mapping, a batch | ruolo della Mailer |
| Sposta in | DLQ `real-estate-prod-notifications-dlq` | dopo 5 ricezioni fallite (`maxReceiveCount`) | `RedrivePolicy`, nessun permesso IAM |
| Metriche verso | [CloudWatch](cloudwatch.md) | messaggi nella DLQ, età del messaggio più vecchio in coda | allarmi → topic SNS `real-estate-prod-ops-alerts` → email del team |
| Redrive DLQ → coda | operatore del team | *redrive* manuale (`StartMessageMoveTask`) | policy [`ops-dlq-redrive.json`](iam/policies/ops-dlq-redrive.json) |

## Concetti

- **Coda standard** (la nostra): consegna *at-least-once*, ordine non garantito, scala quasi senza limiti. La **FIFO**
  garantisce ordine e deduplicazione con throughput minore; non serve per le email.
- **Visibility timeout**: quando un consumer prende un messaggio, questo diventa invisibile per N secondi; se non viene
  cancellato torna visibile e viene ritentato. Deve essere almeno pari al timeout della Lambda; AWS consiglia 6 volte.
- **Retention**: per quanto la coda tiene un messaggio (fino a 14 giorni). **Long polling**: la lettura aspetta che
  arrivino messaggi invece di rispondere vuota.
- **Ricezione**: ogni volta che un consumer riceve un messaggio, SQS ne incrementa il contatore
  (`ApproximateReceiveCount`). Il messaggio sparisce solo quando il consumer lo **cancella**.
- **DLQ**: quando un messaggio supera `maxReceiveCount` ricezioni senza essere cancellato, SQS lo sposta in un'altra
  coda per l'analisi, invece di farlo tornare in coda all'infinito. È come la *dead letter exchange* di RabbitMQ, o il
  `DeadLetterPublishingRecoverer` di Spring Kafka.
- **Redrive**: l'operazione inversa, manuale: rimandare i messaggi dalla DLQ alla coda di origine, una volta corretta la
  causa.
- Essendo *at-least-once*, il consumer deve essere **idempotente**.

## Configurazione

### Coda principale

| Attributo | Valore | Perché |
| --- | --- | --- |
| `VisibilityTimeout` | 180 s | 6 volte il timeout della Mailer (30 s), così un messaggio in lavorazione non torna visibile a metà |
| `MessageRetentionPeriod` | 345600 s (4 giorni) | la Mailer svuota la coda in pochi secondi; 4 giorni (il default) coprono anche un guasto lungo |
| `SqsManagedSseEnabled` | true | cifratura SSE-SQS (vedi sotto) |
| `RedrivePolicy` | DLQ dopo 5 ricezioni fallite (`maxReceiveCount`) | [sotto](#perché-5-ricezioni-e-180-secondi) |

File: [`config/sqs-notifications-queue-attributes.json`](config/sqs-notifications-queue-attributes.json)

```json
{
  "VisibilityTimeout": "180",
  "MessageRetentionPeriod": "345600",
  "SqsManagedSseEnabled": "true",
  "RedrivePolicy": "{\"deadLetterTargetArn\": \"arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-dlq\", \"maxReceiveCount\": \"5\"}"
}
```

### Dead-letter queue

| Attributo | Valore | Perché |
| --- | --- | --- |
| `MessageRetentionPeriod` | 1209600 s (14 giorni, il massimo) | tempo per analizzare i messaggi falliti; deve essere più lunga di quella della coda ([sotto](#retention-perché-14-giorni-nella-dlq-e-4-nella-coda)) |
| `SqsManagedSseEnabled` | true | SSE-SQS |
| `RedriveAllowPolicy` | `byQueue`, solo dalla coda principale | solo questa coda può usarla come DLQ ([sotto](#redriveallowpolicy-cosa-fa-e-cosa-no)) |

File: [`config/sqs-notifications-dlq-attributes.json`](config/sqs-notifications-dlq-attributes.json)

```json
{
  "MessageRetentionPeriod": "1209600",
  "SqsManagedSseEnabled": "true",
  "RedriveAllowPolicy": "{\"redrivePermission\": \"byQueue\", \"sourceQueueArns\": [\"arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue\"]}"
}
```

`RedrivePolicy` e `RedriveAllowPolicy` sono **stringhe che contengono a loro volta un JSON**: è il formato che si
aspetta l'API di SQS.

### Cifratura: SSE-SQS e non `aws/sqs`

La coda è cifrata con **SSE-SQS**. Con la chiave KMS gestita da AWS `aws/sqs` SNS non potrebbe consegnarle i messaggi,
perché la key policy di quella chiave non ammette SNS e non si può modificare. In alternativa servirebbe una chiave KMS
del cliente con una key policy che ammetta `sns.amazonaws.com` ([kms.md](kms.md)).

### Perché 5 ricezioni e 180 secondi

- **Visibility timeout 180 s = 6 × 30 s**, il timeout della Mailer. È la raccomandazione AWS per le code lette da
  Lambda: il margine permette a Lambda di ritentare un batch quando la funzione è in throttling, senza che il messaggio
  torni visibile mentre è ancora in lavorazione. Il timeout della funzione non può superare il visibility timeout:
  Lambda lo controlla quando si crea l'event source mapping.
- **`maxReceiveCount` 5**, il minimo che AWS raccomanda per una coda letta da Lambda. Il contatore conta le
  **ricezioni**, non gli errori del nostro codice: anche un batch che il poller ha ricevuto ma non è riuscito a
  consegnare alla funzione (per esempio per throttling) consuma una ricezione. Con un valore basso un messaggio buono
  potrebbe finire nella DLQ solo perché Lambda era satura.

Cronologia di un messaggio che fallisce sempre (per esempio SES sospeso):

```text
t = 0 s     ricezione 1 → errore temporaneo → in batchItemFailures, invisibile per 180 s
t ≈ 180 s   ricezione 2 → errore → invisibile per 180 s
t ≈ 360 s   ricezione 3 → errore → invisibile per 180 s
t ≈ 540 s   ricezione 4 → errore → invisibile per 180 s
t ≈ 720 s   ricezione 5 → errore → invisibile per 180 s
t ≈ 900 s   il messaggio ha già 5 ricezioni: SQS lo sposta nella DLQ invece di consegnarlo
t ≈ 900-1200 s  l'allarme sulla DLQ (periodo 5 minuti) scatta → email al team
```

Un messaggio arriva quindi nella DLQ dopo circa 5 × 180 s ≈ **15 minuti**. In pratica può volerci qualche secondo in
più (i tempi di polling), e con `maxReceiveCount` maggiore di 3 SQS sposta in fondo alla coda i messaggi già ricevuti 3
volte, così non bloccano gli altri.

### Retention: perché 14 giorni nella DLQ e 4 nella coda

In una coda standard la scadenza di un messaggio si conta **dal momento in cui è entrato nella coda originale**, e lo
spostamento nella DLQ non la azzera. Se la DLQ avesse la stessa retention della coda, un messaggio arrivato in DLQ dopo
molto tempo in coda scadrebbe quasi subito. Per questo AWS consiglia una DLQ con retention più lunga: con 4 giorni di
coda e 14 di DLQ un messaggio resta analizzabile nella DLQ per almeno ~10 giorni (di solito quasi 14, perché arriva in
DLQ dopo circa 15 minuti).

Il redrive invece **azzera** il conteggio: i messaggi rimandati nella coda sono messaggi nuovi, con un nuovo
`messageId` e una nuova data di ingresso, e ripartono da zero ricezioni.

### Perché la DLQ sta sulla coda e non sulla Lambda

Lambda ha anche una sua DLQ e le *on-failure destination*, ma valgono per le **invocazioni asincrone** (per esempio la
notifica S3 verso la Files Lambda). Con l'event source mapping SQS l'invocazione è sincrona e i fallimenti li gestisce
la coda: AWS dice esplicitamente di configurare la DLQ sulla coda SQS e non sulla funzione. Le on-failure destination
degli event source mapping esistono solo per Kinesis, DynamoDB e Kafka, non per SQS.

### `RedriveAllowPolicy`: cosa fa e cosa no

- **Fa**: dice quali code possono usare `real-estate-prod-notifications-dlq` come dead-letter queue. Con `byQueue` e
  l'ARN della coda principale, nessun'altra coda può configurarla nella propria `RedrivePolicy`: la DLQ non si riempie
  di messaggi di altri.
- **Non fa**: non è un permesso IAM. Non dice chi può leggere la DLQ, chi può fare il redrive né verso dove: quello lo
  decidono le identity policy (per l'operatore, [`ops-dlq-redrive.json`](iam/policies/ops-dlq-redrive.json)).
  Non sposta nemmeno i messaggi: lo spostamento verso la DLQ lo fa la `RedrivePolicy` della coda principale.

## Ciclo di vita di un messaggio

1. Property, Users o Offers pubblicano un evento sul topic `real-estate-prod-notifications`, con `recipientSub` e i
   dati dell'email ([sns.md](sns.md#formato-degli-eventi)).
2. SNS lo consegna alla coda `real-estate-prod-notifications-queue` (ammesso dalla queue policy), senza busta
   (`RawMessageDelivery`).
3. Il poller dell'event source mapping lo riceve in un batch di al massimo 10: il messaggio diventa invisibile per
   180 s e la sua ricezione viene contata.
4. La Mailer chiede a Cognito l'email (`AdminGetUser`) e la invia con SES.
5. **Riuscito**, oppure **errore permanente** (loggato): il messaggio non è in `batchItemFailures` e l'event source
   mapping lo **cancella** dalla coda. Fine.
6. **Errore temporaneo**: il messaggio è in `batchItemFailures`, non viene cancellato e torna visibile dopo 180 s; si
   riparte dal passo 3.
7. Dopo **5 ricezioni** senza cancellazione (`maxReceiveCount`), SQS lo sposta nella DLQ
   `real-estate-prod-notifications-dlq`, circa 15 minuti dopo il primo tentativo.
8. L'allarme CloudWatch sulla DLQ scatta e pubblica sul topic `real-estate-prod-ops-alerts`, che manda un'email al team.
9. L'operatore guarda il messaggio, trova la causa nei log, la corregge e lo rimanda nella coda con il **redrive
   manuale** (`StartMessageMoveTask`): si riparte dal passo 3 come messaggio nuovo. Se il messaggio è da buttare, lo
   annota e lo cancella dalla DLQ.
10. Un messaggio lasciato nella DLQ scade dopo 14 giorni dal suo ingresso nella coda originale.

## Allarmi e chi li riceve

| Allarme | Metrica | Condizione | Cosa segnala |
| --- | --- | --- | --- |
| `real-estate-prod-notifications-dlq-not-empty` | `ApproximateNumberOfMessagesVisible` della DLQ | massimo > 0, periodo 5 min, 1 datapoint | almeno un'email non inviata dopo 5 ricezioni |
| età dei messaggi in coda | `ApproximateAgeOfOldestMessage` della coda principale | > 900 s (15 min), periodo 5 min | i messaggi si accumulano: la Mailer è ferma, in throttling o troppo lenta |

Entrambi notificano il topic SNS `real-estate-prod-ops-alerts`, con una sottoscrizione email del team. La
configurazione completa, con `TreatMissingData: notBreaching` (nessun dato = nessun problema), è in
[cloudwatch.md](cloudwatch.md#configurazione). Il secondo allarme vede i problemi che il primo vede tardi: se la Mailer
non viene proprio invocata, i messaggi invecchiano in coda prima di arrivare nella DLQ.

## Procedura operativa quando scatta l'allarme

1. **Guardare i messaggi nella DLQ**: in console, coda `real-estate-prod-notifications-dlq` → *Send and receive
   messages* → *Poll for messages*, oppure

   ```text
   aws sqs receive-message --queue-url <URL_DLQ> --max-number-of-messages 10 --attribute-names All --visibility-timeout 30
   ```

   Si annotano `MessageId`, il corpo (tipo di evento, `eventId`) e `ApproximateReceiveCount`. Leggere un messaggio lo
   rende invisibile per qualche secondo ma non lo toglie dalla DLQ.
2. **Cercare la causa nei log della Mailer** per `messageId` (o `eventId`), nel log group
   `/aws/lambda/real-estate-prod-mailer`, con Logs Insights o
   `aws logs filter-log-events --log-group-name /aws/lambda/real-estate-prod-mailer --filter-pattern '"<messageId>"'`.
3. **Correggere la causa**: per esempio SES in sandbox o con l'invio sospeso, quota superata, Cognito non disponibile,
   un bug nel modello dell'email (si pubblica una nuova versione della Mailer).
4. **Rimandare i messaggi nella coda principale con il redrive**: in console *Start DLQ redrive* → *Redrive to source
   queue(s)*, oppure

   ```text
   aws sqs start-message-move-task      --source-arn arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-dlq      --destination-arn arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue      --max-number-of-messages-per-second 1
   ```

   `MaxNumberOfMessagesPerSecond` basso (qui 1, come il limite della sandbox SES) evita di saturare SES con tutti i
   messaggi insieme. Lo stato si segue con `aws sqs list-message-move-tasks --source-arn <ARN_DLQ>` e un task si ferma
   con `cancel-message-move-task`. Un task dura al massimo 36 ore e non filtra né modifica i messaggi: si rimandano
   tutti.
5. **Se un messaggio è da buttare** (per esempio un evento malformato che nessuna correzione rende valido), lo si
   annota (corpo e motivo) e lo si cancella dalla DLQ con `aws sqs delete-message` e il suo `ReceiptHandle`, prima del
   redrive.

## IAM

### Queue policy: solo il nostro topic può scrivere

File: [`iam/resource-policies/sqs-notifications-queue-policy.json`](iam/resource-policies/sqs-notifications-queue-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowNotificationsTopicOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications"
        }
      }
    }
  ]
}
```

- Principal `sns.amazonaws.com`, azione `sqs:SendMessage` sulla sola coda.
- Condizione `ArnEquals aws:SourceArn` = ARN del topic `real-estate-prod-notifications`: nessun altro topic, nemmeno di
  un altro account, può scrivere nella coda (*confused deputy*).

### Chi legge

La Mailer, tramite l'event source mapping, con il **proprio ruolo**: `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
`sqs:GetQueueAttributes` sulla coda ([lambda-mailer.md](lambda-mailer.md#iam)). Sulla coda non serve altro.

### Chi fa il redrive: l'operatore

Il redrive lo avvia una persona del team, con una identity policy minima attaccata al suo ruolo o utente (non a un
servizio). I permessi sono quelli che AWS indica per il move task: sulla DLQ ricevere, cancellare e leggere gli
attributi, più le azioni del move task; sulla coda di destinazione solo `sqs:SendMessage`, perché il task, avviato con le
credenziali dell'operatore, scrive lì i messaggi. Con SSE-SQS non servono permessi KMS (servirebbero `kms:Decrypt` e
`kms:GenerateDataKey` con una chiave KMS).

File: [`iam/policies/ops-dlq-redrive.json`](iam/policies/ops-dlq-redrive.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InspectAndRedriveNotificationsDlq",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:StartMessageMoveTask",
        "sqs:ListMessageMoveTasks",
        "sqs:CancelMessageMoveTask",
        "sqs:ListDeadLetterSourceQueues"
      ],
      "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-dlq"
    },
    {
      "Sid": "SendRedrivenMessagesToNotificationsQueue",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications-queue"
    },
    {
      "Sid": "ReadMailerLogsToFindTheCause",
      "Effect": "Allow",
      "Action": "logs:FilterLogEvents",
      "Resource": "arn:aws:logs:eu-south-1:<ACCOUNT_ID>:log-group:/aws/lambda/real-estate-prod-mailer:*"
    }
  ]
}
```

- `InspectAndRedriveNotificationsDlq`: sulla sola DLQ, guardare i messaggi (`ReceiveMessage`, `GetQueueAttributes`),
  cancellare quelli da buttare (`DeleteMessage`), avviare, seguire e fermare il redrive (`StartMessageMoveTask`,
  `ListMessageMoveTasks`, `CancelMessageMoveTask`). `ListDeadLetterSourceQueues` serve alla console per proporre
  *Redrive to source queue(s)*.
- `SendRedrivenMessagesToNotificationsQueue`: `sqs:SendMessage` sulla sola coda principale. Non sulla DLQ né su altre
  code: l'operatore non può rimandare i messaggi altrove.
- `ReadMailerLogsToFindTheCause`: leggere i log della Mailer per trovare la causa (passo 2 della procedura).
- La queue policy della coda ammette solo SNS, ma operatore e coda sono nello **stesso account**: basta l'identity
  policy.

### Cosa non serve

Lo spostamento nella DLQ lo fa SQS secondo la `RedrivePolicy` (`deadLetterTargetArn`, `maxReceiveCount`): nessun
permesso IAM, e la Mailer non ha nessun permesso sulla DLQ.

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group, nessun endpoint (la Mailer è fuori dalla VPC).
- Cifratura a riposo SSE-SQS su coda e DLQ.

## Costi

Per richiesta, con un livello gratuito che basta al progetto.

## Riferimenti

- [Dead-letter queue (`maxReceiveCount`, retention dalla data di ingresso originale, `RedriveAllowPolicy`)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Redrive della DLQ (`StartMessageMoveTask`, permessi minimi, velocità, messaggi nuovi)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
- [Coda letta da Lambda: visibility timeout 6 volte il timeout, `maxReceiveCount` almeno 5](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- [Con SQS come event source la DLQ va sulla coda, non sulla funzione](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html)
- [Cifratura con code SQS sottoscritte](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)

## All'orale

> **Cos'è il visibility timeout e perché 180 secondi?**
> Il tempo in cui un messaggio preso da un consumer resta invisibile agli altri. 180 s sono 6 volte il timeout della
> Mailer, come consiglia AWS: un messaggio non torna in coda mentre è ancora in lavorazione.
>
> **A cosa serve la DLQ?**
> Dopo 5 ricezioni senza cancellazione il messaggio va da parte invece di ripetersi all'infinito; un allarme su "DLQ non
> vuota" manda un'email al team tramite il topic `real-estate-prod-ops-alerts`. È come la dead letter exchange di
> RabbitMQ.
>
> **Perché 5 e non 1 o 2?**
> AWS raccomanda almeno 5 per le code lette da Lambda: il contatore conta le ricezioni, anche quelle che non arrivano
> alla funzione per throttling. Con 1 un messaggio buono potrebbe finire nella DLQ al primo intoppo di Lambda.
>
> **Quanto ci mette un messaggio che fallisce sempre ad arrivare nella DLQ?**
> Circa 5 × 180 s, cioè un quarto d'ora; poi entro 5 minuti scatta l'allarme.
>
> **Perché la DLQ tiene 14 giorni e la coda 4?**
> Nelle code standard la scadenza si conta dall'ingresso nella coda originale, anche dopo lo spostamento. Con 14 giorni
> un messaggio resta in DLQ almeno una decina di giorni anche nel caso peggiore.
>
> **Perché la DLQ è sulla coda e non sulla Lambda?**
> La DLQ e le destination di Lambda valgono per le invocazioni asincrone. Con l'event source mapping SQS i fallimenti li
> gestisce la `RedrivePolicy` della coda, ed è AWS a dire di configurarla lì.
>
> **Scatta l'allarme: cosa fate?**
> Guardiamo i messaggi nella DLQ, cerchiamo il `messageId` nei log della Mailer, correggiamo la causa e li rimandiamo
> nella coda con il redrive (`StartMessageMoveTask`) a velocità bassa per non saturare SES. Quelli da buttare li
> annotiamo e li cancelliamo. L'operatore ha una policy apposta, `ops-dlq-redrive.json`.
>
> **Cosa fa `RedriveAllowPolicy`?**
> Dice quali code possono usare la DLQ come dead-letter queue: solo la nostra. Non è un permesso e non decide chi fa il
> redrive.
>
> **Chi sposta il messaggio nella DLQ? E chi lo rimette in coda?**
> Nella DLQ lo sposta SQS stesso, con la `RedrivePolicy`: nessun ruolo o permesso. Indietro lo rimanda un operatore
> con il redrive, con i permessi di `ops-dlq-redrive.json`.
>
> **Perché la queue policy ha `aws:SourceArn`?**
> Senza, qualunque topic SNS, anche di un altro account, potrebbe scrivere nella nostra coda.
>
> **Perché SSE-SQS e non la chiave `aws/sqs`?**
> La key policy di `aws/sqs` non ammette SNS e non si può modificare: SNS non consegnerebbe.
>
> **Perché il consumer deve essere idempotente?**
> La coda standard consegna almeno una volta: lo stesso messaggio può arrivare due volte. Per le email accettiamo un
> raro doppione; i batch parziali evitano quelli dovuti agli errori degli altri messaggi del batch.
