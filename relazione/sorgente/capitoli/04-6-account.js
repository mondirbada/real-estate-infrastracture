// 4.6 Gestione e cancellazione dell'account — operazioni su Cognito dal frontend, ordine della cancellazione.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;

  const deleteUser = `import { CognitoIdentityProviderClient, DeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({ region: "eu-south-1" });
// Nessuna credenziale AWS: l'unica prova è l'access token dell'utente.
await cognito.send(new DeleteUserCommand({ AccessToken: accessToken }));`;

  return [
  h2("4.6 Gestione e cancellazione dell'account"),
  p("Cambiare email o password e cancellare l'account sono operazioni sull'**identità** dell'utente, e l'identità sta in Cognito. Per questo le fa la **SPA direttamente con Cognito**, chiamando le sue API pubbliche con l'access token dell'utente, senza passare dalle nostre Lambda. L'unica eccezione sono i dati applicativi nel database, che si cancellano con una chiamata alla nostra API, `DELETE /users/me`, prima di cancellare l'account."),
  p("La ragione è di rete prima ancora che di design. Le Lambda di business stanno in una VPC **senza accesso a Internet** e senza un endpoint per Cognito: non possono raggiungerlo. E non serve che lo facciano: Cognito ha API pensate proprio perché sia l'utente a gestire il proprio account, autorizzate dal suo token invece che da IAM. È come in un'applicazione Spring con Keycloak, dove il cambio password lo fa la pagina *account* di Keycloak e non un controller nostro."),
  p("La cancellazione è la parte delicata: tocca due sistemi, Cognito e il database, che non condividono una transazione. L'**ordine** dei passi è scelto in modo che un fallimento a metà lasci sempre all'utente la possibilità di riprovare."),
  ...figura(path.join(DIAGRAMMI, "account.png"), 3237, 1598,
    "Figura 4.6 — Gestione e cancellazione dell'account nel diagramma v3: freccia 2 verso Cognito (login, modifica e cancellazione dell'account), freccia 3 verso l'HTTP API e la Users Lambda, che cancella i dati applicativi attraverso l'RDS Proxy. Gli elementi che non partecipano sono sbiaditi."),

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
    "**`DELETE /users/me`** sull'HTTP API, con l'access token: la Users Lambda cancella o anonimizza i dati applicativi nel database.",
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
      ["5", "Users Lambda → RDS Proxy → Aurora", "cancellazione o anonimizzazione delle righe dell'utente", "VPC, 5432 con TLS", "`rds-db:connect` come `users_user`; `GRANT` di `users_user` (4.3)"],
      ["6", "SPA → Cognito", "`DeleteUser` con l'access token", "Internet, HTTPS", "access token con scope `aws.cognito.signin.user.admin`; nessun permesso IAM"],
      ["7", "Mailer → Cognito", "`AdminGetUser` per una notifica ancora in coda", "endpoint pubblico regionale", "execution role della Mailer; risposta `UserNotFoundException` (4.5)"],
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

  h3("L'ordine della cancellazione"),
  p("Database e Cognito non hanno una transazione comune: se un passo riesce e l'altro no, qualcosa resta a metà. L'ordine è scelto perché lo stato a metà sia sempre **recuperabile dall'utente stesso**."),
  tabella(
    ["Cosa fallisce", "Stato in cui si resta", "Come se ne esce"],
    [
      ["`DELETE /users/me`", "niente è stato cancellato", "l'utente riprova"],
      ["`DeleteUser`, dopo `DELETE /users/me` riuscita", "dati applicativi cancellati, account Cognito ancora attivo", "l'utente rientra e ripete la cancellazione. Se intanto rientra e la SPA chiama `PUT /users/me`, gli si ricrea un profilo vuoto, che la nuova cancellazione toglie"],
      ["Ordine inverso: `DeleteUser` riuscita, poi `DELETE /users/me` fallita", "account cancellato, dati ancora nel database", "**nessuna**: l'utente non può più fare login per riprovare, e i suoi dati restano senza nessuno che li possa cancellare. Per questo l'ordine è l'altro"],
    ],
    [2800, 3000, 3800],
  ),
  dopoTabella(),
  p("**Il nuovo login di conferma** prima di cominciare ha un motivo preciso: `DeleteUser` non chiede la password. Chi avesse rubato un access token valido potrebbe cancellare l'account. Facendo rifare il login prima di un'operazione irreversibile, la SPA si assicura che dietro il token ci sia l'utente e che il token sia appena emesso. C'è però un dettaglio: finché vale il cookie del login gestito (un'ora, paragrafo 4.2) un semplice redirect al login restituisce token nuovi **senza** chiedere la password. Per questo la richiesta all'endpoint `/oauth2/authorize` deve avere `prompt=login`, che il login gestito supporta e che obbliga a riautenticarsi. È un dettaglio da verificare alla prima prova con la SPA vera."),
  p("**Le notifiche ancora in coda.** Un evento pubblicato poco prima della cancellazione (per esempio l'esito di un'offerta) può arrivare alla Mailer quando l'utente non esiste più. `AdminGetUser` risponde `UserNotFoundException`, che la Mailer tratta come **caso previsto**: lo registra a livello INFO e scarta il messaggio senza ritentarlo e senza allarme (4.5). Con l'email fuori dal database, cancellare l'account su Cognito toglie davvero l'ultimo recapito dell'utente dal sistema."),

  h3("Cosa succede a immobili, file e offerte"),
  p("Qui la documentazione del progetto fissa il principio ma non ancora il dettaglio. Il principio è che `DELETE /users/me` **cancella o anonimizza** i dati applicativi dell'utente. Tutte le tabelle si riferiscono all'utente con il suo `sub`: la riga in `users`, l'`owner_id` degli immobili, l'autore delle offerte. Nessuna contiene l'email, quindi anche ciò che resta anonimizzato non porta recapiti."),
  p("La regola tabella per tabella è un **punto aperto**, e l'architettura pone dei vincoli che la scelta dovrà rispettare:"),
  punto("**File su S3.** La Users Lambda non ha permessi su S3: non può cancellare le foto e i video. Gli unici ruoli che possono cancellare oggetti sono la Property Lambda, quando cancella un immobile (tutto il prefisso `uploads/<propertyId>/`), e la Files Lambda, un file alla volta (4.4). Se gli immobili di un agente venissero cancellati nel database dalla Users Lambda, i loro file resterebbero su S3, pagati e raggiungibili da chi ha il link: lo stesso problema che la cancellazione di un immobile evita apposta."),
  punto("**Offerte.** Un'offerta riguarda due utenti, l'acquirente e il proprietario dell'immobile, che la vede tra quelle ricevute. Cancellarla o anonimizzarla è una scelta che tocca anche l'altra parte."),
  punto("**Notifiche.** Gli eventi verso l'utente cancellato si chiudono da soli con `UserNotFoundException`; quelli verso l'altra parte (per esempio un'offerta ritirata) dipendono dalla regola scelta per le offerte."),

  h3("Limiti e rischi residui"),
  punto("**I token già emessi restano validi fino alla scadenza.** `DeleteUser` invalida il refresh token, ma ID e access token già emessi valgono ancora fino a 60 minuti. L'authorizer dell'HTTP API controlla firma e scadenza, non se l'utente esiste ancora. Per questo la SPA butta i token subito dopo `DeleteUser`. Un token copiato altrove prima della cancellazione potrebbe ancora chiamare l'API per al massimo un'ora; con quel token, `PUT /users/me` ricreerebbe perfino un profilo vuoto con il vecchio `sub`, che però nessuno potrà più usare per entrare."),
  punto("**Chiudere le altre sessioni.** Per chiudere tutte le sessioni dell'utente c'è `GlobalSignOut`, che revoca i refresh token; gli access token già emessi, per lo stesso motivo, valgono comunque fino alla scadenza, al massimo un'ora (4.2)."),
  punto("**La dipendenza dal frontend.** La sequenza di cancellazione la guida la SPA: se il browser si chiude tra il passo 2 e il passo 3, l'account resta attivo senza dati applicativi. È lo stato recuperabile descritto sopra: al login successivo l'utente può ripetere la cancellazione."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["Account gestito dalla **SPA direttamente con Cognito**", "le Lambda nella VPC non raggiungono Cognito; le API dell'utente sono fatte per questo e non richiedono IAM", "`AdminDeleteUser` dalla Users Lambda: dalla VPC non c'è strada; servirebbe un interface endpoint `cognito-idp`, che esiste ma ha limiti, o un evento verso una Lambda fuori dalla VPC"],
      ["**Prima il database, poi Cognito**", "un fallimento a metà lascia l'account attivo, quindi l'utente può rientrare e riprovare", "ordine inverso: dati orfani che nessuno può più cancellare"],
      ["**Nuovo login** con `prompt=login` prima della cancellazione", "`DeleteUser` non chiede la password: l'utente deve riautenticarsi e il token essere appena emesso", "cancellare con il token della sessione in corso: basta un token rubato"],
      ["Cambio email **dopo la verifica**", "l'account non finisce su un indirizzo sbagliato; le notifiche continuano ad arrivare", "aggiornamento immediato: un errore di battitura isola l'utente"],
      ["Email **solo in Cognito**", "il cambio email non richiede di riallineare nulla; cancellare l'account toglie l'ultimo recapito", "copia dell'email nel database: da tenere allineata e da cancellare a parte"],
      ["Riga dell'utente creata da `PUT /users/me`", "una chiamata idempotente dopo ogni login basta, senza componenti in più", "trigger di Cognito: una Lambda e una resource policy in più"],
    ],
    [2600, 3500, 3500],
  ),
  dopoTabella(),
  ...riquadro("All'orale, in breve", [
    "**Come si cancella un account se le Lambda non raggiungono Cognito?** Lo fa la SPA: nuovo login di conferma, `DELETE /users/me` per i dati nel database, `DeleteUser` su Cognito con l'access token, logout.",
    "**Perché prima il database?** Se fallisce `DeleteUser` l'account c'è ancora e l'utente può riprovare; con l'ordine inverso i dati resterebbero senza nessuno che li possa cancellare.",
    "**Perché serve lo scope `aws.cognito.signin.user.admin`?** Permette all'access token di agire sull'utente stesso tramite le API di Cognito; senza, `DeleteUser` e `UpdateUserAttributes` vengono rifiutate.",
    "**Se l'utente cambia email, cosa aggiornate?** Niente: l'email sta solo in Cognito e diventa attiva dopo la verifica; la Mailer la legge al momento dell'invio.",
    "**Dopo `DeleteUser` il token funziona ancora?** Con la nostra API sì, fino alla scadenza: l'authorizer non sa che l'utente non esiste più. Per questo la SPA butta i token e la durata è di un'ora.",
  ]),
];
};
