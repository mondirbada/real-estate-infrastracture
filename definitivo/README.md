# Real Estate Infrastructure — documentazione definitiva

Piattaforma immobiliare **serverless** su AWS, nella regione `eu-south-1` (Milano): i visitatori consultano gli
annunci, gli agenti pubblicano immobili con foto e video, gli acquirenti fanno offerte e ricevono notifiche via email.
Progetto di gruppo per l'esame di Servizi Cloud (ITS ICT Torino).

Questa cartella è la versione valida e completa della documentazione: un file per ogni servizio, ciascuno con i suoi
ruoli, policy, trust relationship, resource policy e configurazioni. I JSON stanno nelle cartelle `iam/` e `config/`
e sono mostrati anche dentro i file dei servizi. I documenti precedenti sono in
[`../archivio/`](../archivio/README.md) e servono solo come storia.

I JSON sono **template**: account, ID e ARN reali restano segnaposto `<...>` e si sostituiscono al provisioning.
La documentazione descrive la configurazione prevista: non attesta risorse già create in un account AWS.

## Diagramma

![Diagramma dell'infrastruttura](diagrammi/real-estate-v4.png)

Sorgente modificabile con draw.io: [`diagrammi/real-estate-v4.drawio`](diagrammi/real-estate-v4.drawio). La versione
precedente, [`real-estate-v3.drawio`](diagrammi/real-estate-v3.drawio), resta per confronto: la v4 sostituisce il
cluster Aurora con RDS for PostgreSQL Multi-AZ (primaria in AZ-1, standby in AZ-2). La v3 aveva aggiunto alla v2
l'access token verso l'API, la Mailer che chiede l'email a Cognito (`AdminGetUser`) e il ciclo completo della DLQ (5
ricezioni, allarme, topic `real-estate-prod-ops-alerts`, redrive manuale).
Legenda del diagramma: freccia piena = richiesta o dati; freccia tratteggiata = controllo, asincrono o "da verificare";
frecce blu numerate 1-5 = ordine del percorso dell'utente (1 scarica la SPA, 2 login e gestione account, 3 chiamate API
con l'access token, 4 upload con presigned POST, 5 lettura dei file pubblici); riquadro verde tratteggiato = security
group; icona del casco = ruolo IAM (execution role).

Nel diagramma le Lambda hanno il nome breve (Property Lambda = `real-estate-prod-property`); bucket, coda e DLQ hanno il
nome completo.

## Mappa dei file

| File | Di cosa parla |
| --- | --- |
| [00-architettura.md](00-architettura.md) | Visione d'insieme: componenti, flussi end-to-end numerati, scelte di fondo, ordine di creazione |
| [iam.md](iam.md) | IAM centrale: concetti, tutti i ruoli, tutte le resource policy, cosa non ha ruoli, deploy e `PassRole` |
| [decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md) | Le decisioni prese con il motivo, le alternative scartate e le domande ancora aperte |
| [cloudfront.md](cloudfront.md) | Le due distribuzioni (sito e file), OAC, regole SPA, HTTPS, header di sicurezza (CSP) |
| [s3.md](s3.md) | I due bucket privati, bucket policy, CORS, presigned POST, notifica `ObjectCreated` |
| [cognito.md](cognito.md) | User pool (email come attributo di accesso), gruppi, token, perché l'access token, furto del token, gestione dell'account dal frontend |
| [api-gateway.md](api-gateway.md) | HTTP API, authorizer JWT con l'access token, claim alle Lambda, route, CORS, permessi di invocazione delle Lambda, throttling |
| [lambda.md](lambda.md) | Regole comuni alle Lambda: execution role, VPC, connessione al DB, invocazione |
| [lambda-property.md](lambda-property.md) | Property Lambda: annunci immobiliari |
| [lambda-users.md](lambda-users.md) | Users Lambda: profilo utente nel database |
| [lambda-offers.md](lambda-offers.md) | Offers Lambda: offerte sugli immobili |
| [lambda-presigned.md](lambda-presigned.md) | Presigned Lambda: firma degli upload |
| [lambda-files.md](lambda-files.md) | Files Lambda: registrazione e cancellazione dei file |
| [lambda-mailer.md](lambda-mailer.md) | Mailer Lambda: email del destinatario da Cognito, invio con SES, batch parziali, errori temporanei e permanenti, fuori dalla VPC |
| [vpc.md](vpc.md) | VPC, subnet, route table, security group (tabella SG → SG) |
| [vpc-endpoints.md](vpc-endpoints.md) | Endpoint SNS, Secrets Manager e S3, Private DNS, endpoint policy |
| [rds-postgres.md](rds-postgres.md) | RDS for PostgreSQL Multi-AZ: primaria e standby, failover, backup, utenti PostgreSQL, dati personali (niente email) |
| [rds-proxy.md](rds-proxy.md) | RDS Proxy: pooling, autenticazione IAM delle Lambda, ruolo del proxy |
| [secrets-manager.md](secrets-manager.md) | Secret degli utenti PostgreSQL, letti solo dal proxy |
| [kms.md](kms.md) | Chiavi di cifratura usate dai servizi, perché SSE-SQS |
| [sns.md](sns.md) | Topic delle notifiche, formato degli eventi (`recipientSub`) |
| [sqs.md](sqs.md) | Coda delle notifiche e dead-letter queue: ciclo di vita di un messaggio, perché 5 e 180 s, allarmi, procedura di redrive |
| [ses.md](ses.md) | Invio delle email, sandbox |
| [cloudwatch.md](cloudwatch.md) | Log, metriche, metric filter e allarmi, topic `real-estate-prod-ops-alerts` verso il team |

