// 3.3 Dalla Lambda al database — la catena Lambda → RDS Proxy → RDS PostgreSQL, con i due tratti autenticati in modo diverso.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, tabella, dopoTabella, figura } = S;

  return [
  h2("3.3 Dalla Lambda al database"),
  p("Cinque Lambda su sei usano il database: Property, Users, Offers, Presigned e Files. Il problema è doppio: ogni istanza di una Lambda apre la propria connessione, e con molte invocazioni concorrenti si arriva al limite di PostgreSQL; e collegarsi richiede credenziali, che non vogliamo nel codice. La soluzione è mettere tra le Lambda e il database `real-estate-prod-db` (Amazon RDS for PostgreSQL) l'**RDS Proxy** `real-estate-prod-db-proxy`, che tiene poche connessioni stabili verso il database e ci smista quelle brevi delle Lambda. I due tratti della catena **non si autenticano allo stesso modo**: le Lambda entrano nel proxy con un token IAM, il proxy entra nel database con la password dell'utente PostgreSQL, che legge da Secrets Manager con un ruolo suo."),
  ...figura(path.join(DIAGRAMMI, "database.png"), 3216, 1163,
    "Figura 3.3 — La catena Lambda → RDS Proxy → RDS PostgreSQL, con la lettura dei secret. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso"),
  ...elencoNumerato([
    "La Lambda genera con le credenziali temporanee del suo execution role un **token di autenticazione** per il proxy, legato al suo utente PostgreSQL. È una firma calcolata in locale, senza chiamate di rete, e vale 15 minuti.",
    "Apre una connessione PostgreSQL verso il proxy sulla porta 5432, su **TLS**, usando il token come password.",
    "Il proxy verifica il token con IAM e prende dal pool una connessione verso il database; se deve aprirne una nuova, usa la **password** letta dal secret `real-estate/prod/database/<DB_USER>`.",
    "La query arriva all'istanza **primaria**. Da lì decidono i `GRANT` dell'utente PostgreSQL.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["Lambda → RDS Proxy", "PostgreSQL 5432, TLS obbligatorio, token IAM come password", "`rds-db:connect` su una sola coppia proxy/utente nell'execution role"],
      ["RDS Proxy → Secrets Manager", "`GetSecretValue` via HTTPS", "ruolo `real-estate-prod-rds-proxy-secrets-role`, assunto dal servizio RDS"],
      ["Secrets Manager → KMS", "decifratura del secret", "key policy della chiave gestita `aws/secretsmanager`"],
      ["RDS Proxy → RDS PostgreSQL", "PostgreSQL 5432, TLS, utente e password del secret", "credenziali PostgreSQL, poi i `GRANT`"],
    ],
    [2600, 3700, 3300],
  ),
  dopoTabella(),

  h3("Le autorizzazioni"),
  p("In questo flusso ci sono **due ruoli** e **due livelli di identità**: il ruolo della Lambda non sa nulla dei secret, il ruolo del proxy non ha `rds-db:connect`."),
  p("**Entrare nel proxy.** Ogni execution role delle cinque Lambda ha un permesso costruito su questo modello:"),
  ...codice(leggiJson("iam/policies/lambda-connect-proxy.json"), "iam/policies/lambda-connect-proxy.json"),
  punto("La risorsa è **una sola coppia** proxy/utente: la Offers può entrare solo come `offers_user`, la Files solo come `files_user`, e così via."),
  punto("`<PROXY_RESOURCE_ID>` è l'ID risorsa del proxy, quello che inizia con `prx-`, non il suo nome né il suo ARN."),
  punto("Sul proxy sono attive *Require IAM authentication* e *Require TLS*: una Lambda che provasse a entrare con una password, o in chiaro, verrebbe rifiutata."),
  p("**Leggere il secret.** Il proxy non ha credenziali proprie: usa un ruolo che il servizio RDS assume. La trust relationship lo dice:"),
  ...codice(leggiJson("iam/trust-relationships/rds-proxy.json"), "iam/trust-relationships/rds-proxy.json"),
  p("Solo il servizio RDS può assumere il ruolo; nessun utente e nessuna Lambda può indossarlo e leggere i secret al posto del proxy. La policy del ruolo permette una sola azione, sui soli secret applicativi:"),
  ...codice(leggiJson("iam/policies/rds-proxy-read-secrets.json"), "iam/policies/rds-proxy-read-secrets.json"),
  p("In `Resource` vanno gli ARN completi dei cinque secret applicativi, con il suffisso casuale che Secrets Manager aggiunge. Il secret dell'utente master non c'è: resta all'amministrazione e non è associato al proxy. Il secret è cifrato con la chiave gestita `aws/secretsmanager`, che Secrets Manager usa da sé quando il proxy lo chiede. Con una chiave del cliente, che oggi non usiamo, il ruolo avrebbe bisogno anche di questa policy (e la key policy dovrebbe ammetterlo):"),
  ...codice(leggiJson("iam/policies/rds-proxy-decrypt-secrets.json"), "iam/policies/rds-proxy-decrypt-secrets.json"),
  p("La condizione `kms:ViaService` permette di decifrare solo quando la richiesta arriva da Secrets Manager nella nostra regione: il ruolo non potrebbe usare la chiave chiamando KMS direttamente."),
  p("**Entrare nel database.** Qui IAM non c'è più: il proxy si presenta con utente e password del secret. Per questo agli utenti applicativi non si assegna il ruolo `rds_iam`, che li renderebbe inutilizzabili con la password. IAM decide chi entra nel proxy e con quale utente; i `GRANT` SQL decidono cosa quell'utente può fare sulle tabelle, e ogni Lambda ha il suo utente con i soli `GRANT` che le servono."),
  p("L'effetto della separazione è che **la password la vede solo il proxy**. Una Lambda compromessa potrebbe al massimo entrare nel proxy come il suo utente, con i suoi `GRANT`."),
  p("In rete i security group formano una catena, `sg-lambda-internal` → `sg-rds-proxy` → `sg-rds` sulla 5432, in cui ognuno accetta solo il precedente: le Lambda non raggiungono il database direttamente (vedi 4.2)."),

  h3("Quando qualcosa va storto"),
  p("Il database è **Multi-AZ**: la **primaria** in `eu-south-1a` serve le richieste, la **standby** in `eu-south-1b` ne riceve ogni scrittura in modo **sincrono** e non serve letture. Se la primaria cade, RDS promuove la standby sullo stesso endpoint DNS, in genere in uno o due minuti, senza perdere transazioni confermate. Il proxy tiene aperte le connessioni delle Lambda e si ricollega alla nuova primaria: l'interruzione percepita dovrebbe ridursi."),
  p("Gli altri guasti si riconoscono dal punto in cui si fermano. Un timeout all'apertura della connessione è un problema di rete o di security group. Un rifiuto dell'autenticazione è quasi sempre la risorsa di `rds-db:connect` sbagliata. Un target del proxy non disponibile vuol dire che il proxy non riesce a leggere il secret. Un `permission denied` sulle tabelle, a connessione riuscita, vuol dire che IAM ha fatto la sua parte e mancano i `GRANT`."),
  p("Resta da verificare se il proxy, in subnet senza Internet, abbia bisogno dell'interface endpoint di Secrets Manager: la documentazione non lo dice, quindi nel diagramma è tratteggiato e lo togliamo se il target risulta disponibile senza. Alcune operazioni SQL, infine, legano una connessione del pool a un solo client (*pinning*): il codice deve evitarle."),

  h3("Le scelte"),
  p("Con il traffico del progetto il proxy non è strettamente necessario: lo teniamo perché ci dà il pool condiviso, l'autenticazione IAM e un failover più breve. Tra proxy e database usiamo la password da Secrets Manager e non l'autenticazione IAM end-to-end, perché è la modalità più documentata e lascia la password a un solo componente. Un utente e un secret per Lambda portano il minimo privilegio anche dentro il database. Le alternative scartate sono nel capitolo 5."),
];
};
