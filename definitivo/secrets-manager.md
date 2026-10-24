# Secrets Manager — credenziali del database

Secrets Manager custodisce, cifrate con KMS e versionate, le credenziali degli utenti PostgreSQL applicativi: un secret
per utente. Le legge **solo il ruolo dell'RDS Proxy**; le Lambda non le leggono mai.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| Letto da | [RDS Proxy](rds-proxy.md) | `secretsmanager:GetSecretValue` con il ruolo `real-estate-prod-rds-proxy-secrets-role`, eventualmente tramite l'[interface endpoint](vpc-endpoints.md) |
| **Non** letto da | le Lambda | entrano nel proxy con IAM |
| Cifrato con | [KMS](kms.md) | chiave `aws/secretsmanager` |
| Corrisponde a | [RDS for PostgreSQL](rds-postgres.md#utenti-postgresql) | utenti PostgreSQL esistenti |

## Cos'è

- **Secret**: un JSON cifrato con KMS, qui `{"username": "...", "password": "..."}`, il formato atteso dal proxy.
- **Versioni**: `AWSCURRENT`, `AWSPREVIOUS`, che permettono la rotazione senza interruzioni.
- **Rotazione**: una Lambda di rotazione cambia la password nel database e nel secret secondo una schedule; per RDS ci
  sono template pronti. RDS può anche gestire da sola la password master in Secrets Manager.
- **Resource policy** sul secret: facoltativa, serve per accessi cross-account.
- Alternativa più economica per valori semplici: SSM Parameter Store.

## Configurazione

- Un secret per ogni utente PostgreSQL usato dal proxy: `real-estate/<ENVIRONMENT>/database/<DB_USER>`, cioè
  `real-estate/prod/database/property_user`, `.../users_user`, `.../offers_user`, `.../files_user`,
  `.../presigned_user`.
- Ogni secret contiene almeno `username` e `password`, corrispondenti a un utente esistente nel database.
- I valori si inseriscono direttamente in Secrets Manager con un percorso di configurazione sicuro: **mai nella
  repository**.
- Un secret non crea l'utente PostgreSQL e non gli assegna permessi SQL.
- Il secret dell'utente master resta distinto e non è associato al proxy per l'uso ordinario delle Lambda.
- Cifratura con la chiave AWS gestita `aws/secretsmanager`.

## IAM

File: [`iam/policies/rds-proxy-read-secrets.json`](iam/policies/rds-proxy-read-secrets.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApplicationDatabaseSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": ["<APPLICATION_SECRET_ARN>"]
    }
  ]
}
```

Tutte le risorse sono nello stesso account:

- Il ruolo del proxy riceve `secretsmanager:GetSecretValue` sui soli secret necessari, con gli ARN completi (suffisso
  compreso); spiegazione completa in [rds-proxy.md](rds-proxy.md#ruolo-del-proxy-real-estate-prod-rds-proxy-secrets-role).
- Le Lambda applicative non leggono i secret: usano IAM verso il proxy.
- **Nessuna resource policy** sul secret: nello stesso account basta l'identity policy del ruolo, in assenza di altri
  vincoli.
- Il secret **non assume ruoli**: non ha una trust relationship.
- Con una chiave KMS del cliente servirebbe anche `kms:Decrypt` per il proxy e una key policy che lo ammetta
  ([kms.md](kms.md)).

### Rotazione

La rotazione automatica non si attiva da sola creando il secret: va configurata a parte. Con una Lambda di rotazione
servirebbero un execution role dedicato, permessi sui secret e sulla chiave KMS quando necessari, accesso di rete al
database e l'autorizzazione del servizio di rotazione a invocare la funzione. Per il progetto non è configurata.

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group sul servizio; l'eventuale interface endpoint ha
  `sg-endpoint-secrets-manager` (443 da `sg-rds-proxy`).
- Nessuna password nel codice, nelle variabili d'ambiente o in Git.

## Costi

Per secret al mese (circa 0,40 $ ciascuno, quindi 5 secret) più le chiamate API. L'interface endpoint, se resta, costa
per AZ.

## Punti aperti

- Serve l'interface endpoint perché il proxy legga i secret? Da verificare alla creazione del proxy
  ([vpc-endpoints.md](vpc-endpoints.md#punti-aperti)).
- Alternativa che eliminerebbe i secret: IAM end-to-end sul proxy
  ([decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#alternative-considerate-e-non-adottate)).

## Riferimenti

- [Credenziali Secrets Manager per RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-secrets-arns.html)
- [Autorizzazioni per leggere i secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html)

## All'orale

> **Chi legge il secret e perché non le Lambda?**
> Solo il ruolo del proxy. Le Lambda entrano con un token IAM: niente password nel loro codice, e se una Lambda venisse
> compromessa non avrebbe la password del database.
>
> **Che differenza c'è con un file `.env`?**
> Il secret è cifrato con KMS, versionato, ruotabile e accessibile solo a chi ha il permesso IAM; non finisce mai nel
> repository o nell'immagine Docker. È l'equivalente gestito di Spring Cloud Vault.
>
> **Serve una resource policy sul secret?**
> No: siamo nello stesso account e basta l'identity policy del ruolo del proxy. Servirebbe per l'accesso cross-account.
>
> **Il secret crea l'utente nel database?**
> No. L'utente e i suoi `GRANT` si creano in PostgreSQL; il secret ne contiene solo le credenziali.
>
> **Secrets Manager o Parameter Store?**
> Secrets Manager ha rotazione e integrazione con RDS Proxy; Parameter Store costa meno per valori semplici.
>
> **Una Lambda non riesce a leggere un secret: cause?**
> Nel nostro modello è voluto. In generale: policy mancante o ARN sbagliato (senza suffisso), chiave KMS che non ammette
> il ruolo, ruolo sbagliato, rete senza accesso a Secrets Manager.
