# KMS — chiavi di cifratura

KMS gestisce le chiavi con cui i servizi cifrano i dati a riposo. Nel progetto sta sullo sfondo: usiamo le chiavi
**gestite da AWS** o la cifratura gestita dal servizio, senza chiavi nostre. Conta soprattutto per due scelte: SSE-SQS
sulla coda e la policy facoltativa del proxy per una chiave del cliente.

## Collegamenti

| Servizio | Cifratura a riposo | File |
| --- | --- | --- |
| Aurora | KMS, chiave `aws/rds` (va scelta alla creazione del cluster) | [aurora.md](aurora.md) |
| Secrets Manager | KMS, chiave `aws/secretsmanager` | [secrets-manager.md](secrets-manager.md) |
| S3 (entrambi i bucket) | SSE-S3 | [s3.md](s3.md) |
| SQS (coda e DLQ) | SSE-SQS (`SqsManagedSseEnabled`) | [sqs.md](sqs.md) |

## Concetti

- **Chiavi gestite da AWS** (`aws/rds`, `aws/secretsmanager`, `aws/sqs`…): gratuite, create e gestite da AWS, con una
  key policy che non si può modificare.
- **Customer managed key (CMK)**: creata da noi, con key policy, rotazione e audit su CloudTrail; circa 1 $ al mese.
- **Envelope encryption**: KMS cifra una *data key*, la data key cifra i dati.
- **Key policy**: la resource policy di una chiave. Con KMS non basta l'identity policy: anche la key policy deve
  ammettere chi usa la chiave.
- SSE-S3 e SSE-SQS sono cifrature gestite interamente dal servizio, senza chiavi KMS da amministrare.

## Configurazione

### Perché la coda usa SSE-SQS e non `aws/sqs`

SNS **non riesce a consegnare** messaggi a una coda cifrata con la chiave gestita `aws/sqs`: la key policy di quella
chiave non ammette `sns.amazonaws.com` e non si può modificare. Per questo coda e DLQ usano **SSE-SQS**. In alternativa
servirebbe una CMK con una key policy che ammetta `sns.amazonaws.com`.

### Chiave del cliente per i secret (facoltativa)

Per la base si usa `aws/secretsmanager`, che autorizza già dalla sua key policy. Se si scegliesse una CMK, al ruolo del
proxy andrebbe aggiunta questa policy, e la key policy della CMK dovrebbe ammettere il ruolo:

File: [`iam/policies/rds-proxy-decrypt-secrets.json`](iam/policies/rds-proxy-decrypt-secrets.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DecryptSecretsWithCustomerManagedKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "<SECRETS_KMS_KEY_ARN>",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.eu-south-1.amazonaws.com"
        }
      }
    }
  ]
}
```

- `kms:Decrypt` solo sulla chiave indicata.
- Condizione `kms:ViaService = secretsmanager.eu-south-1.amazonaws.com`: il ruolo può decifrare **solo** tramite Secrets
  Manager nella nostra regione, non usare la chiave per altro.
- Non riguarda la chiave di cifratura dello storage Aurora, che è una risorsa separata.

## IAM

- Nessun ruolo: KMS è usato dai servizi per nostro conto.
- Nessuna key policy da scrivere finché usiamo chiavi gestite. Con CMK servirebbe ammettere il ruolo del proxy (secret)
  o `sns.amazonaws.com` (coda cifrata con CMK).
- Nello stesso account IAM di solito accetta l'identity policy **oppure** la resource policy; KMS è l'eccezione: serve
  che la key policy lo permetta.

## Sicurezza

Cifratura a riposo su tutti i dati persistenti (database, secret, file, messaggi); la cifratura in transito è TLS
ovunque ([00-architettura.md](00-architettura.md), [iam.md](iam.md)).

## Costi

Le chiavi gestite da AWS sono gratuite; una CMK costa circa 1 $ al mese più le richieste.

## Riferimenti

- [Cifratura con code SQS sottoscritte](https://docs.aws.amazon.com/sns/latest/dg/sns-enable-encryption-for-topic-sqs-queue-subscriptions.html)

## All'orale

> **Perché la coda è cifrata con SSE-SQS e non con la chiave KMS di default?**
> La key policy di `aws/sqs` non ammette SNS e non si modifica: SNS non riuscirebbe a consegnare. SSE-SQS cifra senza
> quel problema; l'alternativa sarebbe una CMK con una key policy per `sns.amazonaws.com`.
>
> **Cosa fa la condizione `kms:ViaService`?**
> Permette di usare la chiave solo attraverso Secrets Manager nella nostra regione, non direttamente.
>
> **Differenza tra chiave gestita da AWS e CMK?**
> La prima è gratuita e non si configura; la CMK ha una key policy nostra, rotazione e audit, e costa circa 1 $ al mese.
>
> **Con KMS basta l'identity policy?**
> No: anche la key policy deve permettere l'uso. È l'eccezione alla regola "nello stesso account basta una delle due".
>
> **Cos'è l'envelope encryption?**
> KMS cifra una chiave dati, e la chiave dati cifra i dati: la chiave master non esce mai da KMS.
