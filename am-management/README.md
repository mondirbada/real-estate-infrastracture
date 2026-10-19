# IAM, policy e trust relationship

Base per Aurora PostgreSQL, RDS Proxy e Secrets Manager, coerente con
[`updated.drawio`](../diagrams/updated.drawio).

## Architettura adottata

- Un cluster Aurora PostgreSQL: writer in una AZ e replica in un'altra AZ.
- RDS Proxy davanti al cluster, su subnet private in almeno due AZ.
- Le Lambda applicative si autenticano al proxy tramite IAM e TLS (token di autenticazione valido 15 minuti, richiesto con TLS).
- Il proxy si autentica ad Aurora con username e password letti da Secrets Manager.
- Un utente PostgreSQL e un secret per ogni ambito che richiede permessi distinti.
- L'utente master è riservato all'amministrazione, escluso dalle connessioni applicative.

```text
Lambda -- IAM + TLS --> RDS Proxy -- password + TLS --> Aurora PostgreSQL
                           |
                           +-- GetSecretValue --> Secrets Manager
```

Questo documento descrive la configurazione prevista; non attesta risorse già
create nell'account AWS. Il quadro generale è in [`architecture.md`](../architecture.md).
Gli altri ruoli e resource policy (API Gateway, S3/CloudFront, SNS/SQS, Mailer Lambda, Presigned Lambda)
sono in fase di definizione.

## Ruoli e responsabilità

| Componente | Ruolo | Permessi | Trust |
| --- | --- | --- | --- |
| Aurora | `AWSServiceRoleForRDS`, gestito da AWS | Policy di servizio gestita da AWS | Gestita da AWS, servizio RDS |
| RDS Proxy | `rds-proxy-secrets-role`, da creare | Lettura dei soli secret applicativi; decifratura KMS quando necessaria | `rds.amazonaws.com` |
| Lambda con accesso al DB | Execution role distinto per funzione | Connessione al proxy come utente PostgreSQL autorizzato | `lambda.amazonaws.com` |
| Secrets Manager | Nessun ruolo dedicato per la sola conservazione dei secret | Accesso concesso al ruolo del proxy | Non applicabile al secret |

La trust policy stabilisce **chi può assumere il ruolo**. La permissions policy
stabilisce **cosa può fare chi lo assume**. Sono documenti distinti.

## File

- [Aurora PostgreSQL](aurora.md)
- [RDS Proxy](rds-proxy.md)
- [Secrets Manager](secrets-manager.md)
- `trust-relationships/`: trust dei ruoli personalizzati.
- `policies/`: template delle permissions policy.

I JSON sono template: sostituire tutti i segnaposto `<...>` prima dell'uso.
La regione dello schema è `eu-south-1`; confermarla prima del provisioning.
Account ID, ARN dei secret e della chiave KMS, ID del proxy e utenti PostgreSQL
devono provenire dalle risorse effettive. Non inserire password nei file Git.

## Ordine di configurazione

1. Creare il cluster, writer e replica nelle due AZ e verificare il ruolo di servizio RDS.
2. Creare gli utenti PostgreSQL applicativi e assegnare i relativi `GRANT`.
3. Creare un secret per ciascun utente, con credenziali corrispondenti a quelle del DB.
4. Creare il ruolo del proxy con trust RDS e policy di lettura dei secret.
5. Creare il proxy, associare ruolo e secret, registrare il cluster come target;
   richiedere IAM per le connessioni client e TLS.
6. Inserire l'ID del proxy nelle policy degli execution role delle Lambda autorizzate.
7. Configurare il client PostgreSQL nelle Lambda per token IAM e TLS verso il proxy.

Per questo modello scegliere autenticazione del proxy basata su secret, con IAM
richiesto ai client; non scegliere `DefaultAuthScheme=IAM_AUTH`, che identifica
la diversa modalità IAM end-to-end.

I permessi di provisioning (`iam:PassRole`, creazione di ruoli, proxy, cluster e
secret) appartengono all'identità di deploy e non sono inclusi nei ruoli applicativi.

## Verifica prima dell'utilizzo

- Nessun segnaposto residuo nei JSON da applicare.
- Ogni Lambda può collegarsi solo con il proprio utente autorizzato.
- Il proxy può leggere solo i secret associati; le Lambda non possono leggerli.
- I `GRANT` PostgreSQL consentono solo le operazioni previste per ciascun ambito.
- Security group: Lambda verso proxy e proxy verso Aurora su TCP 5432;
  il percorso applicativo non prevede accesso diretto Lambda verso Aurora.
- Verificare una connessione e il comportamento durante il failover del writer.

Subnet, security group, permessi VPC e logging delle Lambda restano configurazioni
necessarie, da affiancare a questa base IAM.
