# Cognito — user pool

Cognito gestisce l'identità degli utenti: registrazione, login, verifica dell'email, cambio e reset della password,
cancellazione dell'account. Usiamo solo il **user pool**, che emette i token JWT; il ruolo applicativo dell'utente è un
**gruppo** del pool (`buyer`, `agent`, `admin`). Cognito è anche **l'unico posto dove sta l'email** degli utenti: il
database non la conserva e i token che arrivano all'API non la contengono.

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| SPA → Cognito | browser | login gestito (authorization code con PKCE) e API pubbliche di Cognito (`SignUp`, `UpdateUserAttributes`, `DeleteUser`, `RevokeToken`) |
| Cognito → SPA | browser | ID token, access token, refresh token |
| SPA → API Gateway | [api-gateway.md](api-gateway.md) | **access token** nell'header `Authorization: Bearer` |
| API Gateway ← Cognito | [api-gateway.md](api-gateway.md) | l'authorizer JWT usa issuer e chiavi pubbliche (JWKS) del pool, senza chiamare Cognito a ogni richiesta |
| Mailer Lambda → Cognito | [lambda-mailer.md](lambda-mailer.md) | `cognito-idp:AdminGetUser` firmata con il ruolo della Mailer, per leggere l'email del destinatario. La Mailer è fuori dalla VPC e usa l'endpoint pubblico regionale |
| Lambda nella VPC → Cognito | — | **nessuna chiamata**: ricevono dal token solo `sub` e `cognito:groups` |

## Cos'è e perché lo usiamo

Il user pool è la directory degli utenti più un emittente di token secondo OpenID Connect / OAuth 2.0. Ci evita di
scrivere e custodire la gestione delle password. Offre anche MFA, attributi personalizzati e policy delle password,
che si configurano sul pool. Esiste anche l'**identity pool**, che scambia un token con credenziali
AWS temporanee per accedere direttamente ai servizi AWS dal browser: non serve, perché gli upload passano da un
presigned POST ([lambda-presigned.md](lambda-presigned.md)).

## Configurazione

### User pool: l'email è l'attributo di accesso

- **User pool** `real-estate-prod-user-pool` in `eu-south-1`, issuer
  `https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>`.
- **Accesso con l'email** (`UsernameAttributes: ["email"]`): l'utente si registra ed entra con l'email. In questa
  modalità Cognito assegna come `username` interno un identificativo generato, **uguale al `sub`**, e l'email resta un
  attributo. Il `username` non cambia mai, anche se l'utente cambia email. Per questo la Mailer può chiedere l'utente a
  Cognito con `AdminGetUser` passando `Username = sub` ([lambda-mailer.md](lambda-mailer.md)).
- **Email obbligatoria e verificata automaticamente** (`Required`, `AutoVerifiedAttributes`): Cognito manda il codice
  di verifica alla registrazione.
- **Cambio email solo dopo la verifica** (`AttributesRequireVerificationBeforeUpdate`): finché l'utente non conferma il
  codice inviato al nuovo indirizzo, resta attiva l'email vecchia, già verificata. Le notifiche continuano ad arrivare.
- È un'impostazione **da scegliere alla creazione**: dopo, attributi di accesso e attributi obbligatori non si
  cambiano più.
- **Dominio** del pool: serve al login gestito (*managed login*), cioè le pagine di login di Cognito su cui la SPA fa il
  redirect con authorization code e PKCE.
- **Gruppi** `buyer`, `agent`, `admin`: finiscono nel claim `cognito:groups` del token e le Lambda li usano per il
  controllo del ruolo.

File: [`config/cognito-user-pool.json`](config/cognito-user-pool.json) (estratto dei parametri di `CreateUserPool`)

```json
{
  "PoolName": "real-estate-prod-user-pool",
  "UsernameAttributes": [
    "email"
  ],
  "AutoVerifiedAttributes": [
    "email"
  ],
  "UserAttributeUpdateSettings": {
    "AttributesRequireVerificationBeforeUpdate": [
      "email"
    ]
  },
  "Schema": [
    {
      "Name": "email",
      "AttributeDataType": "String",
      "Required": true,
      "Mutable": true
    }
  ]
}
```

### App client della SPA

