# RDS Proxy

## Ruolo del proxy

Nome proposto: `real-estate-prod-rds-proxy-secrets-role`.

- Trust: [`rds-proxy.json`](trust-relationships/rds-proxy.json).
- Permessi: [`rds-proxy-read-secrets.json`](policies/rds-proxy-read-secrets.json).
- Se si usa una chiave KMS gestita dal cliente, aggiungere
  [`rds-proxy-decrypt-secrets.json`](policies/rds-proxy-decrypt-secrets.json).

Il servizio `rds.amazonaws.com` assume questo ruolo con `sts:AssumeRole`.
Il ruolo può recuperare il valore dei soli secret applicativi elencati nella policy.
Non riceve permessi di modifica o cancellazione dei secret, gestione del cluster
o amministrazione IAM.

Per più utenti, elencare gli ARN dei rispettivi secret in `Resource` e associare
gli stessi secret alla configurazione del proxy. Usare gli ARN completi, compreso
il suffisso generato da Secrets Manager.

## Accesso delle Lambda al proxy

Ogni Lambda che deve usare il DB mantiene il proprio execution role:

- Trust: [`lambda.json`](trust-relationships/lambda.json).
- Permesso aggiuntivo: [`lambda-connect-proxy.json`](policies/lambda-connect-proxy.json).

Il template concede `rds-db:connect` per una sola coppia proxy/utente PostgreSQL.
Sostituire `<PROXY_RESOURCE_ID>` con l'ID `prx-...`, non con il nome o l'ARN
ordinario del proxy e non con l'ID del cluster.
Adattare `<DB_USER>` per ogni execution role. Concedere accesso solo alle funzioni
che hanno effettivamente bisogno del database.

La policy di connessione si aggiunge ai permessi necessari alla funzione, come
logging e gestione delle interfacce di rete per l'esecuzione in VPC; non li sostituisce.
Le Lambda non devono assumere il ruolo del proxy e non ricevono `GetSecretValue`.

## Riferimenti

- [Ruolo, trust e accesso ai secret del proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-iam-setup.html)
- [Connessione al proxy e ARN IAM](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-connecting.html)
