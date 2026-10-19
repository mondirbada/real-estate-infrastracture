# VPC — rete, subnet e security group

La VPC è la rete privata del progetto: contiene solo ciò che deve stare vicino al database (Aurora, RDS Proxy, le ENI
delle 5 Lambda di business e degli endpoint). Ha due subnet **private**, una per AZ, e nessun accesso a Internet: niente
subnet pubbliche, Internet Gateway né NAT. I servizi AWS si raggiungono con gli endpoint VPC.

## Collegamenti

| Dentro la VPC | File |
| --- | --- |
| Aurora (writer in A, reader in B) | [aurora.md](aurora.md) |
| RDS Proxy (subnet A e B) | [rds-proxy.md](rds-proxy.md) |
| ENI delle Lambda Property, Users, Offers, Presigned, Files | [lambda.md](lambda.md) |
| Interface endpoint SNS e Secrets Manager, gateway endpoint S3 | [vpc-endpoints.md](vpc-endpoints.md) |

Fuori dalla VPC, senza security group: CloudFront, S3, API Gateway, Cognito, SNS, SQS, SES, CloudWatch, Secrets Manager,
la Mailer Lambda. Si proteggono con IAM ([iam.md](iam.md)).

## Concetti

- **VPC**: rete privata isolata con un intervallo di indirizzi (CIDR).
- **Subnet**: porzione della VPC legata a **una sola AZ**. È "pubblica" solo se la sua route table ha una rotta
  `0.0.0.0/0` verso un **Internet Gateway**; altrimenti è privata.
- **Route table**: dove va il traffico per ogni destinazione.
- **Internet Gateway** (porta verso Internet, serve un IP pubblico) e **NAT Gateway** (sta in una subnet pubblica e fa
  uscire le risorse private verso Internet; costo orario più traffico, uno per AZ): **non li usiamo**.
- **ENI**: scheda di rete virtuale in una subnet.
- **Security group**: firewall **stateful** attaccato a una ENI, con sole regole *allow*. Una regola può avere come
  sorgente un altro security group.
- **Network ACL**: firewall *stateless* a livello di subnet, con allow e deny. Lasciamo quella di default.

## Configurazione

| Risorsa | Valore |
| --- | --- |
| VPC | `real-estate-prod-vpc`, `10.0.0.0/16`, `enableDnsSupport` ed `enableDnsHostnames` attivi (servono al Private DNS degli endpoint) |
| `private_subnet_A` | `10.0.1.0/24`, `eu-south-1a` (AZ-1) |
| `private_subnet_B` | `10.0.2.0/24`, `eu-south-1b` (AZ-2) |
| Route table | solo la rotta locale della VPC più la rotta verso il gateway endpoint S3 (prefix list di S3) |
| Internet Gateway, NAT, subnet pubbliche | nessuno |

- **Perché due subnet in due AZ**: il *DB subnet group* di Aurora e l'RDS Proxy richiedono subnet in almeno 2 AZ; e due
  AZ significano resistere alla caduta di un data center.
- **Perché `/24`**: il proxy vuole almeno 10 IP liberi per subnet, e altri ne usano le ENI delle Lambda e degli endpoint;
  le `/24` lasciano spazio.
- **Perché niente subnet pubbliche**: una subnet pubblica serve per NAT, load balancer o istanze con IP pubblico, che non
  abbiamo. Tutto il traffico utente entra da CloudFront e API Gateway, che stanno fuori dalla VPC. Se un giorno servisse
  un NAT, si aggiungerebbe una subnet pubblica per AZ.
- **Perché niente NAT**: non chiamiamo API esterne (niente Stripe o simili); il NAT sarebbe un costo fisso inutile. Una
  Lambda nella VPC non ha Internet nemmeno in una subnet pubblica, perché non ha IP pubblico.

## Security group

"A → B" significa: regola *inbound* su B con sorgente il security group di A, più l'*outbound* su A. I security group
sono **stateful**: la risposta di una connessione permessa torna indietro da sola. Le regole usano come sorgente un altro
security group e non un intervallo di IP, quindi restano valide quando le ENI cambiano indirizzo.

