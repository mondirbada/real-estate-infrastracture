# SNS — topic `real-estate-prod-notifications`

SNS è un servizio *publish/subscribe*: chi produce pubblica un messaggio su un **topic**, e SNS ne consegna una copia a
ogni sottoscrittore. Le Lambda Property, Users e Offers pubblicano qui gli eventi da notificare; l'unico sottoscrittore
oggi è la coda SQS delle notifiche.

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Pubblicano | [Property](lambda-property.md), [Users](lambda-users.md), [Offers](lambda-offers.md) | `sns:Publish` tramite l'[interface endpoint SNS](vpc-endpoints.md) | identity policy dei ruoli; security group ed endpoint policy dell'endpoint |
| Consegna a | [SQS](sqs.md), coda `real-estate-prod-notifications-queue` | sottoscrizione | queue policy della coda |

Catena completa: Lambda → SNS → SQS (+ DLQ) → [Mailer Lambda](lambda-mailer.md) → [Cognito](cognito.md) per l'email
del destinatario → [SES](ses.md).

Il progetto ha anche un secondo topic, `real-estate-prod-ops-alerts`, su cui pubblicano solo gli allarmi CloudWatch e
che manda email al team: è descritto in [cloudwatch.md](cloudwatch.md#topic-real-estate-prod-ops-alerts).

## Perché SNS + SQS

- **SQS** dà buffer e retry: la richiesta dell'utente non aspetta l'invio dell'email, e se SES è lento o non disponibile
  i messaggi restano in coda.
- **SNS** davanti alla coda permette in futuro di aggiungere altri consumer (altri canali di notifica, come SMS o push)
  senza modificare le Lambda che pubblicano (*fan-out*).
- Alternative: solo SQS (più semplice, va bene se il canale resterà uno); EventBridge (bus di eventi con regole di
  filtro, non usato: [decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#alternative-considerate-e-non-adottate)).

## Configurazione

| Voce | Valore |
| --- | --- |
| Topic | `real-estate-prod-notifications` (standard) |
| Sottoscrizione | protocollo SQS, coda `real-estate-prod-notifications-queue` |
| Raw message delivery | attivo |

Attributi della sottoscrizione: con `RawMessageDelivery` la Mailer riceve il messaggio così come è stato pubblicato,
senza la busta JSON di SNS.

File: [`config/sns-subscription-attributes.json`](config/sns-subscription-attributes.json)

```json
{
  "RawMessageDelivery": "true"
}
```

### Formato degli eventi

Il messaggio pubblicato contiene il **destinatario come `recipientSub`** (il `sub` di Cognito) e i dati che servono a
comporre l'email, **non l'indirizzo email**. Tipi di evento: nuova offerta su un immobile, offerta accettata o
rifiutata, offerta ritirata per la cancellazione di un account (`OFFER_WITHDRAWN`, pubblicato dalla Users Lambda:
[lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)), benvenuto a un nuovo utente.

```json
{
  "eventId": "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  "type": "OFFER_CREATED",
  "recipientSub": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
  "occurredAt": "2026-10-22T10:15:00Z",
  "data": {
    "propertyId": "1042",
    "propertyTitle": "Trilocale in centro",
    "offerId": "5531",
    "amount": 250000
  }
}
```

- `recipientSub`: per una nuova offerta è il `owner_id` dell'immobile, per l'esito è il `sub` di chi ha fatto l'offerta,
  per l'offerta ritirata l'altra parte rispetto a chi ha cancellato l'account, per il benvenuto il `sub` del nuovo
  utente. Le Lambda lo prendono dal database o dai claim, mai dal body.
- `eventId`: identifica l'evento nei log della Mailer, insieme al `messageId` di SQS.
- La Mailer non ha bisogno del database: l'indirizzo lo legge da Cognito con `AdminGetUser`
  ([lambda-mailer.md](lambda-mailer.md#da-dove-arriva-lemail)).
- Nessun dato personale nel messaggio: se un evento finisce nella DLQ o in un log, non espone l'email di nessuno.

## IAM

| Passaggio | Meccanismo | File |
| --- | --- | --- |
| Lambda → SNS | identity policy: `sns:Publish` sul topic, solo per Property, Users e Offers | [`lambda-property.json`](iam/policies/lambda-property.json), [`lambda-users.json`](iam/policies/lambda-users.json), [`lambda-offers.json`](iam/policies/lambda-offers.json) |
| Lambda → endpoint SNS | security group dell'endpoint (443 da `sg-lambda-internal`); endpoint policy facoltativa | [`vpc-endpoint-sns-policy.json`](iam/resource-policies/vpc-endpoint-sns-policy.json), spiegata in [vpc-endpoints.md](vpc-endpoints.md#iam) |
| SNS → SQS | queue policy: principal `sns.amazonaws.com`, `sqs:SendMessage`, condizione `aws:SourceArn` = topic | [`sqs-notifications-queue-policy.json`](iam/resource-policies/sqs-notifications-queue-policy.json), spiegata in [sqs.md](sqs.md#iam) |

Il **topic non ha bisogno di una policy aggiuntiva**: quella di default permette di pubblicare alle identità del nostro
account, e il filtro vero lo fanno le identity policy delle Lambda (Presigned, Files e Mailer non hanno `sns:Publish`).

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group sul topic.
- Le Lambda nella VPC lo raggiungono solo tramite l'interface endpoint con Private DNS.
- La coda di destinazione usa SSE-SQS, perché SNS non consegna a una coda cifrata con `aws/sqs` ([kms.md](kms.md)).

## Costi

Per richiesta di pubblicazione e consegna: con i volumi del progetto, trascurabile. L'interface endpoint invece ha un
costo orario per AZ ([vpc-endpoints.md](vpc-endpoints.md#costi)).

## Riferimenti

- [SNS verso SQS](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html)
- [Cifratura con code SQS sottoscritte](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)

## All'orale

> **Differenza tra SNS, SQS ed EventBridge?**
> SNS fa *push* a più sottoscrittori; SQS è una coda da cui il consumer *tira* i messaggi; EventBridge è un bus con
> regole di filtro su pattern.
>
> **Perché SNS davanti a SQS se c'è un solo consumer?**
> Per poter aggiungere altri canali senza toccare le Lambda che pubblicano. È come pubblicare un evento con
> `ApplicationEventPublisher` in Spring: chi lo emette non sa chi lo ascolta.
>
> **Come pubblicano le Lambda se sono in una VPC senza Internet?**
> Tramite l'interface endpoint SNS con Private DNS, autorizzate da `sns:Publish` nel loro ruolo.
>
> **Perché il topic non ha una policy?**
> Quella di default ammette già le identità del nostro account; chi può pubblicare lo decidono le identity policy.
>
> **Cosa c'è dentro un evento di notifica?**
> Il tipo, il `recipientSub` del destinatario e i dati dell'offerta o dell'immobile. Non l'email: la Mailer la chiede a
> Cognito al momento dell'invio, così è sempre aggiornata e non resta copiata in code e log.
>
> **Cos'è `RawMessageDelivery`?**
> La coda riceve il messaggio originale invece della busta JSON di SNS, così la Mailer non deve spacchettarlo.
