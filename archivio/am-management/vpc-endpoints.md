# Endpoint VPC e security group

La VPC non ha Internet Gateway né NAT: le Lambda e il proxy raggiungono i servizi AWS solo
tramite endpoint.

| Endpoint | Tipo | Usato da | Security group | Note |
| --- | --- | --- | --- | --- |
| `com.amazonaws.eu-south-1.sns` | Interface (ENI in subnet A e B) | Property, Users, Offers | `sg-endpoint-sns`: 443 da `sg-lambda-internal` | Private DNS attivo |
| `com.amazonaws.eu-south-1.secretsmanager` | Interface | RDS Proxy, se ne ha bisogno | `sg-endpoint-secrets-manager`: 443 da `sg-rds-proxy` | Da verificare alla creazione del proxy |
| `com.amazonaws.eu-south-1.s3` | Gateway (rotta nelle route table) | Files | Nessuno (i gateway endpoint non hanno SG) | Gratuito |

Il Private DNS degli interface endpoint richiede che la VPC abbia `enableDnsSupport` ed
`enableDnsHostnames` attivi. Così l'SDK chiama `sns.eu-south-1.amazonaws.com` come sempre, e il nome
si risolve sull'IP privato dell'endpoint.

## Endpoint policy (facoltativa)

Ogni endpoint può avere una policy che limita cosa passa da lì. Di default permette tutto, e i
permessi veri restano nelle identity policy. Per mostrare il least privilege anche sulla rete:
[`vpc-endpoint-sns-policy.json`](resource-policies/vpc-endpoint-sns-policy.json) permette solo
`sns:Publish` sul nostro topic e solo a identità del nostro account (`aws:PrincipalAccount`).
Nelle endpoint policy `Principal` va indicato, e `"*"` più la condizione è la forma usuale.

## Security group

| Security group | In entrata | In uscita |
| --- | --- | --- |
| `sg-lambda-internal` | nessuna regola | 5432 → `sg-rds-proxy`; 443 → `sg-endpoint-sns`; 443 → prefix list di S3 |
| `sg-rds-proxy` | 5432 da `sg-lambda-internal` | 5432 → `sg-rds`; 443 → `sg-endpoint-secrets-manager` |
| `sg-rds` | 5432 da `sg-rds-proxy` | nessuna regola |
| `sg-endpoint-sns` | 443 da `sg-lambda-internal` | nessuna regola |
| `sg-endpoint-secrets-manager` | 443 da `sg-rds-proxy` | nessuna regola |

Le regole usano come sorgente un altro security group, non un intervallo di IP: restano valide
anche quando le ENI cambiano indirizzo. I security group sono *stateful*, quindi la risposta torna
indietro da sola. Il traffico verso il gateway endpoint S3 esce verso la *prefix list* gestita di S3
(`pl-...`), perché non c'è un security group da indicare.

## Riferimenti

- [Interface endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)
- [Gateway endpoint per S3](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)
- [Endpoint policy](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)
