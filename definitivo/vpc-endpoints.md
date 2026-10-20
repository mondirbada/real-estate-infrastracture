# Endpoint VPC — SNS, Secrets Manager, S3

La VPC non ha Internet Gateway né NAT: le Lambda e il proxy raggiungono i servizi AWS solo tramite **endpoint VPC**
(AWS PrivateLink per gli *interface endpoint*). Il progetto ne ha tre: SNS e Secrets Manager (interface), S3 (gateway).

## Collegamenti

| Endpoint | Usato da | Verso |
| --- | --- | --- |
| Interface SNS | [Property](lambda-property.md), [Users](lambda-users.md), [Offers](lambda-offers.md) | [sns.md](sns.md) |
| Interface Secrets Manager | [RDS Proxy](rds-proxy.md), se ne ha bisogno | [secrets-manager.md](secrets-manager.md) |
| Gateway S3 | [Files Lambda](lambda-files.md), [Property Lambda](lambda-property.md) | [s3.md](s3.md) |

Rete e security group: [vpc.md](vpc.md).

## Tipi di endpoint

- **Gateway endpoint**: esiste solo per S3 e DynamoDB, è **gratuito**, funziona con una **rotta** nelle route table e
  **non ha security group**.
- **Interface endpoint**: una ENI con IP privato in ogni subnet scelta, con il suo security group; costa per ora e per
  AZ, più il traffico.

## Configurazione

| Endpoint | Tipo | Usato da | Security group | Note |
| --- | --- | --- | --- | --- |
| `com.amazonaws.eu-south-1.sns` | Interface (ENI in subnet A e B) | Property, Users, Offers | `sg-endpoint-sns`: 443 da `sg-lambda-internal` | Private DNS attivo |
| `com.amazonaws.eu-south-1.secretsmanager` | Interface | RDS Proxy, se ne ha bisogno | `sg-endpoint-secrets-manager`: 443 da `sg-rds-proxy` | Da verificare alla creazione del proxy |
| `com.amazonaws.eu-south-1.s3` | Gateway (rotta nelle route table delle due subnet) | Files, Property | nessuno (i gateway endpoint non hanno SG) | Gratuito |

- **Private DNS**: gli interface endpoint hanno il Private DNS attivo, che richiede `enableDnsSupport` ed
  `enableDnsHostnames` sulla VPC. Così l'SDK chiama `sns.eu-south-1.amazonaws.com` come sempre, e il nome si risolve
  sull'IP privato dell'endpoint: nessuna modifica al codice.
- **Gateway S3**: il traffico esce verso la *prefix list* gestita di S3 (`pl-...`), quindi `sg-lambda-internal` ha una
  regola 443 verso quella prefix list, non verso un security group.
- Gli endpoint stanno **dentro** la VPC, nelle subnet private (il gateway S3 si disegna sul bordo della VPC, legato alle
  route table).

### Endpoint che non servono

- **Cognito**: le Lambda non lo chiamano (l'authorizer valida i token da sé, l'account lo gestisce il frontend).
- **SQS e SES**: li usa solo la Mailer, che è fuori dalla VPC.
- **CloudWatch Logs e credenziali dei ruoli**: li gestisce il servizio Lambda, non la rete della funzione.
- **S3 per la Presigned**: la firma è locale. **S3 per la notifica verso la Files**: l'invocazione la fa il servizio Lambda.

## IAM

### Endpoint policy dell'endpoint SNS (facoltativa)

Ogni endpoint può avere una policy che limita cosa passa da lì. Di default permette tutto, e i permessi veri restano
nelle identity policy delle Lambda. Per mostrare il least privilege anche sulla rete, questa permette solo
`sns:Publish` sul nostro topic e solo a identità del nostro account:

File: [`iam/resource-policies/vpc-endpoint-sns-policy.json`](iam/resource-policies/vpc-endpoint-sns-policy.json)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishToProjectTopicFromThisAccountOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalAccount": "<ACCOUNT_ID>"
        }
      }
    }
  ]
}
```

- `"Principal": "*"` più la condizione `aws:PrincipalAccount` è la forma usuale: nelle endpoint policy il `Principal`
  va indicato.
- Anche con questa policy, una Lambda pubblica solo se il suo ruolo ha `sns:Publish` ([lambda.md](lambda.md#execution-role)).

L'endpoint di Secrets Manager e il gateway S3 usano la policy di default.

## Sicurezza e rete

| Passaggio | Controllo di rete | Controllo IAM |
| --- | --- | --- |
| Lambda → endpoint SNS | `sg-endpoint-sns`: 443 da `sg-lambda-internal` | `sns:Publish` nel ruolo; endpoint policy facoltativa |
| Proxy → endpoint Secrets Manager | `sg-endpoint-secrets-manager`: 443 da `sg-rds-proxy` | `secretsmanager:GetSecretValue` nel ruolo del proxy |
| Files, Property → gateway S3 | rotta nella route table, uscita 443 verso la prefix list | `s3:DeleteObject` nel ruolo della Files; `s3:ListBucket` e `s3:DeleteObject` nel ruolo della Property |

## Costi

Ogni interface endpoint costa per AZ: con 2 interface endpoint su 2 AZ sono 4 ENI fatturate, più il traffico. Il gateway
S3 è gratuito. È comunque meno di un NAT per AZ, che sarebbe l'alternativa.

## Punti aperti

- **Endpoint di Secrets Manager**: la documentazione AWS non dice se il proxy, in subnet senza Internet, ne abbia
  bisogno per leggere i secret (né le pagine sui prerequisiti di rete né quelle di troubleshooting del proxy). Resta nel
  piano e si verifica alla creazione: se il target del proxy risulta `AVAILABLE` senza endpoint, lo togliamo e
  risparmiamo ([decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#punti-aperti)).

## Riferimenti

- [Interface endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)
- [Gateway endpoint per S3](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)
- [Endpoint policy](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)

## All'orale

> **Differenza tra gateway endpoint e interface endpoint?**
> Il gateway (solo S3 e DynamoDB) è una rotta, gratuita, senza security group; l'interface è una ENI con IP privato e
> security group, a pagamento per AZ.
>
> **Come fa il codice a usare l'endpoint senza cambiare URL?**
> Con il Private DNS: `sns.eu-south-1.amazonaws.com` si risolve sull'IP privato dell'endpoint. È come un alias DNS
> interno di Docker Compose che punta al container giusto.
>
> **Perché non c'è un endpoint per Cognito, SQS o SES?**
> Le Lambda in VPC non chiamano Cognito; SQS e SES li usa solo la Mailer, che è fuori dalla VPC.
>
> **L'endpoint di Secrets Manager serve?**
> Non è documentato: lo teniamo e lo verifichiamo alla creazione del proxy. Se il proxy legge i secret senza, lo
> togliamo e risparmiamo.
>
> **Cosa fa l'endpoint policy?**
> Limita cosa passa dall'endpoint: solo `sns:Publish` sul nostro topic, da identità del nostro account. È facoltativa:
> i permessi veri sono nei ruoli.
