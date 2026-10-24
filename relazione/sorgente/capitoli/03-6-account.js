// 3.6 Gestione e cancellazione dell'account — operazioni su Cognito dalla SPA, ordine della cancellazione, anonimizzazione.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, elencoNumerato, codice, tabella, dopoTabella, figura } = S;
  return [
  h2("3.6 Gestione e cancellazione dell'account"),
  p("Cambiare email o password e cancellare l'account sono operazioni sull'identità, che sta in Cognito. Le Lambda di business però stanno in una VPC senza accesso a Internet e senza un endpoint per Cognito: non lo raggiungono. La soluzione è che la **SPA parli direttamente con Cognito**, con le API pensate perché l'utente gestisca il proprio account, autorizzate dal suo **access token** invece che da IAM. Alla nostra API resta un solo compito: **anonimizzare** i dati applicativi prima della cancellazione."),
  ...figura(path.join(DIAGRAMMI, "account.png"), 3237, 1598,
    "Figura 3.6 — Gestione e cancellazione dell'account: la SPA verso Cognito e verso la Users Lambda, che anonimizza i dati attraverso l'RDS Proxy."),

  h3("Il percorso"),
  p("**Cambio dell'email**: la SPA chiama `UpdateUserAttributes` con l'access token; Cognito manda un codice al nuovo indirizzo e, finché l'utente non lo conferma, resta attiva l'email vecchia. Nel database non c'è niente da aggiornare. **Cancellazione**:"),
  ...elencoNumerato([
    "**Nuovo login di conferma** con `prompt=login`, che obbliga a ridare la password: `DeleteUser` non la chiede, e un token rubato basterebbe.",
    "**`DELETE /users/me`** sull'API: la Users Lambda anonimizza i dati in una transazione e avvisa l'altra parte delle offerte ritirate.",
    "**`DeleteUser`** su Cognito con lo stesso access token: l'utente sparisce e il refresh token non vale più.",
    "**Logout**: la SPA butta i token dalla memoria.",
  ]),

  h3("Chi parla con chi"),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["SPA → Cognito", "`UpdateUserAttributes`, `ChangePassword`, `DeleteUser`", "access token con scope `aws.cognito.signin.user.admin`; nessun permesso IAM"],
      ["SPA → HTTP API → Users Lambda", "`DELETE /users/me`", "authorizer JWT e resource policy (3.2)"],
      ["Users Lambda → RDS Proxy → database", "una transazione", "`rds-db:connect` come `users_user`; `GRANT`"],
      ["Users Lambda → SNS", "evento `OFFER_WITHDRAWN`", "`sns:Publish` sul topic (3.5)"],
    ],
    [3000, 3000, 3600],
  ),
  dopoTabella(),

  h3("Le autorizzazioni chiave"),
  p("Cognito ha due famiglie di API. Quelle **dell'utente** ricevono un access token e agiscono solo sul suo titolare: il browser non ha credenziali AWS e il nostro account non gli concede nulla. Quelle **admin** agiscono su qualunque utente e si autorizzano solo con IAM: le usa soltanto la Mailer, in lettura (3.5). Il cambio email lo regola il user pool: l'email è l'attributo di accesso e resta la vecchia finché la nuova non è confermata, così un errore di battitura o un token rubato non spostano l'account su un indirizzo che l'utente non controlla. La configurazione del user pool è nel repository."),
  p("La Users Lambda **non ha permessi su Cognito**. Il suo ruolo è quello della Offers (3.5) con un altro utente del database:"),
  ...codice(leggiJson("iam/policies/lambda-users.json"), "iam/policies/lambda-users.json"),
  p("Entra nel proxy come `users_user` e pubblica sul topic, niente di più e nessuna azione su Cognito. Il `sub` da cancellare arriva dai claim: non c'è modo di chiederle di cancellare un altro utente. Che cosa può toccare nel database lo decidono i `GRANT`: sugli immobili e sulle offerte può cambiare **solo lo stato**, e non può cancellare righe."),

  h3("L'ordine e l'anonimizzazione"),
  p("Database e Cognito non hanno una transazione comune, quindi l'ordine conta. Prima il database, poi Cognito: se `DeleteUser` fallisce, l'account esiste ancora e l'utente può rientrare; `PUT /users/me` risponde **410**, e la SPA capisce che deve solo ripetere `DeleteUser`. Con l'ordine inverso, un fallimento lascerebbe dati che nessuno può più cancellare, perché l'utente non può più fare login."),
  p("Nel database **anonimizziamo** invece di cancellare, in una sola transazione. Il profilo viene svuotato e resta il solo `sub`, segnato come cancellato con `deleted_at`. Gli immobili dell'utente vengono ritirati: escono dagli elenchi e non ricevono offerte né upload. Le offerte in sospeso, fatte da lui o ricevute sui suoi immobili, vengono ritirate, e l'altra parte riceve un'email. Le offerte già chiuse restano come storia; i file su S3 restano con l'immobile ritirato. Ripetere la chiamata è innocuo."),
  p("Il `sub` che resta non è più un dato personale: l'unico legame con una persona era l'email in Cognito, che sparisce con `DeleteUser`. È la scelta di tenere l'email **solo in Cognito** a rendere l'anonimizzazione così piccola."),

  h3("Quando qualcosa va storto"),
  p("L'access token già emesso vale ancora fino a un'ora, e l'authorizer non sa che l'utente non esiste più: per questo le route che scrivono controllano `deleted_at` e rispondono **403** (3.2), al costo di una query sulla chiave primaria per ogni scrittura. Se il browser si chiude tra il passo 2 e il 3 si resta nello stato recuperabile descritto sopra. Una notifica ancora in coda per l'utente cancellato fa rispondere a Cognito che l'utente non esiste: la Mailer la scarta senza allarme (3.5). Se l'avviso all'altra parte non parte, la cancellazione riesce lo stesso. Restano fuori i file degli immobili ritirati, ancora raggiungibili da chi ha il link, e i backup del database fino alla loro scadenza."),

  h3("Le scelte"),
  p("Account gestito dalla SPA con le API dell'utente, invece di `AdminDeleteUser` da una Lambda che dalla VPC non arriva a Cognito. Prima il database, poi Cognito. Anonimizzare invece di cancellare a cascata, perché un'offerta riguarda anche l'altra parte (5.1)."),
  ];
};
