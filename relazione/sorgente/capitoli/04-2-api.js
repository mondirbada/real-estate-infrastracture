// 4.2 Login e chiamate all'API — login con Cognito, access token, authorizer JWT, invocazione delle Lambda.
const path = require("path");

module.exports = ({ S, leggiJson, DIAGRAMMI }) => {
  const { p, h2, h3, punto, elencoNumerato, codice, riquadro, tabella, dopoTabella, figura } = S;

  const tokenAccesso = `{
  "sub": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
  "cognito:groups": ["agent"],
  "client_id": "<APP_CLIENT_ID>",
  "scope": "openid email aws.cognito.signin.user.admin",
  "token_use": "access",
  "username": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
  "iss": "https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>",
  "exp": 1792664100,
  "iat": 1792660500
}`;

  const eventoLambda = `{
  "version": "2.0",
  "routeKey": "DELETE /properties/{id}",
  "rawPath": "/properties/1042",
  "pathParameters": { "id": "1042" },
  "headers": { "authorization": "Bearer <access token>" },
  "requestContext": {
    "http": { "method": "DELETE", "path": "/properties/1042" },
    "authorizer": {
      "jwt": {
        "claims": {
          "sub": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
          "cognito:groups": "[agent]",
          "client_id": "<APP_CLIENT_ID>",
          "token_use": "access",
          "iss": "https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>"
        }
      }
    }
  }
}`;

  const currentUser = `// Legge identità e gruppi dai claim già validati dall'authorizer.
export function currentUser(event) {
  const claims = event.requestContext.authorizer.jwt.claims;
  if (claims.token_use !== "access") {
    throw new UnauthorizedError("serve un access token");
  }
  const raw = claims["cognito:groups"] ?? "";
  const groups = Array.isArray(raw) ? raw : raw.replace(/^\\[|\\]$/g, "").split(/[\\s,]+/).filter(Boolean);
  return { sub: claims.sub, groups };
}`;

  const spring = `@DeleteMapping("/properties/{id}")
public ResponseEntity<Void> delete(@PathVariable long id,
                                   @AuthenticationPrincipal Jwt jwt) {
    String sub = jwt.getSubject();   // come claims.sub nella Lambda
    // ownership: WHERE id = :id AND owner_id = :sub
    ...
}`;

  return [
  h2("4.2 Login e chiamate all'API"),
  p("Questo è il flusso che tiene insieme tutti gli altri: come un utente dimostra chi è, e come quella prova arriva fino alla Lambda che deve decidere se lasciarlo fare. Gli attori sono tre: **Cognito**, che autentica l'utente ed emette i token; l'**HTTP API** di API Gateway, che controlla il token a ogni richiesta con un authorizer JWT nativo; la **Lambda** dello scope, che riceve l'identità già verificata e controlla il ruolo e, dove serve, la proprietà della risorsa."),
  p("La parte che merita più attenzione è **quale token** va all'API. All'inizio la SPA mandava l'ID token: funzionava, ma l'ID token serve al client per sapere chi è loggato, non ad autorizzare chiamate a un'API, e portava con sé l'email dell'utente in ogni richiesta. Il docente ce l'ha fatto notare, e ora la SPA manda l'**access token**, come vuole la buona pratica OAuth 2.0 / OpenID Connect. Il cambio ha avuto una sola conseguenza da risolvere, l'email per le notifiche, che oggi la Mailer legge direttamente da Cognito (paragrafo 4.5)."),
  p("Chi viene da Spring Boot ha già visto questo schema: Cognito fa la parte di Keycloak (l'authorization server), l'authorizer JWT fa ciò che fa `oauth2ResourceServer().jwt()` con l'issuer URI, e la Lambda è il controller che riceve il `Jwt` già validato e decide, come un `@PreAuthorize` più un controllo nel service."),
  ...figura(path.join(DIAGRAMMI, "api.png"), 2750, 942,
    "Figura 4.2 — Login e chiamate all'API nel diagramma v3: frecce 2 (login con Cognito) e 3 (HTTPS con l'access token), validazione con le chiavi JWKS, invocazione delle Lambda. Gli elementi che non partecipano sono sbiaditi."),

  h3("Il percorso in sintesi"),
  ...elencoNumerato([
    "La SPA manda il browser alle pagine di **login gestito** di Cognito (*managed login*), con il flusso **authorization code + PKCE**. L'utente entra con email e password.",
    "Cognito torna alla SPA con un codice, che la SPA scambia con tre token: **ID token**, **access token** e **refresh token**. La SPA li tiene in memoria, non in `localStorage`.",
    "Subito dopo il login la SPA chiama `PUT /users/me`: la Users Lambda crea o aggiorna la riga dell'utente nel database con il solo `sub` del token.",
    "Per ogni chiamata all'API la SPA aggiunge l'header `Authorization: Bearer <access token>`. Per le richieste non semplici il browser fa prima un **preflight CORS** `OPTIONS`, a cui l'HTTP API risponde da sola.",
    "L'**authorizer JWT** dell'HTTP API verifica la firma del token con le chiavi pubbliche del user pool (JWKS), l'issuer, il `client_id` e la scadenza, **senza chiamare Cognito**. Se un controllo fallisce risponde 401 e la Lambda non parte.",
    "API Gateway invoca la Lambda dello scope, che lo ammette con la sua **resource policy**, e le passa i claim del token in `requestContext.authorizer.jwt.claims`.",
    "La Lambda rifiuta i token con `token_use` diverso da `access`, legge `sub` e `cognito:groups`, controlla il ruolo e, dove serve, l'ownership con una query al database (paragrafo 4.3).",
  ]),

  h3("Chi parla con chi"),
  p("Rispetto al flusso delle notifiche qui quasi tutto passa su Internet, dal browser verso servizi regionali che stanno fuori dalla VPC. Per questo i controlli non sono security group ma token, CORS e resource policy. IAM compare in un solo punto, l'invocazione della Lambda: gli utenti finali **non sono identità IAM**."),
  tabella(
    ["#", "Da → A", "Come", "Rete", "Chi lo autorizza"],
    [
      ["1", "SPA → login gestito di Cognito", "redirect del browser, authorization code con PKCE", "Internet, HTTPS verso il dominio del user pool", "configurazione dell'app client: flusso `code`, scope consentiti, `CallbackURLs`; credenziali dell'utente"],
      ["2", "SPA → Cognito (`/oauth2/token`)", "scambio del codice con i token, con il `code_verifier` di PKCE", "Internet, HTTPS", "PKCE: solo chi ha iniziato il login può riscattare il codice (client pubblico, senza secret)"],
      ["3", "SPA → HTTP API", "HTTPS con `Authorization: Bearer <access token>`; prima il preflight `OPTIONS`", "Internet, HTTPS", "CORS dell'API (`http-api-cors.json`) per il browser; authorizer JWT per il token"],
      ["4", "Authorizer ← Cognito", "lettura delle chiavi pubbliche (JWKS) dell'issuer, tenute in cache", "gestita da API Gateway, fuori dalla VPC", "nessun permesso: le chiavi sono pubbliche"],
      ["5", "HTTP API → Lambda", "invocazione sincrona, *Lambda proxy integration* (payload 2.0)", "attraverso il servizio Lambda: l'API non entra nella VPC", "resource policy della Lambda (`lambda-allow-api-gateway.json`), con `AWS:SourceArn` = la nostra API"],
      ["6", "Lambda → controllo del ruolo", "`token_use`, `cognito:groups` dai claim", "dentro la funzione", "codice comune `currentUser`"],
      ["7", "Lambda → database", "query di ownership e dati", "VPC, verso l'RDS Proxy", "execution role (`rds-db:connect`) e `GRANT`: paragrafo 4.3"],
      ["8", "SPA → Cognito (logout)", "`RevokeToken` sul refresh token", "Internet, HTTPS", "il refresh token stesso; revoca attiva sull'app client"],
    ],
    [400, 2000, 2400, 2300, 2500],
  ),
  dopoTabella(),

  h3("Login: i tre token e a cosa serve ciascuno"),
  p("Il login non lo scriviamo noi: la SPA rimanda il browser alle pagine di login di Cognito, sul dominio del user pool, e Cognito torna all'URL di callback del sito con un codice. Il flusso è **authorization code con PKCE**, quello consigliato per le SPA: l'app client è **pubblico, senza client secret**, perché il codice della SPA lo legge chiunque e un secret non sarebbe segreto. PKCE prende il posto del secret: la SPA genera un valore casuale all'inizio del login e solo chi lo conosce può scambiare il codice con i token."),
  p("Il user pool usa l'**email come attributo di accesso**: l'utente si registra ed entra con l'email, mentre lo `username` interno è un identificativo generato, uguale al `sub`, che non cambia mai. I ruoli applicativi sono tre **gruppi** del pool, `buyer`, `agent` e `admin`, che finiscono nel claim `cognito:groups`."),
  tabella(
    ["Token", "Cosa contiene", "Chi lo usa e per cosa"],
    [
      ["**ID token** (JWT, `token_use` = `id`)", "chi è l'utente: `sub`, `email`, `cognito:groups`, `aud` = ID dell'app client", "**resta nella SPA**: le serve per sapere chi è loggato, per esempio per mostrare l'email nel menu. Non va all'API"],
      ["**Access token** (JWT, `token_use` = `access`)", "cosa può fare: `sub`, `cognito:groups`, `client_id`, `scope`, `username` (= `sub`). **Nessuna email** e nessun `aud`", "va all'**HTTP API** in ogni chiamata; autorizza anche le operazioni dell'utente su **Cognito stesso** (cambio email, cancellazione: paragrafo 4.6)"],
      ["**Refresh token**", "opaco per il client", "ottenere nuovi token senza rifare il login; **revocato al logout** con `RevokeToken`"],
    ],
    [2300, 3500, 3800],
  ),
  dopoTabella(),
  p("Ecco il payload di un access token decodificato. Un JWT è `header.payload.firma`: il payload è solo codificato in Base64, non cifrato, e chi ha il token lo legge."),
  ...codice(tokenAccesso, "payload di un access token di Cognito (esempio)"),
  p("Tutto ciò che riguarda login e token si configura sull'**app client** della SPA: flusso `code`, i tre scope che la SPA chiede al login, callback e logout sul dominio del sito, durata di ID e access token di 60 minuti, revoca dei token attiva."),
  ...codice(leggiJson("config/cognito-app-client.json"), "config/cognito-app-client.json"),
  punto("`GenerateSecret: false`: client pubblico, con PKCE."),
  punto("`AllowedOAuthScopes`: `openid` ed `email` per l'ID token; `aws.cognito.signin.user.admin` perché l'access token possa agire sull'utente stesso tramite le API di Cognito (paragrafo 4.6). Nessuno scope personalizzato né *resource server*: i permessi applicativi li danno i gruppi, non gli scope."),
  punto("`AccessTokenValidity` e `IdTokenValidity` a 60 minuti: con il login gestito AWS sconsiglia di scendere sotto l'ora. Il login gestito lascia nel browser un cookie di sessione valido un'ora, e per tutta quell'ora l'utente ottiene token nuovi senza ridare la password: un token più corto non accorcerebbe la sessione, aggiungerebbe solo redirect."),
  punto("`EnableTokenRevocation`: permette alla SPA di revocare il refresh token al logout."),
  p("Dopo ogni login la SPA chiama `PUT /users/me`. È così che nasce la riga dell'utente nel database, senza trigger di Cognito: la Users Lambda fa un *upsert* con il `sub` preso dai claim, come un `save()` di Spring Data su una chiave che arriva dal `SecurityContext`. Alla prima creazione pubblica l'evento di benvenuto (paragrafo 4.5)."),

  h3("La chiamata all'API e l'authorizer JWT"),
  p("La SPA manda l'access token nell'header `Authorization`, con il prefisso `Bearer`, che l'authorizer accetta. L'authorizer è configurato con due soli valori: l'**issuer**, cioè il user pool (`https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>`), e l'**audience**, cioè l'ID dell'app client della SPA. Su ogni richiesta controlla:"),
  punto("la **firma**, con le chiavi pubbliche che il pool pubblica in `.well-known/jwks.json`. API Gateway le tiene in cache: per questo non chiama Cognito a ogni richiesta;"),
  punto("l'**issuer** (`iss`): il token deve venire dal nostro pool;"),
  punto("l'**audience**: l'authorizer la confronta con `aud` se c'è, altrimenti con `client_id`. L'access token di Cognito **non ha `aud`** (lo avrebbe solo con un *resource binding*, che non usiamo), quindi il controllo cade su `client_id`: il token deve essere stato emesso per la nostra SPA;"),
  punto("la **scadenza** (`exp`) e i tempi `nbf` e `iat`."),
  p("Se un controllo fallisce, API Gateway risponde **401** e la Lambda non viene nemmeno invocata: le richieste con un token falso o scaduto non costano un'esecuzione. Le route di sola lettura degli annunci (`GET /properties`, `GET /properties/{id}`, `GET /properties/{id}/files`, `GET /users/{id}`) sono pubbliche e non hanno authorizer: un visitatore guarda gli immobili senza account. Tutte le altre lo richiedono."),

  h3("Le autorizzazioni, passaggio per passaggio"),
  p("**Il browser e il CORS.** Il sito sta sul dominio CloudFront, l'API sul dominio di API Gateway: due origini diverse, quindi il browser applica la *same-origin policy* e, per una richiesta con l'header `Authorization`, chiede prima il permesso con un preflight `OPTIONS`. Lo gestisce la `CorsConfiguration` dell'HTTP API: ammette solo l'origine del sito, i quattro metodi usati e i due header che la SPA manda. Le route sono esplicite (niente `ANY /{proxy+}`), così l'API risponde da sola ai preflight senza farli passare dall'authorizer."),
  ...codice(leggiJson("config/http-api-cors.json"), "config/http-api-cors.json"),
  p("Il CORS non è un controllo di sicurezza lato server: un client che non è un browser lo ignora. Serve a impedire che un sito di terzi, aperto nel browser dell'utente, chiami la nostra API leggendone le risposte. Chi protegge davvero l'API è l'authorizer. `MaxAge` 3600 permette al browser di riusare la risposta del preflight per un'ora invece di ripeterla prima di ogni chiamata."),
  p("**API Gateway invoca la Lambda.** Qui entra IAM. API Gateway non assume un nostro ruolo per invocare la funzione: è la **funzione** che lo ammette, con una *resource-based policy*. La stessa policy è applicata alle cinque Lambda di business, sostituendo `<FUNCTION_NAME>` (`real-estate-prod-property`, `-users`, `-offers`, `-presigned`, `-files`)."),
  ...codice(leggiJson("iam/resource-policies/lambda-allow-api-gateway.json"), "iam/resource-policies/lambda-allow-api-gateway.json"),
  punto("Principal `apigateway.amazonaws.com`, azione `lambda:InvokeFunction`, risorsa la singola funzione."),
  punto("La condizione `AWS:SourceArn` sull'ARN della nostra API (`arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*`) è quella che conta. Senza, il principal `apigateway.amazonaws.com` vorrebbe dire *qualunque* API Gateway, anche di un altro account: è il **confused deputy** (paragrafo 3.1). Si potrebbe restringere ancora per stage, metodo e percorso."),
  punto("La policy non si scrive a mano: si crea con `aws lambda add-permission` (o la crea la console quando si collega la route). Il file documenta il risultato."),
  p("L'authorizer JWT, invece, **non ha bisogno di ruoli**: non chiama Cognito e non agisce nell'account, verifica una firma con chiavi pubbliche. Anche i log di accesso dello stage non richiedono ruoli: per le HTTP API basta indicare il log group. Una volta dentro, la Lambda usa il proprio execution role per parlare con il database e con SNS: lo vedremo nel 4.3 e nel 4.5. Due domande diverse, due meccanismi diversi: **chi può chiamare la funzione** è la resource policy, **cosa può fare la funzione** è il suo ruolo."),

  h3("Cosa riceve la Lambda"),
  p("Con la *Lambda proxy integration* (payload 2.0) la Lambda riceve l'intera richiesta HTTP come evento: metodo, percorso, parametri, header, body e, se la route ha l'authorizer, i **claim del token già validato**. È come se API Gateway fosse il `DispatcherServlet` e la Lambda il controller. Ecco un estratto dell'evento per un agente che cancella un suo immobile:"),
  ...codice(eventoLambda, "evento ricevuto dalla Property Lambda (estratto, esempio)"),
  p("Due dettagli contano. I claim arrivano come **stringhe**: `cognito:groups`, che nel token è una lista, arriva nella forma `\"[agent]\"`, o `\"[buyer agent]\"` con più gruppi. Questo formato è quello che si osserva con le HTTP API, ma la documentazione AWS non lo fissa: va verificato alla prima prova. Per questo la lettura dei claim passa da una sola funzione comune a tutte le Lambda, che accetta sia la stringa sia un array, come un `JwtAuthenticationConverter` in Spring Security:"),
  ...codice(currentUser, "funzione comune alle Lambda (da api-gateway.md)"),
  p("Il secondo dettaglio è il controllo su **`token_use`**. AWS avverte che non c'è un modo standard per distinguere un access token da un ID token, e l'ID token di Cognito ha `aud` uguale all'ID della nostra app client: l'authorizer lo accetterebbe. La funzione comune rifiuta quindi tutto ciò che non ha `token_use = access`. L'alternativa sarebbe chiedere uno scope su ogni route (l'ID token non ha `scope`), ma vorrebbe dire configurare scope che non usiamo per nient'altro."),
  p("Il `sub` si legge **sempre dai claim**, mai dal body o dai parametri, che il client può scrivere come vuole: un `sub` o un'email nel body vengono ignorati. In Spring sarebbe esattamente questo:"),
  ...codice(spring, "l'equivalente in Spring Boot, solo per confronto"),
  p("**Autorizzazione su due livelli.** Il **ruolo** viene dai gruppi: `POST /properties` richiede `agent`, `POST /properties/{id}/offers` richiede `buyer`. L'**ownership**, cioè se quell'immobile o quell'offerta è tua, la sa solo il database: la Lambda la controlla con una query come `WHERE id = :id AND owner_id = :sub`, e se non trova la riga (e l'utente non è `admin`) risponde 403. L'authorizer dice chi sei; se la risorsa è tua lo decide la Lambda."),

  h3("Dove sta l'email, e perché"),
  p("L'email dell'utente sta **in un solo posto: Cognito**. È nell'ID token, che resta nella SPA; non è nell'access token, quindi non viaggia nelle richieste all'API; non è nel database, dove la tabella `users` ha come chiave il `sub` e nessuna colonna email; non è negli eventi di notifica, che portano solo `recipientSub`. Quando serve davvero, al momento di spedire una notifica, la **Mailer** la chiede a Cognito con `AdminGetUser`, passando il `sub` come `Username`: funziona proprio perché, con l'email come attributo di accesso, lo `username` interno è il `sub` (paragrafo 4.5)."),
  p("Così l'email è **sempre quella aggiornata**, senza una copia da riallineare, e un dump del database o un token rubato non espongono recapiti. Il prezzo è che la Mailer dipende da Cognito e il suo ruolo può leggere gli utenti del pool: vantaggi, svantaggi e alternative valutate sono nel paragrafo 5.2."),

  h3("Quando qualcosa va storto"),
  tabella(
    ["Situazione", "Chi se ne accorge", "Esito"],
    [
      ["Token mancante, firma non valida, issuer o `client_id` sbagliati", "authorizer JWT", "401; la Lambda non parte"],
      ["Token scaduto", "authorizer JWT", "401; la SPA ottiene token nuovi con il refresh token o, finché vale il cookie del login gestito, rifacendo il giro dell'authorization code senza password"],
      ["ID token al posto dell'access token", "funzione comune `currentUser` (l'authorizer lo lascerebbe passare)", "richiesta rifiutata come non autorizzata"],
      ["Gruppo sbagliato, o risorsa di un altro utente", "Lambda (gruppi; query di ownership)", "403"],
      ["Origine non ammessa dal CORS", "browser, con la risposta al preflight", "la chiamata non parte dal browser"],
      ["Troppe richieste", "throttling dello stage (rate e burst)", "richieste respinte prima delle Lambda"],
      ["Lambda oltre i 30 secondi", "HTTP API (timeout dell'integrazione)", "errore di timeout al client; per questo i file non passano dall'API (4.4)"],
    ],
    [3200, 2800, 3600],
  ),
  dopoTabella(),

  h3("Furto del token"),
  p("Cosa succede se qualcuno mette le mani su un access token? Il JWT è **firmato, non cifrato**: chi lo ha lo decodifica e legge il payload. Nel nostro access token c'è poco da leggere: un `sub` opaco, i gruppi, il `client_id`, gli scope. Con l'ID token avrebbe letto anche l'email: è uno dei vantaggi concreti del cambio."),
  p("Il rischio vero è l'**uso**. L'access token è un **bearer token**: vale per chiunque lo presenti, come una chiave di casa, e l'API non ha modo di sapere se chi lo usa è chi lo ha ricevuto. Le difese lavorano quindi su due fronti, rendere difficile rubarlo e farlo durare poco:"),
  punto("**HTTPS ovunque**: CloudFront reindirizza HTTP su HTTPS e API Gateway accetta solo TLS. Intercettare il token sulla rete non è uno scenario realistico."),
  punto("**Token in memoria nella SPA**, non in `localStorage`, che qualunque script iniettato nella pagina (XSS) potrebbe leggere. A un ricaricamento della pagina la SPA rifà il giro dell'authorization code: finché vale il cookie del login gestito l'utente non ridà la password."),
  punto("**Content-Security-Policy** e header di sicurezza aggiunti da CloudFront con una *response headers policy* sulla distribuzione del sito (4.1): solo i nostri script girano nella pagina, e le chiamate possono andare solo verso l'API, Cognito e il bucket degli upload. Uno script iniettato avrebbe difficoltà sia a girare sia a mandare fuori il token."),
  punto("**Durata breve**: 60 minuti."),
  punto("**Revoca al logout**: la SPA chiama `RevokeToken` sul refresh token (o `GlobalSignOut` per chiudere tutte le sessioni dell'utente) e butta i token dalla memoria."),
  p("**Il rischio residuo.** L'authorizer JWT controlla firma, issuer, audience e scadenza, ma **non le revoche**: non chiede a Cognito se il token è ancora buono. Un access token rubato resta quindi valido verso la nostra API fino alla scadenza, cioè **al massimo un'ora**, anche dopo un logout o un `GlobalSignOut`. Lo accettiamo per un progetto di questa taglia. L'evoluzione possibile, non adottata, è un **Backend For Frontend** (BFF): un componente che tiene i token lato server e dà al browser solo un cookie `HttpOnly`, che JavaScript non può leggere. Elimina il furto via XSS, ma aggiunge un servizio sempre in mezzo a ogni chiamata."),

  h3("Perché così"),
  tabella(
    ["Scelta", "Motivo", "Alternativa scartata"],
    [
      ["**Access token** all'API", "buona pratica OAuth/OIDC: l'access token autorizza le API, l'ID token serve al client; niente email nelle richieste", "ID token all'API (la scelta iniziale): vedi 5.2"],
      ["Authorizer JWT nativo dell'HTTP API", "verifica firma, issuer, `client_id` e scadenza senza codice nostro e senza chiamare Cognito", "Lambda Authorizer: una Lambda in più su ogni richiesta non in cache"],
      ["Controllo di `token_use` nella funzione comune", "l'authorizer da solo accetterebbe anche l'ID token, che ha `aud` = il nostro client", "scope obbligatori su ogni route: scope da configurare solo per questo"],
      ["Ruolo dai gruppi, ownership nella Lambda", "l'authorizer sa chi sei; se la risorsa è tua lo sa solo il database", "ownership nell'authorizer: cache condivisa tra le route o database a ogni richiesta"],
      ["Login gestito, authorization code con PKCE, client senza secret", "il flusso consigliato per le SPA; un secret nel browser non sarebbe segreto", "pagine di login nostre: password gestite da noi"],
      ["Token in memoria, durata 60 minuti, revoca al logout", "difese contro XSS; sotto l'ora il login gestito non accorcia la sessione", "`localStorage`: leggibile da qualunque script; BFF: un componente in più"],
      ["HTTP API, non REST API", "costa meno e ha già authorizer JWT e CORS", "REST API: usage plan, API key, WAF diretto che non ci servono"],
    ],
    [2700, 3700, 3200],
  ),
  dopoTabella(),
  p("Per passare all'access token bisognava decidere da dove prendere l'email per le notifiche. Le altre strade che abbiamo valutato (Pre Token Generation, `/oauth2/userInfo`, cache nella Lambda, Lambda Authorizer) e il motivo per cui le abbiamo scartate sono nel paragrafo 5.2."),
  ...riquadro("All'orale, in breve", [
    "**Che token mandate all'API, e perché?** L'access token: autorizza le chiamate alle API, mentre l'ID token serve alla SPA per sapere chi è loggato. Alle Lambda bastano `sub` e `cognito:groups`, che l'access token ha.",
    "**Cosa controlla l'authorizer?** Firma con il JWKS del pool, issuer, `client_id` (l'access token non ha `aud`) e scadenza, senza chiamare Cognito. Non vede le revoche; `token_use` lo controllano le Lambda.",
    "**Come fa API Gateway a poter invocare la Lambda?** Con la resource policy sulla funzione: principal `apigateway.amazonaws.com`, condizione `AWS:SourceArn` sulla nostra API contro il confused deputy.",
    "**E l'email per le notifiche, se non è nel token?** Sta solo in Cognito: la Mailer la legge con `AdminGetUser` passando il `sub`. Non è nei token verso l'API, negli eventi o nel database.",
    "**Se mi rubano un access token?** Chi lo legge vede un `sub` opaco e i gruppi; chi lo usa può chiamare l'API fino alla scadenza, al massimo un'ora. Difese: HTTPS, token in memoria, CSP, durata breve, revoca al logout.",
  ]),
];
};