JSON (ognuno è mostrato e spiegato nel file del servizio che lo usa; l'elenco completo è in [iam.md](iam.md#file-json)):

- `iam/trust-relationships/`: trust dei ruoli personalizzati (Lambda, RDS Proxy).
- `iam/policies/`: identity policy dei ruoli, la policy di deploy e quella dell'operatore per il redrive della DLQ.
- `iam/resource-policies/`: policy attaccate alle risorse (Lambda, bucket, coda, endpoint).
- `config/`: configurazioni non IAM (CORS, coda, DLQ, sottoscrizione, notifica S3, presigned POST, user pool e app
  client di Cognito, event source mapping della Mailer, allarme della DLQ, metric filter, event subscription di RDS).

## Ordine di studio consigliato

1. [00-architettura.md](00-architettura.md): prima il quadro, con i flussi.
2. La rete: [vpc.md](vpc.md), poi [vpc-endpoints.md](vpc-endpoints.md). Spiega perché alcuni servizi hanno security
   group e altri no.
3. Il percorso di una richiesta: [cloudfront.md](cloudfront.md), [s3.md](s3.md), [cognito.md](cognito.md),
   [api-gateway.md](api-gateway.md), [lambda.md](lambda.md) e le sei Lambda.
4. I dati: [rds-proxy.md](rds-proxy.md), [rds-postgres.md](rds-postgres.md), [secrets-manager.md](secrets-manager.md), [kms.md](kms.md).
5. Le notifiche: [sns.md](sns.md), [sqs.md](sqs.md), [ses.md](ses.md); poi [cloudwatch.md](cloudwatch.md).
6. [iam.md](iam.md) per ultimo e con calma: è la parte su cui il professore insiste. Ripassalo rifacendo ogni freccia
   del diagramma con la domanda "chi può fare cosa su quale risorsa, e perché?".
7. [decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md) prima dell'orale.

## Glossario minimo

| Termine | Significato |
| --- | --- |
| Regione / AZ | Area geografica (`eu-south-1` = Milano) / data center isolato dentro la regione. Due AZ = si sopravvive alla caduta di una |
| VPC, subnet | Rete privata isolata (`10.0.0.0/16`) / porzione della VPC legata a una sola AZ |
| Multi-AZ (RDS) | Deployment di RDS con una **primaria** attiva e una **standby** a riposo in un'altra AZ, replicata in modo sincrono; la standby non serve letture e subentra con il failover automatico |
| ENI | Scheda di rete virtuale dentro una subnet; i security group si attaccano alle ENI |
| Security group (SG) | Firewall *stateful* di una ENI, solo regole *allow* |
| Endpoint VPC | Accesso privato a un servizio AWS dalla VPC: *interface* (ENI, a pagamento) o *gateway* (rotta, gratuito, solo S3 e DynamoDB) |
| Serverless | Nessun server da gestire: si paga per uso e il servizio scala da solo |
| JWT | Token firmato `header.payload.firma`, verificabile con la chiave pubblica di chi lo emette (JWKS). Firmato, non cifrato: chi lo ha lo legge |
| Access token / ID token | Due JWT di Cognito. L'access token autorizza le chiamate alle API (va all'HTTP API); l'ID token dice al client chi è l'utente (resta nella SPA) |
| Bearer token | Token che vale per chiunque lo presenti, come una chiave: per questo va protetto e deve durare poco |
| `sub` | Identificativo opaco e stabile dell'utente in Cognito; nel database è la chiave dell'utente |
| ARN | Nome univoco di una risorsa: `arn:partition:servizio:regione:account:risorsa` |
| Principal | Chi agisce (un utente, un ruolo, un servizio AWS come `lambda.amazonaws.com`) |
| Ruolo IAM | Identità senza credenziali proprie: chi lo assume riceve credenziali temporanee da STS |
| Trust policy | Dice **chi** può assumere un ruolo |
| Identity policy | Dice **cosa** può fare l'identità a cui è attaccata |
| Resource policy | Attaccata a una risorsa, dice **chi** può usarla (bucket policy, queue policy, permesso di una Lambda) |
| OAC | Origin Access Control: CloudFront firma le richieste verso S3, che le accetta per bucket policy |
| Presigned POST | Modulo di upload firmato che permette al browser di caricare un file su S3 con i permessi di chi lo firma |
| DLQ | Dead-letter queue: coda dove finiscono i messaggi ricevuti troppe volte senza essere elaborati (`maxReceiveCount`) |
| Redrive | Rimandare i messaggi dalla DLQ alla coda di origine, una volta corretta la causa (`StartMessageMoveTask`) |
| Event source mapping | Risorsa di Lambda che legge a batch da una coda o da uno stream e invoca la funzione |
| Batch item failure | Risposta della Lambda che elenca i soli messaggi del batch da ritentare (`batchItemFailures`); gli altri vengono cancellati |
| Least privilege | Ogni componente ha solo i permessi che gli servono |
| Responsabilità condivisa | AWS protegge l'infrastruttura (data center, hypervisor); noi configurazione, IAM, dati e codice |