- Client pubblico, **senza client secret** (il codice della SPA è leggibile da chiunque); flusso authorization code con
  **PKCE**, il consigliato per le SPA. Il suo ID è l'audience controllata dall'authorizer, che nell'access token sta nel
  claim `client_id`.
- **Scope consentiti**: `openid`, `email`, `aws.cognito.signin.user.admin`. La SPA li chiede tutti e tre nel parametro
  `scope` del login. Il terzo serve perché l'access token possa chiamare le API di Cognito sull'utente stesso
  (`DeleteUser`, `UpdateUserAttributes`, `ChangePassword`, `GetUser`): con l'authorization code non c'è se non lo si
  chiede ([più sotto](#cancellazione-dellaccount)). **Nessuno scope personalizzato né resource server**: le API non
  sono divise per scope, i permessi applicativi li danno i gruppi.
- **Permessi di scrittura degli attributi**: solo quelli che l'utente può cambiare da sé (`email`, `name`), necessari a
  `UpdateUserAttributes`.
- **Durata dei token**: ID e access token **60 minuti**, refresh token come da default. Con il login gestito AWS
  sconsiglia di scendere sotto l'ora: il login gestito lascia nel browser un cookie di sessione valido un'ora, e per
  tutta quell'ora l'utente ottiene token nuovi senza ridare la password. Un token più corto non accorcia la sessione
  vera, aggiunge solo redirect. Il limite massimo di un token rubato resta quindi un'ora ([Furto del token](#furto-del-token)).
- **Revoca dei token attiva** (`EnableTokenRevocation`): al logout la SPA chiama `RevokeToken` sul refresh token.

File: [`config/cognito-app-client.json`](config/cognito-app-client.json) (estratto dei parametri di `CreateUserPoolClient`)

```json
{
  "ClientName": "real-estate-prod-spa",
  "UserPoolId": "<USER_POOL_ID>",
  "GenerateSecret": false,
  "AllowedOAuthFlowsUserPoolClient": true,
  "AllowedOAuthFlows": [
    "code"
  ],
  "AllowedOAuthScopes": [
    "openid",
    "email",
    "aws.cognito.signin.user.admin"
  ],
  "CallbackURLs": [
    "https://<SITE_DOMAIN>/callback"
  ],
  "LogoutURLs": [
    "https://<SITE_DOMAIN>/"
  ],
  "SupportedIdentityProviders": [
    "COGNITO"
  ],
  "AccessTokenValidity": 60,
  "IdTokenValidity": 60,
  "TokenValidityUnits": {
    "AccessToken": "minutes",
    "IdToken": "minutes"
  },
  "EnableTokenRevocation": true,
  "WriteAttributes": [
    "email",
    "name"
  ]
}
```

Nessun trigger Lambda: la riga dell'utente nel database la crea `PUT /users/me` ([lambda-users.md](lambda-users.md)).

### I token

| Token | Cosa contiene | Uso nel progetto |
| --- | --- | --- |
| **ID token** (JWT) | Chi è l'utente: `sub`, `email`, `cognito:groups`, `aud` = ID dell'app client, `token_use` = `id` | **Resta nella SPA**: le serve per sapere chi è loggato (per esempio mostrare l'email nel menu). Non va all'API |
| **Access token** (JWT) | Cosa può fare: `sub`, `cognito:groups`, `client_id`, `scope`, `token_use` = `access`, `username` (che qui è uguale al `sub`). **Nessuna email** | Inviato all'HTTP API in ogni chiamata; autorizza anche le operazioni dell'utente su Cognito stesso (`UpdateUserAttributes`, `DeleteUser`) |
| **Refresh token** | — | Ottenere nuovi token senza rifare il login; revocato al logout |

Un JWT è `header.payload.firma`; la firma si verifica con la chiave pubblica pubblicata dal pool nel JWKS
(`.well-known/jwks.json`). Per questo API Gateway valida il token senza contattare Cognito. L'access token di Cognito
non ha il claim `aud` (lo avrebbe solo con un *resource binding*, che non usiamo): l'app client sta in `client_id`.

### Decisione: all'API va l'access token

La SPA manda all'HTTP API `Authorization: Bearer <access token>`. Resta l'**authorizer JWT** nativo dell'HTTP API,
senza Lambda Authorizer: issuer = il user pool, audience = l'ID dell'app client, che per l'access token l'authorizer
confronta con `client_id` ([api-gateway.md](api-gateway.md#authorizer-jwt)).

- È la buona pratica OAuth 2.0 / OIDC: l'access token serve ad autorizzare le chiamate alle API, l'ID token serve al
  client per sapere chi è l'utente.
- Le Lambda usano dai claim solo `sub` (chi è) e `cognito:groups` (che ruolo ha). Il `sub` si prende sempre dai claim
  validati, mai dal body.
- **L'email non serve all'API.** Serviva solo per le notifiche, e ora la legge la Mailer da Cognito al momento
  dell'invio ([lambda-mailer.md](lambda-mailer.md#da-dove-arriva-lemail)): gli eventi portano `recipientSub` e il
  database non ha più la colonna email ([rds-postgres.md](rds-postgres.md#dati-personali-niente-email-nel-database)).

Vantaggi:

- Access token come vuole la buona pratica OIDC.
- **Nessuna email nei token che girano verso l'API né nelle richieste.** Chi ruba e decodifica un access token legge un
  `sub` opaco, i gruppi e il `client_id`; con l'ID token avrebbe letto anche l'email.
- **L'email è sempre quella aggiornata**: se l'utente la cambia su Cognito, la Mailer usa subito quella nuova, senza
  dover riallineare una copia nel database.
- **Meno dati personali nel database** (minimizzazione dei dati, GDPR): la tabella degli utenti contiene un
  identificativo, non un recapito.
- **Nessun componente nuovo**: solo un permesso in più nel ruolo della Mailer.

Svantaggi, da dire:

- La Mailer **dipende da Cognito**: se Cognito non risponde l'email non parte. Il messaggio però non si perde: torna in
  coda, viene ritentato e dopo 5 ricezioni va nella DLQ ([sqs.md](sqs.md#ciclo-di-vita-di-un-messaggio)).
- Il ruolo della Mailer **può leggere gli utenti del pool** (`AdminGetUser`). È un rischio piccolo: può già inviare
  email, e la policy la limita a quella sola azione su quel solo pool.
- `AdminGetUser` fa contare l'utente tra gli utenti attivi del mese (MAU) su cui Cognito fattura, anche se quel mese non
  ha fatto login. Con i volumi del progetto resta nel livello gratuito.

Le alternative valutate e scartate (ID token all'API, Pre Token Generation, `userInfo`, cache nella Lambda, ID token
solo in `PUT /users/me`, Lambda Authorizer) sono in
[decisioni-e-punti-aperti.md](decisioni-e-punti-aperti.md#alternative-valutate-per-token-ed-email).

### Furto del token

Un JWT è **firmato, non cifrato**: chi lo ha in mano lo decodifica e legge il payload. Nel nostro access token c'è poco
da leggere: un `sub` opaco, i gruppi, il `client_id`, gli scope. Il rischio vero è **l'uso**: è un *bearer token*,
cioè vale per chiunque lo presenti, come una chiave di casa.

Difese:

- **HTTPS ovunque**: CloudFront reindirizza HTTP su HTTPS e API Gateway accetta solo TLS, quindi intercettare il token
  sulla rete non è uno scenario realistico.
- **Contro l'XSS i token stanno in memoria nella SPA**, non in `localStorage`, che qualunque script iniettato nella
  pagina potrebbe leggere. A un ricaricamento della pagina la SPA rifà il giro dell'authorization code: finché vale il
  cookie del login gestito (un'ora) l'utente non ridà la password.
- **Content-Security-Policy e header di sicurezza** aggiunti da CloudFront con una *response headers policy* sulla
  distribuzione del sito: limitano da dove la pagina può caricare script e verso chi può fare richieste
  ([cloudfront.md](cloudfront.md#header-di-sicurezza-response-headers-policy)).
- **Durata breve**: 60 minuti.
- **Revoca al logout**: la SPA chiama `RevokeToken` sul refresh token (o `GlobalSignOut` per chiudere tutte le
  sessioni dell'utente), poi butta i token dalla memoria.

**Rischio residuo, da dire con onestà:** l'authorizer JWT controlla firma, issuer, audience e scadenza, ma **non le
revoche** (non chiede a Cognito). Un access token rubato resta quindi valido verso la nostra API fino alla scadenza,
cioè al massimo un'ora, anche dopo un logout o un `GlobalSignOut`. Lo accettiamo per un progetto di questa taglia.

Evoluzione possibile, non adottata: un **Backend For Frontend** (BFF) che tiene i token lato server e dà al browser solo
un cookie `HttpOnly`, che JavaScript non può leggere. Elimina il furto via XSS ma aggiunge un componente sempre in
mezzo a ogni chiamata.

### Gestione dell'account dal frontend

Registrazione, login, cambio di password o email e **cancellazione dell'account** la SPA li fa **direttamente con
Cognito**, con le API pubbliche autorizzate dall'access token dell'utente (`SignUp`, `UpdateUserAttributes`,
`DeleteUser`). Così le Lambda, che stanno in una VPC senza accesso a Internet, non devono mai chiamare Cognito.

- Dopo ogni login la SPA chiama `PUT /users/me`: la Users Lambda crea o aggiorna la riga con il solo `sub` del token
  (o risponde 410 se l'utente aveva già cancellato i suoi dati: vedi sotto).
- Cambio email: lo fa la SPA con `UpdateUserAttributes`; Cognito la applica dopo la verifica del nuovo indirizzo. Nel
  database non c'è niente da riallineare.
- Per cancellare l'account: vedi [Cancellazione dell'account](#cancellazione-dellaccount).

### Cancellazione dell'account

`DeleteUser` è l'API con cui un utente cancella **il proprio** account: non usa IAM né firme AWS, riceve solo l'access
token e cancella l'utente a cui il token appartiene. La SPA la chiama con l'SDK (`DeleteUserCommand`) verso
`cognito-idp.eu-south-1.amazonaws.com`. Funziona solo se l'access token ha lo scope `aws.cognito.signin.user.admin`
(vedi la configurazione dell'app client); senza, Cognito risponde `NotAuthorizedException`.

Sequenza nella SPA:

1. **Conferma con un nuovo login.** `DeleteUser` non chiede la password: chi avesse rubato un access token valido potrebbe
   cancellare l'account. Prima di un'operazione irreversibile la SPA fa rifare il login, così il token è appena emesso.
   Con il login gestito il cookie di sessione vale un'ora e salterebbe la password: la SPA apre il login con
   `prompt=login`, che forza una nuova autenticazione (da verificare sulla configurazione del login gestito).
2. **`DELETE /users/me`**: la Users Lambda anonimizza i dati applicativi in una transazione: il profilo resta con il
   solo `sub` e `deleted_at`, immobili e offerte in sospeso passano a ritirati
   ([lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione)).
3. **`DeleteUser`** su Cognito con l'access token.
4. **Logout**: la SPA toglie dalla memoria tutti i token.

Perché prima il database e poi Cognito: se fallisce `DeleteUser` l'account esiste ancora, l'utente rientra e riprova.
Il profilo però è già anonimizzato e **non si ricrea**: al login la SPA chiama `PUT /users/me`, riceve 410 e capisce
che la cancellazione era già confermata; chiama allora direttamente `DeleteUser` con il token appena ottenuto e fa il
logout, senza ripassare dal passo 2. Con l'ordine
inverso, se fallisse `DELETE /users/me` l'utente non potrebbe più fare login per riprovare e i suoi dati resterebbero nel
database senza nessuno che li possa cancellare.

Dopo la cancellazione, una notifica ancora in coda per quell'utente non trova più il destinatario: `AdminGetUser`
risponde `UserNotFoundException`, la Mailer lo registra come caso previsto e scarta il messaggio senza ritentarlo
([lambda-mailer.md](lambda-mailer.md#classificazione-degli-errori)). Con l'email fuori dal database, cancellare l'account
su Cognito toglie davvero l'ultimo recapito dell'utente.

Limite: `DeleteUser` invalida il refresh token, ma ID e access token già emessi restano validi fino alla scadenza.
L'authorizer di API Gateway controlla solo firma e scadenza, non se l'utente esiste ancora. Per questo la SPA butta i
token al passo 4 e la loro durata è di 60 minuti. Il rischio si ferma alle letture: sulle route che scrivono le Lambda
controllano che la riga `users` del `sub` non abbia `deleted_at` (altrimenti 403), e `PUT /users/me` risponde 410
invece di ricreare il profilo ([api-gateway.md](api-gateway.md#authorizer-jwt)).

Alternative scartate: chiamare `AdminDeleteUser` dalla Users Lambda (dalla VPC non c'è strada: servirebbe un interface
endpoint `cognito-idp`, che esiste ma ha limiti, oppure un evento gestito da una Lambda fuori dalla VPC).

## IAM

Il user pool e l'authorizer JWT **non hanno ruoli né trust da configurare**: l'authorizer valida i token con le chiavi
pubbliche e non agisce nell'account. I ruoli comparirebbero con le identity pool (trust verso
`cognito-identity.amazonaws.com`) o con i trigger Lambda (resource policy sulla Lambda per `cognito-idp.amazonaws.com`),
che non usiamo. Vedi [iam.md](iam.md#cosa-non-ha-bisogno-di-ruoli).

C'è **un solo permesso IAM verso Cognito**, nel ruolo della Mailer: `cognito-idp:AdminGetUser` sul solo ARN del pool.
`AdminGetUser` è un'operazione amministrativa: si autorizza solo con credenziali IAM (firma SigV4), non con un token di
un utente.

```json
{
  "Sid": "ReadRecipientEmailFromUserPool",
  "Effect": "Allow",
  "Action": "cognito-idp:AdminGetUser",
  "Resource": "arn:aws:cognito-idp:eu-south-1:<ACCOUNT_ID>:userpool/<USER_POOL_ID>"
}
```

Lo statement completo sta in [`iam/policies/lambda-mailer.json`](iam/policies/lambda-mailer.json) ed è spiegato in
[lambda-mailer.md](lambda-mailer.md#iam).

## Sicurezza e rete

- Cognito è un servizio regionale fuori dalla VPC: niente security group.
- Le Lambda nella VPC non lo chiamano. La Mailer, fuori dalla VPC, raggiunge l'endpoint pubblico regionale
  `cognito-idp.eu-south-1.amazonaws.com` sulla rete di AWS, senza endpoint VPC né NAT.
- PrivateLink per Cognito esiste, ma con limiti che a noi lo renderebbero inutile: non accetta le richieste ai
  *domain endpoint* del pool (login gestito, `/oauth2/token`, `/oauth2/userInfo`), e un user pool con un dominio
  assegnato, come il nostro, non è compatibile con PrivateLink.
- I gruppi del token decidono il **ruolo**; l'**ownership** (l'immobile è tuo?) la controllano le Lambda nel database
  ([api-gateway.md](api-gateway.md#autorizzazione-su-due-livelli)).
- Cognito può usare SES per le email di verifica, con le quote di default.

## Quote

`AdminGetUser` rientra nella categoria di quota **UserRead** (insieme a `GetUser`), con un numero di richieste al secondo
per account e regione che si può alzare. La Mailer fa una chiamata per email e gira con concorrenza massima 2
([lambda-mailer.md](lambda-mailer.md#configurazione)): restiamo molto sotto. Se la quota venisse superata Cognito
risponde `TooManyRequestsException`, che la Mailer tratta come errore temporaneo e ritenta.

## Riferimenti

- [Endpoint di Cognito per regione](https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html)
- [L'access token di Cognito (claim, `client_id`, `aud` solo con resource binding, durata e login gestito)](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [Attributi e attributi di accesso: con `UsernameAttributes` lo `username` è un UUID uguale al `sub`](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html)
- [`AdminGetUser` (`Username` può essere il `sub`, autorizzazione IAM, errori)](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUser.html)
- [Quote di Cognito (categoria UserRead, MAU)](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html)
- [Cognito e PrivateLink (domain endpoint esclusi, pool con dominio incompatibili)](https://docs.aws.amazon.com/cognito/latest/developerguide/vpc-interface-endpoints.html)
- [Authorizer JWT delle HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)

## All'orale

> **Che token mandate all'API, e perché?**
> L'access token, come vuole la buona pratica OIDC: l'access token autorizza le chiamate alle API, l'ID token serve al
> client per sapere chi è loggato. L'authorizer JWT controlla issuer, firma, scadenza e `client_id`. Alle Lambda
> servono solo `sub` e `cognito:groups`, che ci sono.
>
> **E l'email per le notifiche, se non è nel token?**
> La legge la Mailer da Cognito con `AdminGetUser`, passando il `sub` come `Username`: funziona perché il pool usa
> l'email come attributo di accesso e allora lo username interno è il `sub`. Gli eventi portano `recipientSub`, il
> database non ha l'email. Così è sempre quella aggiornata e non gira nei token.
>
> **Prima usavate l'ID token: cosa non andava?**
> Funzionava, ma l'ID token serve a identificare l'utente presso il client, non ad autorizzare le API, e portava
> l'email in ogni richiesta. Il prof ci ha chiesto l'access token, e spostando la lettura dell'email nella Mailer non
> abbiamo aggiunto componenti.
>
> **Se mi rubano un access token cosa succede?**
> Chi lo decodifica legge solo un `sub` opaco, i gruppi e il `client_id`. Ma può usarlo, perché è un bearer token, fino
> alla scadenza: al massimo un'ora, perché l'authorizer non controlla le revoche. Le difese sono HTTPS ovunque, token in
> memoria e non in `localStorage`, CSP da CloudFront, durata breve e revoca al logout.
>
> **Perché 60 minuti e non 30?**
> Con il login gestito AWS sconsiglia di scendere sotto l'ora: il cookie di sessione del login vale un'ora, quindi un
> token di 30 minuti non accorcia la sessione, aggiunge solo redirect.
>
> **Come distingue l'API un access token da un ID token?**
> Dal claim `token_use` (`access` o `id`). L'authorizer da solo non lo controlla, e l'ID token ha `aud` uguale al nostro
> client: per questo le Lambda rifiutano i token con `token_use` diverso da `access`.
>
> **Cos'è Cognito, in una frase?**
> Un authorization server gestito, come avere Spring Security più un Keycloak senza doverlo installare e mantenere.
>
> **Differenza tra user pool e identity pool?**
> Il user pool autentica e rilascia JWT; l'identity pool scambia un token con credenziali AWS temporanee. Usiamo solo il
> primo: gli upload passano da un presigned POST, non da credenziali AWS nel browser.
>
> **Come fa API Gateway a validare il token senza chiamare Cognito?**
> Verifica la firma con le chiavi pubbliche del pool (JWKS) e controlla issuer, audience (`client_id`) e scadenza. È lo
> stesso meccanismo di `oauth2ResourceServer().jwt()` in Spring Security, configurato con l'issuer URI.
>
> **Dove sono i ruoli degli utenti?**
> Nei gruppi Cognito, che arrivano nel claim `cognito:groups`. Il controllo lo fa la Lambda, come un `@PreAuthorize`
> su un metodo di service; l'ownership è una query nel database.
>
> **Perché la SPA non ha un client secret?**
> Perché il suo codice è pubblico nel browser: un secret non sarebbe segreto. Si usa un client pubblico con PKCE.
>
> **Come si cancella un account se le Lambda non raggiungono Cognito?**
> Lo fa la SPA: dopo un nuovo login di conferma, prima `DELETE /users/me` per i dati nel database, poi `DeleteUser` su
> Cognito con l'access token, poi logout.
>
> **Perché serve lo scope `aws.cognito.signin.user.admin`?**
> È lo scope che permette all'access token di agire sull'utente stesso tramite le API di Cognito. Con il login tramite
> authorization code arriva solo se l'app client lo consente e la SPA lo chiede; senza, `DeleteUser` viene rifiutata.
>
> **Dopo `DeleteUser` il token funziona ancora con la nostra API?**
> Sì, fino alla scadenza: l'authorizer verifica firma e scadenza senza chiedere a Cognito. Per questo la SPA cancella i
> token subito e la durata è di 60 minuti. Però può solo leggere: le scritture trovano `deleted_at` sulla riga
> dell'utente e ricevono 403, e `PUT /users/me` risponde 410. Le notifiche ancora in coda per lui finiscono con `UserNotFoundException` e
> vengono scartate.
