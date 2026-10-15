# Aurora PostgreSQL

## Cluster su due AZ

Le due istanze dello schema rappresentano un solo cluster: un writer e una replica
in AZ diverse. Il proxy punta al cluster; non si duplicano utenti applicativi,
secret e ruoli IAM per ciascuna AZ. I dati e gli utenti PostgreSQL appartengono
al cluster.

## IAM e trust

Aurora utilizza il service-linked role `AWSServiceRoleForRDS`, con la policy
AWS `AmazonRDSServiceRolePolicy` e trust verso `rds.amazonaws.com`.
Il ruolo è gestito da AWS: verificare che esista o che possa essere creato durante
il provisioning. Non creare una copia personalizzata della sua policy o della trust.

Il ruolo `rds-proxy-secrets-role` va associato al proxy, non alle due istanze Aurora.

## Accesso al database

In questa configurazione il proxy utilizza la password dell'utente PostgreSQL
contenuta nel relativo secret. Non serve concedere `rds-db:connect` al ruolo del
proxy, né assegnare `rds_iam` agli utenti PostgreSQL che il proxy usa con password.
In PostgreSQL il ruolo `rds_iam` cambia la modalità di autenticazione: non va
aggiunto indiscriminatamente agli utenti applicativi di questo modello.

Creare utenti applicativi distinti dove gli ambiti richiedono autorizzazioni diverse.
Definire con SQL i permessi su database, schemi, tabelle e sequenze, compresi quelli
sugli oggetti futuri quando necessari. IAM non sostituisce questi `GRANT`.

Il ruolo di servizio AWS non concede automaticamente alle Lambda accesso ai dati.
Eventuali integrazioni aggiuntive, come Enhanced Monitoring o accesso Aurora a S3,
richiederanno una valutazione separata dei ruoli necessari.

## Riferimenti

- [Service-linked role Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html)
- [Configurazione degli utenti PostgreSQL per IAM](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)
