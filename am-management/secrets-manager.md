# Secrets Manager

## Secret applicativi

Creare un secret per ogni utente PostgreSQL utilizzato dal proxy. Nome proposto:
`real-estate/<ENVIRONMENT>/database/<DB_USER>`.

Il secret contiene almeno `username` e `password`, corrispondenti a un utente
esistente in Aurora. Salvare i valori direttamente in Secrets Manager tramite
un percorso di configurazione sicuro, senza inserirli nella repository.

Un secret non crea l'utente PostgreSQL e non gli assegna permessi SQL.
Il secret dell'utente master rimane distinto dai secret applicativi e non viene
associato al proxy per l'utilizzo ordinario delle Lambda.

## Policy di accesso e trust

Nella base prevista, tutte le risorse sono nello stesso account AWS:

- Il ruolo del proxy riceve `secretsmanager:GetSecretValue` sui secret necessari.
- Le Lambda applicative non leggono i secret: usano IAM verso il proxy.
- Non serve una resource policy aggiuntiva sul secret per concedere lo stesso
  accesso già autorizzato dalla identity policy, in assenza di altri vincoli.
- Il secret non assume ruoli: non ha una trust relationship da configurare.

## Cifratura KMS

Per la base si può utilizzare la chiave AWS gestita `aws/secretsmanager`.
Se viene scelta una chiave gestita dal cliente, aggiungere al ruolo del proxy
la policy opzionale `rds-proxy-decrypt-secrets.json` e verificare che anche
la key policy KMS consenta l'utilizzo previsto.

La policy opzionale limita `kms:Decrypt` alla chiave indicata e alle richieste
effettuate tramite Secrets Manager nella regione scelta. Non riguarda la chiave
di cifratura dello storage Aurora, che è una risorsa separata.

## Rotazione

La rotazione automatica degli utenti applicativi sarà configurata separatamente:
creare il secret non abilita da solo la rotazione. Se si utilizza una Lambda di
rotazione, serviranno un execution role dedicato, permessi sui secret e sulla
chiave KMS quando necessari, accesso di rete al DB e autorizzazione a invocare
la funzione per il servizio di rotazione.

## Riferimenti

- [Credenziali Secrets Manager per RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-secrets-arns.html)
- [Autorizzazioni per leggere i secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html)
