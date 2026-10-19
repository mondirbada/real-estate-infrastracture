# SES — invio delle email

SES (Simple Email Service) invia le email delle notifiche. Lo chiama soltanto la Mailer Lambda, via API, da un unico
mittente verificato `<MAIL_FROM>`.

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Chiamato da | [Mailer Lambda](lambda-mailer.md) | API `SendEmail` (SDK), fuori dalla VPC | `ses:SendEmail` con condizione `ses:FromAddress` |
| Invia a | utenti | email | in sandbox solo indirizzi verificati |

Catena: [SNS](sns.md) → [SQS](sqs.md) → Mailer → SES.

## Concetti

- **Identità verificata**: un indirizzo email o un dominio (con DKIM, SPF, DMARC) da cui si può inviare.
- **Sandbox**: ogni account parte qui. Si possono inviare email solo a indirizzi verificati, al massimo 200 ogni 24 ore
  e 1 al secondo. Per l'uso reale si chiede l'accesso alla produzione.
- **Reputazione**: bounce e complaint vanno tenuti bassi. **Configuration set**: raggruppa le impostazioni di invio e
  gli eventi; non lo usiamo.

## Configurazione

| Voce | Valore |
| --- | --- |
| Regione | `eu-south-1` |
| Identità | il mittente `<MAIL_FROM>` o il suo dominio (con DKIM), verificati in `eu-south-1` |
| Modalità | API (quella che usa la Mailer). A Milano l'interfaccia **SMTP non è disponibile** |
| Stato dell'account | sandbox: per la demo basta, inviando a indirizzi verificati |

## IAM

Il permesso di inviare sta nella policy della Mailer, statement `SendEmailFromProjectAddressOnly` (l'altro statement
riguarda la coda, [lambda-mailer.md](lambda-mailer.md#iam)):

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

- Azione `ses:SendEmail`.
- Risorsa `arn:aws:ses:eu-south-1:<ACCOUNT_ID>:identity/*`: tutte le identità SES dell'account, perché in sandbox anche
  i destinatari sono identità verificate e la richiesta le coinvolge.
- Condizione `ses:FromAddress = <MAIL_FROM>`: si può inviare **solo** da quel mittente.
- Se si usasse un configuration set, servirebbe anche il suo ARN tra le risorse.

SES non ha ruoli né resource policy nel progetto.

## Sicurezza e rete

- Servizio regionale fuori dalla VPC; la Mailer lo raggiunge sulla rete di AWS senza endpoint.
- Un solo mittente autorizzato; nessun'altra Lambda ha `ses:SendEmail`.
- Cognito può usare SES per le email di verifica degli account, con le quote di default.

## Costi

Per email inviata, con prezzi molto bassi; in sandbox i volumi sono comunque limitati.

## Punti aperti

- Per un uso reale: richiesta di accesso alla produzione e verifica del dominio del mittente
  ([decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#sviluppi-futuri)).

## Riferimenti

- [Controllo degli accessi in SES](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html)
- [Endpoint di SES per regione (API sì, SMTP no a Milano)](https://docs.aws.amazon.com/general/latest/gr/ses.html)

## All'orale

> **Cos'è la sandbox di SES?**
> Lo stato iniziale dell'account: si invia solo a indirizzi verificati, massimo 200 email al giorno e 1 al secondo. Per
> la demo basta; in produzione si chiede l'uscita.
>
> **Perché la risorsa è `identity/*` e non solo il mittente?**
> In sandbox anche i destinatari sono identità verificate e rientrano nell'autorizzazione; il limite vero è la
> condizione `ses:FromAddress`.
>
> **SES funziona a Milano?**
> Sì via API, che è quella che usiamo; l'SMTP a Milano non c'è. In Spring sarebbe come usare l'SDK di SES invece di
> `JavaMailSender` configurato su un server SMTP.
>
> **Come rendete affidabile l'invio se SES è giù?**
> I messaggi restano in SQS e vengono ritentati; dopo 5 fallimenti vanno nella DLQ e scatta l'allarme.
