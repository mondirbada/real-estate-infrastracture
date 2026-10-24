// 6. Limiti e sviluppi possibili
module.exports = ({ S }) => {
  const { p, h1, h2, punto, tabella, dopoTabella } = S;
  return [
  h1("6. Limiti e sviluppi possibili"),
  p("Questo capitolo elenca ciò che abbiamo scelto di non risolvere, quanto costa far girare la piattaforma e cosa faremmo con più tempo."),

  h2("6.1 Rischi residui dichiarati"),
  tabella(
    ["Rischio", "Cosa significa", "Perché lo accettiamo"],
    [
      ["**Revoca dei token**", "l'authorizer JWT controlla firma, issuer, audience e scadenza ma non le revoche: un access token rubato resta valido verso l'API fino alla scadenza, al massimo un'ora, anche dopo il logout. Dopo la cancellazione dell'account vale solo per leggere: le scritture trovano `deleted_at` e ricevono 403", "difese a monte (token in memoria, CSP, HTTPS, durata breve, revoca del refresh token al logout); la soluzione completa, un BFF, è un componente sempre in mezzo a ogni chiamata"],
      ["**SES in sandbox**", "si può inviare solo a indirizzi verificati, al massimo 200 email ogni 24 ore e una al secondo; l'SMTP non è disponibile a Milano", "per la demo basta; la concorrenza massima della Mailer a 2 protegge già il limite"],
      ["**Una sola regione**", "tutto sta in `eu-south-1`: le due zone di disponibilità coprono la caduta di un data center, non quella dell'intera regione", "non è stata prevista una replica in un'altra regione; resta un limite dichiarato"],
      ["**Email doppie**", "la coda standard garantisce la consegna almeno una volta: raramente la stessa email può partire due volte; i batch parziali riducono il problema", "evitarlo richiederebbe un database nella Mailer"],
      ["**Dipendenza della Mailer da Cognito**", "se Cognito non risponde l'email non parte; il ruolo della Mailer può inoltre leggere gli utenti del pool", "i messaggi vengono ritentati e poi finiscono nella DLQ, dove non si perdono; il permesso è limitato al solo user pool"],
      ["**Cosa resta di un account cancellato**", "la riga `users` con il solo `sub`, gli immobili ritirati con i loro file su S3 (raggiungibili da chi ha già il link), le offerte ritirate o chiuse; nei backup di Aurora il profilo resta fino alla fine della retention", "nessuno di questi dati porta a una persona dopo `DeleteUser`; le foto sono della casa, non dell'utente"],
      ["**File pubblici per chi ha il link**", "foto e video degli annunci sono leggibili da chiunque conosca l'indirizzo", "è una scelta di prodotto per le foto degli annunci; per documenti privati servirebbero URL firmati"],
      ["**Nessun antivirus sui file caricati**", "un file caricato non viene analizzato", "limite di tipo e di dimensione nel presigned POST; scansione tra gli sviluppi"],
      ["**Configurazione mai provata**", "la documentazione descrive la configurazione prevista, nessuna risorsa è stata creata", "le prove reali (connessione al proxy, failover, CSP) sono il primo passo dopo il provisioning"],
    ],
    [2200, 4200, 3200],
  ),
  dopoTabella(),
  p("A questi si aggiungono i **punti da verificare** dei capitoli 4 e 5: l'endpoint di Secrets Manager per il proxy, il formato di `cognito:groups` nei claim, i domini della CSP, i valori di backup e retention di Aurora, le soglie degli allarmi di CPU e connessioni. Non sono rischi nascosti ma passi che si chiudono solo creando le risorse."),

  h2("6.2 I costi"),
  p("Non abbiamo ancora una stima con il Pricing Calculator, ed è uno degli sviluppi elencati sotto. Qualitativamente, il costo è dominato da pochi componenti sempre accesi, mentre quasi tutto il resto resta nel livello gratuito."),
  tabella(
    ["Voce", "Come si paga", "Peso"],
    [
      ["Aurora (writer e reader)", "istanze sempre accese, anche a vuoto", "**la voce più costosa**"],
      ["RDS Proxy", "in base alla capacità del database a cui è collegato, anche a vuoto", "tra le più costose, insieme ad Aurora"],
      ["Interface endpoint (SNS, Secrets Manager)", "costo orario per zona, più traffico: 2 endpoint su 2 zone sono 4 interfacce di rete fatturate", "medio; comunque meno di un NAT per zona. Il gateway S3 è gratuito"],
      ["Secrets Manager", "circa 0,40 $ al mese per secret (5 secret) più le chiamate", "basso"],
      ["Lambda, API Gateway, SQS, SNS, SES, Cognito, S3, CloudFront", "per richiesta o per uso", "livello gratuito o pochi centesimi con il traffico del progetto"],
      ["CloudWatch", "ingestione e conservazione dei log, metric filter, allarmi", "pochi centesimi"],
      ["Chiavi KMS gestite da AWS", "gratuite", "nullo (una chiave del cliente costerebbe circa 1 $ al mese più le richieste)"],
      ["VPC, sottoreti, security group", "gratuiti", "nullo"],
    ],
    [2800, 4200, 2600],
  ),
  dopoTabella(),
  p("Le scelte di fondo vanno nella direzione di tenere basso il costo fisso: niente NAT, Mailer fuori dalla VPC per non avere endpoint su SQS, SES e Cognito, endpoint solo per ciò che serve. Prima di creare risorse reali conviene impostare **AWS Budgets** con un allarme a 5-10 € e usare il Pricing Calculator; a fine prove si cancella ciò che costa anche a vuoto (Aurora, proxy, endpoint)."),

  h2("6.3 Evoluzioni possibili"),
  punto("**Backend For Frontend (BFF).** Un componente server che tiene i token e dà al browser solo un cookie `HttpOnly`, che JavaScript non può leggere: elimina il furto del token via XSS. È la risposta al rischio sulla revoca, al prezzo di un componente sempre in mezzo a ogni chiamata."),
  punto("**WAF davanti all'API.** AWS WAF non si associa direttamente a un'HTTP API, ma si può associare a CloudFront: mettendo una distribuzione davanti all'API si avrebbero rate limiting e regole contro gli attacchi comuni."),
  punto("**Altri canali di notifica.** SNS è stato messo davanti a SQS proprio per questo: SMS o notifiche push sarebbero nuovi sottoscrittori del topic, senza modificare le Lambda che pubblicano."),
  punto("**SES in produzione.** Uscire dalla sandbox e verificare il dominio del mittente con DKIM."),
  punto("**Distribuire le letture.** Un endpoint di sola lettura dell'RDS Proxy permetterebbe di usare davvero la reader di Aurora, oggi solo di riserva; Aurora Serverless v2 pagherebbe solo la capacità usata."),
  punto("**Rotazione automatica dei secret** con una Lambda di rotazione."),
  punto("**Infrastructure as Code** (CloudFormation, Terraform o CDK): come un `docker-compose.yml`, ma per tutta l'infrastruttura AWS. Con essa, **ambienti separati** (oggi esiste solo `prod`)."),
  punto("**Scansione antivirus** dei file caricati, **modello dati** e politica di backup, **dominio personalizzato** con certificato ACM in `us-east-1`."),
  punto("**Pulizia dei file degli immobili ritirati** con la stessa logica della cancellazione di un immobile della Property Lambda (4.4), per esempio lanciata dall'`admin`: oggi restano su S3 con l'immobile."),
  punto("**File privati** (contratti, documenti d'identità): si passerebbe a URL firmati di CloudFront o a presigned GET generati da una Lambda."),
  ];
};