| Security group | Attaccato a | In entrata | In uscita |
| --- | --- | --- | --- |
| `sg-lambda-internal` | ENI delle 5 Lambda di business | nessuna regola | 5432 → `sg-rds-proxy`; 443 → `sg-endpoint-sns`; 443 → prefix list di S3 (gateway endpoint) |
| `sg-rds-proxy` | RDS Proxy | 5432 da `sg-lambda-internal` | 5432 → `sg-rds`; 443 → `sg-endpoint-secrets-manager` |
| `sg-rds` | istanze Aurora | 5432 da `sg-rds-proxy` | nessuna regola |
| `sg-endpoint-sns` | interface endpoint SNS | 443 da `sg-lambda-internal` | nessuna regola |
| `sg-endpoint-secrets-manager` | interface endpoint Secrets Manager | 443 da `sg-rds-proxy` | nessuna regola |

Catena SG → SG:

| Da | A | Porta | Perché |
| --- | --- | --- | --- |
| `sg-lambda-internal` | `sg-rds-proxy` | 5432 | le Lambda si collegano al proxy |
| `sg-rds-proxy` | `sg-rds` | 5432 | il proxy si collega ad Aurora |
| `sg-lambda-internal` | `sg-endpoint-sns` | 443 | Property, Users, Offers pubblicano su SNS |
| `sg-rds-proxy` | `sg-endpoint-secrets-manager` | 443 | il proxy legge i secret, se l'endpoint serve (lo usa il proxy, non le Lambda) |
| `sg-lambda-internal` | prefix list S3 (`pl-...`) | 443 | la Files cancella oggetti tramite il gateway endpoint, che non ha security group |

Le Lambda **non raggiungono Aurora direttamente**: `sg-rds` accetta solo il proxy.

## IAM

La rete non ha ruoli propri. Per creare le ENI nelle subnet le Lambda usano la policy gestita
`AWSLambdaVPCAccessExecutionRole` nel loro execution role ([lambda.md](lambda.md#policy-gestite-da-aws)); RDS usa il
suo service-linked role ([aurora.md](aurora.md#iam)).

## Costi

VPC, subnet, route table e security group sono gratuiti. Costano gli interface endpoint ([vpc-endpoints.md](vpc-endpoints.md#costi));
il NAT, che non usiamo, sarebbe un costo fisso orario più il traffico, per AZ.

## Punti aperti

- La regola `sg-rds-proxy` → `sg-endpoint-secrets-manager` esiste solo se l'endpoint di Secrets Manager serve davvero
  ([vpc-endpoints.md](vpc-endpoints.md#punti-aperti)).

## Riferimenti

- [Prerequisiti di rete di RDS Proxy (subnet, IP liberi)](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-network-prereqs.html)
- [Lambda in VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)

## All'orale

> **Perché il database sta in subnet private?**
> Non deve essere raggiungibile da Internet: ci arriva solo il proxy, e al proxy solo le Lambda. È come una rete Docker
> interna in cui il container del database non pubblica la porta sull'host.
>
> **Cosa rende pubblica una subnet?**
> Una rotta `0.0.0.0/0` verso un Internet Gateway nella sua route table. Le nostre non ce l'hanno.
>
> **Differenza tra security group e Network ACL?**
> Il security group è stateful e sta sulla ENI, con sole regole allow; la NACL è stateless, sta sulla subnet e ha allow e
> deny.
>
> **Si può mettere un security group su S3, SQS o API Gateway?**
> No: non hanno ENI nella nostra VPC. Si proteggono con IAM, cioè identity e resource policy.
>
> **Perché le regole usano altri security group e non IP?**
> Le ENI delle Lambda cambiano indirizzo; "accetta 5432 da `sg-lambda-internal`" resta vero comunque. È come nominare un
> servizio di Docker Compose invece del suo IP.
>
> **Perché due AZ?**
> Lo richiedono il subnet group di Aurora e il proxy, e così sopravviviamo alla caduta di una AZ.
