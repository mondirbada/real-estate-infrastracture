// 3.2 Login e chiamate all'API — Cognito, access token, authorizer JWT, invocazione delle Lambda.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, tabella, dopoTabella, figura } = S;
  return [
  h2("3.2 Login e chiamate all'API"),
  p("Il problema: come un utente dimostra chi è, e come quella prova arriva alla Lambda che decide se lasciarlo fare. **Cognito** autentica l'utente ed emette i token. L'**HTTP API** di API Gateway controlla il token a ogni richiesta con un **authorizer JWT** nativo. La **Lambda** riceve l'identità già verificata e controlla il ruolo e, dove serve, la proprietà della risorsa."),
  p("Il punto delicato è **quale token** va all'API. All'inizio la SPA mandava l'ID token; il docente ci ha fatto notare che l'ID token serve al client per sapere chi è loggato, non ad autorizzare chiamate, e che portava l'email in ogni richiesta. Ora all'API va l'**access token**, come vuole la buona pratica OAuth 2.0 e OpenID Connect; l'**ID token resta nella SPA**."),
  ...figura(path.join(DIAGRAMMI, "api.png"), 2750, 942,
    "Figura 3.2 — Login con Cognito, chiamata all'API con l'access token, validazione con le chiavi JWKS e invocazione delle Lambda."),

  h3("Il percorso"),
  ...elencoNumerato([
    "La SPA manda il browser al **login gestito** di Cognito con il flusso *authorization code* e **PKCE**; l'utente entra con email e password.",
    "Cognito torna alla SPA con un codice, che la SPA scambia con ID token, access token e refresh token, tenuti in memoria.",
    "Dopo il login la SPA chiama `PUT /users/me`: la Users Lambda crea o aggiorna la riga dell'utente con il solo `sub`.",
    "Ogni chiamata all'API porta `Authorization: Bearer <access token>`.",
    "L'authorizer JWT verifica firma, issuer, `client_id` e scadenza **senza chiamare Cognito**; se un controllo fallisce risponde 401 e la Lambda non parte.",
    "API Gateway invoca la Lambda, che lo ammette con la sua **resource policy**, e le passa i claim del token.",
    "La Lambda legge `sub` e gruppi dai claim, controlla il ruolo e, dove serve, la proprietà della risorsa nel database (3.3).",
  ]),

  h3("Chi parla con chi"),
  p("Gli utenti **non sono identità IAM**: IAM compare solo nell'invocazione della Lambda."),
  tabella(
    ["Da → A", "Come", "Chi lo autorizza"],
    [
      ["SPA → Cognito (login, token)", "authorization code con PKCE, HTTPS", "configurazione dell'app client; credenziali dell'utente; PKCE al posto di un client secret"],
      ["SPA → HTTP API", "HTTPS con l'access token; preflight CORS", "CORS dell'API per il browser; authorizer JWT per il token"],
      ["Authorizer ← Cognito", "chiavi pubbliche JWKS, in cache", "nessuno: le chiavi sono pubbliche"],
      ["HTTP API → Lambda", "invocazione sincrona", "resource policy della Lambda, con `AWS:SourceArn` = la nostra API"],
      ["Lambda → database", "query di ownership e dati", "execution role e `GRANT` (3.3)"],
    ],
    [2600, 3000, 4000],
  ),
  dopoTabella(),

  h3("I token"),
  p("L'app client della SPA è **pubblico, senza secret**, perché il codice della SPA lo legge chiunque; PKCE ne prende il posto: solo chi ha iniziato il login può riscattare il codice."),
  tabella(
    ["Token", "Cosa contiene", "A cosa serve"],
    [
      ["ID token", "`sub`, email, gruppi; `aud` = l'app client", "resta nella SPA, per sapere chi è loggato"],
      ["Access token", "`sub`, gruppi, `client_id`, scope; **niente email**", "va all'API a ogni chiamata e autorizza le operazioni dell'utente su Cognito (3.6)"],
      ["Refresh token", "opaco", "rinnova i token; revocato al logout"],
    ],
    [1800, 3800, 4000],
  ),
  dopoTabella(),
  p("Sull'app client si configurano flusso, scope, durata di 60 minuti e revoca. Lo scope `aws.cognito.signin.user.admin` serve perché l'access token possa agire sull'utente stesso (3.6). I ruoli applicativi non sono scope ma tre **gruppi** del pool, `buyer`, `agent` e `admin`."),
  ...codice(leggiJson("config/cognito-app-client.json"), "config/cognito-app-client.json"),

  h3("L'authorizer JWT"),
  p("L'authorizer è configurato con l'**issuer**, il nostro user pool, e l'**audience**, l'ID dell'app client. A ogni richiesta controlla la **firma** con le chiavi pubbliche del pool, tenute in cache; l'**issuer**; l'audience, che per l'access token cade su `client_id`, perché il token di Cognito non ha `aud`; e la **scadenza**. Un token falso riceve 401 e non costa un'esecuzione. Le route di sola lettura degli annunci sono pubbliche e non hanno authorizer; tutte le altre sì."),
  p("Il CORS non protegge l'API: un client che non è un browser lo ignora. Impedisce solo che un sito di terzi, aperto nel browser dell'utente, la chiami leggendone le risposte; ammette l'origine del sito e i soli metodi e header usati (Appendice B)."),

  h3("Chi può invocare la Lambda"),
  p("API Gateway non assume un nostro ruolo: è la **funzione** che lo ammette, con una resource policy applicata a tutte e cinque le Lambda di business (`<FUNCTION_NAME>` = `real-estate-prod-property`, `-users`, `-offers`, `-presigned`, `-files`)."),
  ...codice(leggiJson("iam/resource-policies/lambda-allow-api-gateway.json"), "iam/resource-policies/lambda-allow-api-gateway.json"),
  p("La condizione `AWS:SourceArn` lega il permesso alla nostra API: senza, `apigateway.amazonaws.com` vorrebbe dire qualunque API Gateway, anche di un altro account (confused deputy, vedi 4.1). Due domande, due meccanismi: **chi può chiamare la funzione** lo dice la resource policy, **cosa può fare la funzione** il suo execution role (3.3, 3.5)."),

  h3("Cosa decide la Lambda"),
  p("La Lambda riceve i claim già validati. Una funzione comune a tutte le Lambda ne legge `sub` e `cognito:groups` e **rifiuta i token con `token_use` diverso da `access`**: l'ID token ha `aud` uguale al nostro client e l'authorizer lo lascerebbe passare. Il `sub` si prende **sempre dai claim**, mai dal body o dai parametri, che il client scrive come vuole."),
  p("L'autorizzazione ha due livelli. Il **ruolo** viene dai gruppi: pubblicare un immobile richiede `agent`, fare un'offerta `buyer`. La **proprietà** della risorsa la sa solo il database: la Lambda cerca la riga con quell'id e quel proprietario, e se non la trova (e l'utente non è `admin`) risponde 403. Sulle route che scrivono c'è un ultimo controllo: se la riga dell'utente ha `deleted_at`, l'account è stato cancellato e la scrittura riceve 403 (3.6)."),

  h3("Quando qualcosa va storto"),
  tabella(
    ["Situazione", "Esito"],
    [
      ["Token mancante o falso, issuer o `client_id` sbagliati, token scaduto", "401 dall'authorizer; la SPA rinnova i token"],
      ["ID token al posto dell'access token", "rifiutato dalla funzione comune delle Lambda"],
      ["Gruppo sbagliato o risorsa di un altro utente", "403 dalla Lambda"],
      ["Scrittura con il token di un account cancellato", "403; `PUT /users/me` risponde 410"],
    ],
    [5000, 4600],
  ),
  dopoTabella(),

  h3("Furto del token e rischio residuo"),
  p("Il JWT è firmato, non cifrato: chi lo ha ne legge il payload, che nell'access token è un `sub` opaco, i gruppi e il `client_id`. Il rischio vero è l'uso: è un **bearer token** e vale per chiunque lo presenti. Le difese lo rendono difficile da rubare e lo fanno durare poco: HTTPS ovunque, token in memoria e non in `localStorage`, la CSP del sito (3.1), durata di 60 minuti, revoca del refresh token al logout. L'authorizer però **non vede le revoche**: un access token rubato resta valido fino alla scadenza. Lo accettiamo per un progetto di questa taglia (5.2)."),

  h3("Le scelte"),
  p("Access token all'API, authorizer JWT nativo invece di un Lambda Authorizer, ruolo dai gruppi e proprietà nella Lambda, login gestito con PKCE. Le alternative scartate sul token (ID token all'API, Pre Token Generation, `/oauth2/userInfo`, Lambda Authorizer) e l'evoluzione verso un Backend For Frontend sono nel capitolo 5."),
  ];
};
