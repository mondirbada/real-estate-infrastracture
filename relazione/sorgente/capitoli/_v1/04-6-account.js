// 4.6 Gestione e cancellazione dell'account — operazioni su Cognito dal frontend, ordine della cancellazione.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;

  const deleteUser = `import { CognitoIdentityProviderClient, DeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({ region: "eu-south-1" });
// Nessuna credenziale AWS: l'unica prova è l'access token dell'utente.
await cognito.send(new DeleteUserCommand({ AccessToken: accessToken }));`;

  // Identica a lambda-users.md (sezione "Cancellazione dell'account: anonimizzazione").
  const transazione = `BEGIN;

-- 1. Il profilo: resta il solo sub, segnato come cancellato.
UPDATE users
   SET display_name = NULL,
       phone        = NULL,
       bio          = NULL,
       deleted_at   = COALESCE(deleted_at, now())
 WHERE sub = :sub;

-- 2. Gli immobili dell'utente: restano, ma ritirati.
UPDATE properties
   SET status = 'withdrawn'
 WHERE owner_id = :sub
   AND status = 'active';

-- 3. Le offerte in sospeso, fatte da lui o ricevute sui suoi immobili: ritirate.
UPDATE offers o
   SET status = 'withdrawn'
  FROM properties p
 WHERE p.id = o.property_id
   AND o.status = 'pending'
   AND (o.buyer_id = :sub OR p.owner_id = :sub)
RETURNING o.id, o.property_id, o.buyer_id, p.owner_id, p.title, o.amount;

COMMIT;`;

  // Identici ad aurora.md (sezione "Utenti PostgreSQL").
  const grant = `-- La Users Lambda: il proprio profilo, più lo stato di immobili e offerte per ritirarli.
GRANT SELECT, INSERT, UPDATE ON users TO users_user;
GRANT SELECT (id, owner_id, status, title) ON properties TO users_user;
GRANT UPDATE (status) ON properties TO users_user;
GRANT SELECT (id, property_id, buyer_id, status, amount) ON offers TO users_user;
GRANT UPDATE (status) ON offers TO users_user;

-- Le altre Lambda: solo leggere se l'utente della richiesta è ancora attivo.
GRANT SELECT (sub, deleted_at) ON users TO property_user, offers_user, presigned_user, files_user;`;

  // Identica ad api-gateway.md (sezione "Authorizer JWT").
  const requireActiveUser = `// Rifiuta le scritture di chi ha già cancellato l'account (token emesso prima, ancora valido fino a 60 minuti).
export async function requireActiveUser(db, user) {
  const { rows } = await db.query("SELECT deleted_at FROM users WHERE sub = $1", [user.sub]);
  if (rows.length > 0 && rows[0].deleted_at !== null) {
    throw new ForbiddenError("account cancellato"); // 403
  }
  return user;
}`;

  return [
  h2("4.6 Gestione e cancellazione dell'account"),
  p("Cambiare email o password e cancellare l'account sono operazioni sull'**identità** dell'utente, e l'identità sta in Cognito. Per questo le fa la **SPA direttamente con Cognito**, chiamando le sue API pubbliche con l'access token dell'utente, senza passare dalle nostre Lambda. L'unica eccezione sono i dati applicativi nel database, che si **anonimizzano** con una chiamata alla nostra API, `DELETE /users/me`, prima di cancellare l'account."),
  p("La ragione è di rete prima ancora che di design. Le Lambda di business stanno in una VPC **senza accesso a Internet** e senza un endpoint per Cognito: non possono raggiungerlo. E non serve che lo facciano: Cognito ha API pensate proprio perché sia l'utente a gestire il proprio account, autorizzate dal suo token invece che da IAM. È come in un'applicazione Spring con Keycloak, dove il cambio password lo fa la pagina *account* di Keycloak e non un controller nostro."),
  p("La cancellazione è la parte delicata: tocca due sistemi, Cognito e il database, che non condividono una transazione. L'**ordine** dei passi è scelto in modo che un fallimento a metà lasci sempre all'utente la possibilità di riprovare. E nel database abbiamo deciso di **anonimizzare** invece di cancellare: immobili e offerte restano, senza dati personali, perché un'offerta riguarda anche un altro utente e perché i file degli annunci stanno su S3, dove la Users Lambda non arriva."),
  ...figura(path.join(DIAGRAMMI, "account.png"), 3237, 1598,
    "Figura 4.6 — Gestione e cancellazione dell'account nel diagramma v3: freccia 2 verso Cognito (login, modifica e cancellazione dell'account), freccia 3 verso l'HTTP API e la Users Lambda, che anonimizza i dati applicativi attraverso l'RDS Proxy. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  p("**Cambio dell'email.**"),
  ...elencoNumerato([
    "La SPA chiama `UpdateUserAttributes` su Cognito con l'access token e il nuovo indirizzo.",
    "Cognito **non** cambia subito l'email: manda un codice di verifica al nuovo indirizzo. Finché l'utente non lo conferma resta attiva l'email vecchia, già verificata.",
    "L'utente inserisce il codice nella SPA, che lo invia a Cognito (`VerifyUserAttribute`). Da quel momento l'email nuova è attiva: serve per il login e la Mailer la usa per la notifica successiva. Nel database non c'è niente da aggiornare.",
  ]),
  p("**Cancellazione dell'account.**"),
  ...elencoNumerato([
    "**Nuovo login di conferma**: la SPA rimanda l'utente al login gestito con `prompt=login`, che obbliga a ridare la password anche se il cookie di sessione è ancora valido; così l'access token è appena emesso.",
    "**`DELETE /users/me`** sull'HTTP API, con l'access token: la Users Lambda, in **una sola transazione**, svuota il profilo lasciando il solo `sub` con `deleted_at`, ritira gli immobili dell'utente e le offerte in sospeso sue o ricevute. Dopo il commit pubblica un evento `OFFER_WITHDRAWN` per l'altra parte di ogni offerta ritirata.",
    "**`DeleteUser`** su Cognito, con lo stesso access token: Cognito cancella l'utente a cui il token appartiene e invalida il suo refresh token.",
    "**Logout**: la SPA butta dalla memoria tutti i token.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "SPA → Cognito", "`UpdateUserAttributes`, `ChangePassword`, `GetUser` con l'access token", "Internet, HTTPS verso `cognito-idp.eu-south-1.amazonaws.com`", "access token con scope `aws.cognito.signin.user.admin`; `WriteAttributes` dell'app client per gli attributi modificabili"],
      ["2", "Cognito → nuovo indirizzo", "email con il codice di verifica", "servizio di Cognito", "`AttributesRequireVerificationBeforeUpdate` sul user pool"],
      ["3", "SPA → login gestito", "nuovo login di conferma prima della cancellazione", "Internet, HTTPS", "credenziali dell'utente (4.2)"],
      ["4", "SPA → HTTP API → Users Lambda", "`DELETE /users/me` con `Authorization: Bearer`", "Internet; poi il servizio Lambda", "authorizer JWT; resource policy della Users Lambda"],
      ["5", "Users Lambda → RDS Proxy → Aurora", "una transazione: profilo anonimizzato, immobili e offerte in sospeso a `withdrawn`", "VPC, 5432 con TLS", "`rds-db:connect` come `users_user`; `GRANT` di `users_user`, con `UPDATE` sulla sola colonna `status` di immobili e offerte"],
      ["6", "Users Lambda → SNS → coda → Mailer", "`OFFER_WITHDRAWN` verso l'altra parte di ogni offerta ritirata", "VPC → interface endpoint SNS, 443; poi la catena del 4.5", "`sns:Publish` sul topic nel ruolo della Users (già presente); il resto come nel 4.5"],
      ["7", "SPA → Cognito", "`DeleteUser` con l'access token", "Internet, HTTPS", "access token con scope `aws.cognito.signin.user.admin`; nessun permesso IAM"],
      ["8", "Mailer → Cognito", "`AdminGetUser` per una notifica ancora in coda", "endpoint pubblico regionale", "execution role della Mailer; risposta `UserNotFoundException` (4.5)"],
    ],
    [400, 2000, 2400, 2300, 2500],
  ),
  dopoTabella(),

  h3("Due modi di autorizzare una chiamata a Cognito"),
  p("Cognito ha due famiglie di API, e la differenza è il cuore di questo flusso. Le API **dell'utente** (`DeleteUser`, `UpdateUserAttributes`, `ChangePassword`, `GetUser`) non usano IAM né firme AWS: ricevono un access token e agiscono **sull'utente a cui il token appartiene**, e su nessun altro. Le API **admin** (`AdminGetUser`, `AdminDeleteUser`, …) agiscono su qualunque utente del pool, e per questo si autorizzano solo con credenziali IAM, cioè con una richiesta firmata da un ruolo."),
  tabella(
    ["Operazione", "Chi la chiama", "Autorizzata da", "Su quale utente"],
    [
      ["`UpdateUserAttributes`, `ChangePassword`, `GetUser`", "SPA", "access token con lo scope `aws.cognito.signin.user.admin`", "solo il titolare del token"],
      ["`DeleteUser`", "SPA", "access token con lo stesso scope", "solo il titolare del token"],
      ["`AdminGetUser`", "Mailer Lambda", "IAM: `cognito-idp:AdminGetUser` nel suo execution role, sul solo pool", "qualunque utente del pool (sola lettura)"],
      ["`AdminDeleteUser`", "nessuno", "—", "scartata: vedi \"Perché così\""],
    ],
    [2600, 1600, 3400, 2000],
  ),
  dopoTabella(),
  p("Con `DeleteUser` la SPA non ha bisogno di credenziali AWS e il nostro account non concede nulla al browser: l'unica prova è il token."),
  ...codice(deleteUser, "la cancellazione su Cognito dalla SPA (AWS SDK per JavaScript)"),
  p("Perché funzioni, l'access token deve contenere lo scope **`aws.cognito.signin.user.admin`**. Con il login tramite authorization code questo scope non c'è se non lo si chiede: l'app client lo deve consentire in `AllowedOAuthScopes` e la SPA lo deve chiedere nel parametro `scope` del login (configurazione completa nel 4.2). Senza, Cognito risponde `NotAuthorizedException`. Per `UpdateUserAttributes` serve in più che l'attributo sia tra i `WriteAttributes` dell'app client: per noi solo `email` e `name`, cioè ciò che l'utente può cambiare da sé."),

  h3("Le autorizzazioni, passaggio per passaggio"),
  p("**Il user pool decide come si cambia l'email.** Tre impostazioni del pool lavorano insieme: l'email è l'attributo di accesso (`UsernameAttributes`), viene verificata alla registrazione (`AutoVerifiedAttributes`) e, se cambia, resta quella vecchia finché la nuova non è verificata (`AttributesRequireVerificationBeforeUpdate`)."),
  ...codice(leggiJson("config/cognito-user-pool.json"), "config/cognito-user-pool.json"),
  punto("**`AttributesRequireVerificationBeforeUpdate`** evita che un errore di battitura, o un token rubato, spostino l'account su un indirizzo che l'utente non controlla: finché il codice non viene confermato login e notifiche continuano a usare l'email vecchia, già verificata."),
  punto("Lo `username` interno è il `sub` e **non cambia mai**, nemmeno quando cambia l'email. Per questo la Mailer, che chiede l'utente con `AdminGetUser` e `Username = sub`, continua a trovarlo e legge sempre l'indirizzo attuale."),
  punto("Sono impostazioni **da scegliere alla creazione**: attributi di accesso e attributi obbligatori non si cambiano più dopo."),
  p("**La Users Lambda non tocca Cognito.** Nel suo execution role ci sono solo l'accesso al proxy come `users_user` e la pubblicazione degli eventi. Nessun permesso su Cognito: le operazioni sull'account le fa il frontend, e dalla VPC Cognito non sarebbe comunque raggiungibile. Chi la invoca è API Gateway, con la resource policy vista nel 4.2 (`<FUNCTION_NAME>` = `real-estate-prod-users`)."),
  ...codice(leggiJson("iam/policies/lambda-users.json"), "iam/policies/lambda-users.json"),
  p("Come sempre, il `sub` dell'utente da cancellare arriva **dai claim** validati dall'authorizer, mai dal body: `DELETE /users/me` non ha parametri, e non esiste un modo per chiedere alla Users Lambda di cancellare un altro utente."),
  p("**Nel database decidono i `GRANT`.** Con l'anonimizzazione la Users Lambda tocca anche immobili e offerte, ma solo per ritirarli. Per questo `users_user` riceve `UPDATE` sulla **sola colonna `status`** delle due tabelle, e `SELECT` sulle colonne che le sue query leggono: in PostgreSQL un `UPDATE` deve poter leggere le colonne del `WHERE` e del `RETURNING`. Non ha `DELETE` su nessuna tabella. Le altre quattro Lambda ricevono soltanto la lettura di `sub` e `deleted_at` in `users`, che serve al controllo descritto più sotto."),
  ...codice(grant, "GRANT toccati dalla cancellazione (da aurora.md)"),
  p("**IAM non cambia.** La policy della Users Lambda è quella di prima: entra nel proxy come `users_user` e pubblica sul topic. È la divisione del paragrafo 4.3: IAM decide chi entra nel proxy e con quale utente, i `GRANT` che cosa quell'utente fa sulle tabelle. Allargare ciò che la Lambda fa nel database è quindi una modifica SQL, non una modifica di policy."),

  h3("L'ordine della cancellazione"),
  p("Database e Cognito non hanno una transazione comune: se un passo riesce e l'altro no, qualcosa resta a metà. L'ordine è scelto perché lo stato a metà sia sempre **recuperabile dall'utente stesso**."),
  tabella(
    ["Cosa fallisce", "Stato in cui si resta", "Come se ne esce"],
    [
      ["`DELETE /users/me`", "niente è stato cancellato", "l'utente riprova"],
      ["`DeleteUser`, dopo `DELETE /users/me` riuscita", "profilo anonimizzato, immobili e offerte ritirati, account Cognito ancora attivo", "l'utente rientra: `PUT /users/me` risponde **410** e non ricrea il profilo; la SPA capisce che la cancellazione era già confermata e riprova direttamente `DeleteUser`, poi il logout"],
      ["Ordine inverso: `DeleteUser` riuscita, poi `DELETE /users/me` fallita", "account cancellato, dati ancora nel database", "**nessuna**: l'utente non può più fare login per riprovare, e i suoi dati restano senza nessuno che li possa cancellare. Per questo l'ordine è l'altro"],
    ],
    [2800, 3000, 3800],
  ),
  dopoTabella(),
  p("**Il nuovo login di conferma** prima di cominciare ha un motivo preciso: `DeleteUser` non chiede la password. Chi avesse rubato un access token valido potrebbe cancellare l'account. Facendo rifare il login prima di un'operazione irreversibile, la SPA si assicura che dietro il token ci sia l'utente e che il token sia appena emesso. C'è però un dettaglio: finché vale il cookie del login gestito (un'ora, paragrafo 4.2) un semplice redirect al login restituisce token nuovi **senza** chiedere la password. Per questo la richiesta all'endpoint `/oauth2/authorize` deve avere `prompt=login`, che il login gestito supporta e che obbliga a riautenticarsi. È un dettaglio da verificare alla prima prova con la SPA vera."),
  p("**Le notifiche ancora in coda.** Un evento pubblicato poco prima della cancellazione (per esempio l'esito di un'offerta) può arrivare alla Mailer quando l'utente non esiste più. `AdminGetUser` risponde `UserNotFoundException`, che la Mailer tratta come **caso previsto**: lo registra a livello INFO e scarta il messaggio senza ritentarlo e senza allarme (4.5). Con l'email fuori dal database, cancellare l'account su Cognito toglie davvero l'ultimo recapito dell'utente dal sistema."),

  h3("La decisione: anonimizzare"),
  p("Alla cancellazione dell'account **anonimizziamo**: immobili e offerte restano nel database senza dati personali, e niente viene tolto con `DELETE`. Tutte le tabelle si riferiscono all'utente con il suo `sub` (la chiave di `users`, l'`owner_id` degli immobili, il `buyer_id` delle offerte), e nessuna contiene l'email. Questo rende l'anonimizzazione piccola: basta svuotare le colonne di profilo e cambiare uno stato."),
  ...codice(transazione, "la transazione di DELETE /users/me (da lambda-users.md; le colonne di profilo sono d'esempio)"),
  tabella(
    ["Dato", "Cosa diventa", "Perché"],
    [
      ["Riga in `users`", "resta con il solo `sub`; i dati di profilo diventano `NULL`, `deleted_at = now()`", "le chiavi esterne di immobili e offerte restano valide; `deleted_at` serve al controllo sulle scritture"],
      ["Immobili dell'utente", "`status = 'withdrawn'`: fuori dagli elenchi, dettaglio senza agente, niente nuove offerte né upload (409)", "un annuncio senza un agente che risponde non deve restare in vetrina"],
      ["Offerte in sospeso, sue o ricevute", "`status = 'withdrawn'`, lo stesso stato del ritiro con `DELETE /offers/{id}`", "la trattativa non può continuare; l'altra parte viene avvisata"],
      ["Offerte accettate o rifiutate", "invariate", "sono storia, e non contengono dati personali"],
      ["File su S3", "restano con l'immobile ritirato", "sono le foto della casa, non dati dell'utente; la Users Lambda non ha permessi su S3"],
    ],
    [2200, 4000, 3400],
  ),
  dopoTabella(),
  p("**Perché il `sub` che resta non è più un dato personale.** L'unico legame tra il `sub` e una persona sta in Cognito, dove c'è l'email. Dopo `DeleteUser` quel legame sparisce, e il `sub` rimasto è uno **pseudonimo che non punta più a nessuno**. È la minimizzazione scelta per l'email (4.2 e 4.5) a rendere possibile anonimizzare così: se l'email fosse nel database, andrebbe ricordata e cancellata a parte."),
  p("**Una transazione sola.** Le tre `UPDATE` vanno insieme o non vanno: se una fallisce c'è il `ROLLBACK` e la Lambda risponde 500, quindi non resta mai un profilo vuoto con gli immobili ancora pubblici. Ripetere la chiamata è innocuo: `COALESCE` conserva la data della prima cancellazione e le altre due `UPDATE` non trovano più righe. È come un metodo `@Transactional` in Spring che aggiorna tre repository."),
  p("**L'avviso all'altra parte.** Dopo il commit, per ogni offerta restituita da `RETURNING`, la Users Lambda pubblica un evento `OFFER_WITHDRAWN` con `recipientSub` uguale **all'altra parte**: il proprietario dell'immobile se l'offerta era dell'utente che se ne va, l'acquirente se l'immobile era suo. Il `sub` dell'altra parte è ancora valido, e la catena è quella del 4.5 (SNS, coda, Mailer, SES) con il permesso `sns:Publish` che la Users Lambda ha già. L'evento porta immobile, offerta e importo, niente dell'utente cancellato. Nessun evento verso chi si cancella. Se la pubblicazione fallisce dopo il commit, la Lambda scrive un errore nel log e risponde comunque 204: la cancellazione non dipende dalle email."),

  h3("Il token che sopravvive: il controllo su deleted_at"),
  p("`DeleteUser` invalida il refresh token, ma l'access token già emesso vale fino a 60 minuti, e l'authorizer dell'HTTP API controlla firma e scadenza, non se l'utente esiste ancora. Senza altri controlli, un token copiato prima della cancellazione potrebbe pubblicare un immobile o fare un'offerta a nome di un utente che non c'è più. Per questo le Lambda, sulle route autenticate che **scrivono**, affiancano alla funzione comune `currentUser` (4.2) un secondo controllo:"),
  ...codice(requireActiveUser, "controllo comune sulle scritture (da api-gateway.md)"),
  punto("Se la riga dell'utente ha `deleted_at`, la scrittura riceve **403**: creare o modificare immobili, offerte, upload e file non è più possibile."),
  punto("`PUT /users/me` e `GET /users/me` su una riga con `deleted_at` rispondono **410 Gone** e non ricreano il profilo. È anche il segnale che la SPA usa per completare una cancellazione rimasta a metà."),
  punto("**Il costo** è una query sulla chiave primaria di `users` per ogni richiesta che scrive; le letture non la pagano."),
  p("Il rischio residuo si riduce così alle **letture**, che sono pubbliche o dell'utente stesso, il cui profilo è ormai vuoto."),

  h3("Limiti e rischi residui"),
  punto("**I token già emessi restano validi fino alla scadenza.** Un token copiato altrove prima della cancellazione può ancora chiamare l'API per al massimo un'ora, ma solo per leggere: le scritture ricevono 403 e `PUT /users/me` risponde 410. La SPA butta comunque i token subito dopo `DeleteUser`."),
  punto("**I file degli immobili ritirati restano su S3**, raggiungibili da chi ha già il link. Toglierli è possibile con la logica della cancellazione di un immobile della Property Lambda (4.4), per esempio lanciata dall'`admin`: è tra gli sviluppi (capitolo 6)."),
  punto("**I backup del database** contengono il profilo com'era fino alla fine della retention (da 1 a 35 giorni, valore ancora da fissare)."),
  punto("**Chiudere le altre sessioni.** Per chiudere tutte le sessioni dell'utente c'è `GlobalSignOut`, che revoca i refresh token; gli access token già emessi, per lo stesso motivo, valgono comunque fino alla scadenza, al massimo un'ora (4.2)."),
  punto("**La dipendenza dal frontend.** La sequenza di cancellazione la guida la SPA: se il browser si chiude tra il passo 2 e il passo 3, l'account Cognito resta attivo con il profilo già anonimizzato. È lo stato recuperabile descritto sopra: al login successivo `PUT /users/me` risponde 410 e la SPA completa la cancellazione con `DeleteUser`."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["Account gestito dalla **SPA direttamente con Cognito**", "le Lambda nella VPC non raggiungono Cognito; le API dell'utente sono fatte per questo e non richiedono IAM", "`AdminDeleteUser` dalla Users Lambda: dalla VPC non c'è strada; servirebbe un interface endpoint `cognito-idp`, che esiste ma ha limiti, o un evento verso una Lambda fuori dalla VPC"],
      ["**Prima il database, poi Cognito**", "un fallimento a metà lascia l'account attivo, quindi l'utente può rientrare e riprovare", "ordine inverso: dati orfani che nessuno può più cancellare"],
      ["**Anonimizzare** in una transazione: profilo svuotato, immobili e offerte in sospeso ritirati", "le offerte riguardano anche l'altra parte; le chiavi esterne restano valide; il `sub` non porta più a nessuno; S3 resta fuori dalla transazione", "cancellazione a cascata di immobili, offerte e file: l'altra parte perde la storia, e i file su S3 la Users Lambda non li può togliere. Anonimizzare solo il profilo lasciando pubblici gli immobili: annunci senza nessuno che risponda"],
      ["Una colonna `status` su immobili e offerte", "il ritiro è uno stato, non una cancellazione; `users_user` cambia solo quella colonna", "`DELETE` delle righe; `UPDATE` su tutta la tabella"],
      ["Evento `OFFER_WITHDRAWN` all'altra parte", "chi aveva una trattativa in corso lo sa; la catena e il permesso ci sono già", "nessun avviso: la trattativa sparisce in silenzio"],
      ["Scritture rifiutate con `deleted_at`; 410 su `/users/me`", "il token ancora valido può solo leggere; il profilo non si ricrea", "fidarsi della scadenza del token: un'ora di scritture possibili"],
      ["**Nuovo login** con `prompt=login` prima della cancellazione", "`DeleteUser` non chiede la password: l'utente deve riautenticarsi e il token essere appena emesso", "cancellare con il token della sessione in corso: basta un token rubato"],
      ["Cambio email **dopo la verifica**", "l'account non finisce su un indirizzo sbagliato; le notifiche continuano ad arrivare", "aggiornamento immediato: un errore di battitura isola l'utente"],
      ["Email **solo in Cognito**", "il cambio email non richiede di riallineare nulla; cancellare l'account toglie l'ultimo recapito", "copia dell'email nel database: da tenere allineata e da cancellare a parte"],
      ["Riga dell'utente creata da `PUT /users/me`", "una chiamata idempotente dopo ogni login basta, senza componenti in più", "trigger di Cognito: una Lambda e una resource policy in più"],
    ],
    [2600, 3400, 3600],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Come si cancella un account se le Lambda non raggiungono Cognito?** Lo fa la SPA: nuovo login di conferma, `DELETE /users/me` per anonimizzare i dati nel database, `DeleteUser` su Cognito con l'access token, logout.",
    "**Perché prima il database?** Se fallisce `DeleteUser` l'account c'è ancora e l'utente può riprovare: `PUT /users/me` risponde 410 e la SPA richiama `DeleteUser`. Con l'ordine inverso i dati resterebbero senza nessuno che li possa cancellare.",
    "**Cosa resta nel database?** La riga `users` con il solo `sub` e `deleted_at`, gli immobili ritirati, le offerte ritirate o già chiuse. Nessun dato personale: l'email non c'è mai stata, e dopo `DeleteUser` il `sub` non porta a nessuno.",
    "**La Users Lambda ha avuto permessi IAM nuovi?** No: entra sempre nel proxy come `users_user`. Sono cambiati i `GRANT`: `UPDATE` sulla sola colonna `status` di immobili e offerte.",
    "**Dopo `DeleteUser` il token funziona ancora?** Con la nostra API sì, fino alla scadenza, ma solo per leggere: le Lambda trovano `deleted_at` sulla riga dell'utente e rifiutano le scritture con 403.",
  ]),
];
};
