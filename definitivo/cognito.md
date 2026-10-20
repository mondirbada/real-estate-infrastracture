# Cognito — user pool

Cognito gestisce l'identità degli utenti: registrazione, login, verifica dell'email, cambio e reset della password,
cancellazione dell'account. Usiamo solo il **user pool**, che emette i token JWT; il ruolo applicativo dell'utente è un
**gruppo** del pool (`buyer`, `agent`, `admin`).

## Collegamenti

| Direzione | Con chi | Come |
| --- | --- | --- |
| SPA → Cognito | browser | API pubbliche di Cognito (`SignUp`, login, `UpdateUserAttributes`, `DeleteUser`) |
| Cognito → SPA | browser | ID token, access token, refresh token |
| SPA → API Gateway | [api-gateway.md](api-gateway.md) | ID token nell'header `Authorization` |
| API Gateway ← Cognito | [api-gateway.md](api-gateway.md) | l'authorizer JWT usa issuer e chiavi pubbliche (JWKS) del pool, senza chiamare Cognito a ogni richiesta |
| Lambda → Cognito | — | **nessuna chiamata**: le Lambda stanno in una VPC senza Internet e ricevono i claim dal token |

## Cos'è e perché lo usiamo

Il user pool è la directory degli utenti più un emittente di token secondo OpenID Connect / OAuth 2.0. Ci evita di
scrivere e custodire la gestione delle password. Offre anche MFA, attributi personalizzati e policy delle password,
che si configurano sul pool. Esiste anche l'**identity pool**, che scambia un token con credenziali
AWS temporanee per accedere direttamente ai servizi AWS dal browser: non serve, perché gli upload passano da un
presigned POST ([lambda-presigned.md](lambda-presigned.md)).

## Configurazione

- **User pool** in `eu-south-1`, issuer `https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>`.
- **Gruppi** `buyer`, `agent`, `admin`: finiscono nel claim `cognito:groups` del token e le Lambda li usano per il
  controllo del ruolo.
- **App client** della SPA: client pubblico, **senza client secret** (il codice della SPA è leggibile da chiunque); per
  le SPA il flusso consigliato è l'authorization code con **PKCE**. Il suo ID è l'audience controllata dall'authorizer.
- **Scope consentiti** dell'app client: `openid`, `email`, `aws.cognito.signin.user.admin`. La SPA li chiede tutti e tre
  nel parametro `scope` del login. Il terzo serve perché l'access token possa chiamare le API di Cognito sull'utente
  stesso (`DeleteUser`, `UpdateUserAttributes`, `ChangePassword`, `GetUser`): con l'authorization code non c'è se non
  lo si chiede ([più sotto](#cancellazione-dellaccount)).
- **Permessi di scrittura degli attributi** dell'app client: solo quelli che l'utente può cambiare da sé (per esempio
  `email`, `name`), necessari a `UpdateUserAttributes`.
- **Durata dei token**: ID e access token 30 minuti (default 60), refresh token come da default. Più corta è, meno
  dura un token rubato o un token di un account appena cancellato.
- Nessun trigger Lambda: la riga dell'utente nel database la crea `PUT /users/me` ([lambda-users.md](lambda-users.md)).

### I token

| Token | Cosa contiene | Uso nel progetto |
| --- | --- | --- |
| **ID token** (JWT) | Chi è l'utente: `sub`, `email`, `cognito:groups`, `aud` = ID dell'app client | Inviato all'HTTP API in ogni chiamata |
| **Access token** (JWT) | Cosa può fare: scope, `client_id` | Autorizza le operazioni dell'utente su Cognito stesso (`UpdateUserAttributes`, `DeleteUser`) |
| **Refresh token** | — | Ottenere nuovi token senza rifare il login |

Un JWT è `header.payload.firma`; la firma si verifica con la chiave pubblica pubblicata dal pool nel JWKS
(`.well-known/jwks.json`). Per questo API Gateway valida il token senza contattare Cognito.

### Decisione: all'API va l'ID token

Il frontend manda all'HTTP API l'**ID token** di Cognito; l'authorizer JWT controlla l'issuer (il user pool) e
l'audience (l'ID dell'app client, che nell'ID token sta nel claim `aud`). È una decisione presa.

- Le Lambda hanno bisogno dell'email e dell'identità dell'utente: la riga nel database con `PUT /users/me` e le
  notifiche al proprietario quando riceve un'offerta. L'ID token le contiene già (`email`, `sub`), l'access token no.
- Con l'access token l'email andrebbe presa dal body della richiesta, che è falsificabile, oppure chiesta a Cognito con
  `GetUser`, cosa che le Lambda in una VPC senza NAT non possono fare senza un endpoint in più. Aggiungere `email`
  all'access token con una *Pre Token Generation* Lambda complicherebbe il progetto per niente.
- Non usiamo scope OAuth né resource server, quindi l'access token non ci darebbe nulla in più.
- **Limite, da dire con onestà:** per OIDC l'ID token serve a identificare l'utente, mentre per autorizzare le API la
  buona pratica è l'access token con gli scope. Se un giorno servissero permessi a scope (per esempio un'app di terze
  parti) si passerebbe all'access token. L'authorizer JWT dell'HTTP API accetta tutti e due (`aud` nell'ID token,
  `client_id` nell'access token), quindi il cambio sarebbe solo di configurazione.

### Gestione dell'account dal frontend

Registrazione, login, cambio di password o email e **cancellazione dell'account** la SPA li fa **direttamente con
Cognito**, con le API pubbliche autorizzate dall'access token dell'utente (`SignUp`, `UpdateUserAttributes`,
`DeleteUser`). Così le Lambda, che stanno in una VPC senza accesso a Internet, non devono mai chiamare Cognito.

- Dopo ogni login la SPA chiama `PUT /users/me`: la Users Lambda crea o aggiorna la riga con `sub` ed `email` del token.
- Per cancellare l'account: vedi [Cancellazione dell'account](#cancellazione-dellaccount).

### Cancellazione dell'account

`DeleteUser` è l'API con cui un utente cancella **il proprio** account: non usa IAM né firme AWS, riceve solo l'access
token e cancella l'utente a cui il token appartiene. La SPA la chiama con l'SDK (`DeleteUserCommand`) verso
`cognito-idp.eu-south-1.amazonaws.com`. Funziona solo se l'access token ha lo scope `aws.cognito.signin.user.admin`
(vedi la configurazione dell'app client); senza, Cognito risponde `NotAuthorizedException`.

Sequenza nella SPA:

1. **Conferma con un nuovo login.** `DeleteUser` non chiede la password: chi avesse rubato un access token valido potrebbe
   cancellare l'account. Prima di un'operazione irreversibile la SPA fa rifare il login, così il token è appena emesso.
2. **`DELETE /users/me`**: la Users Lambda cancella o anonimizza i dati applicativi.
3. **`DeleteUser`** su Cognito con l'access token.
4. **Logout**: la SPA toglie dalla memoria tutti i token.

Perché prima il database e poi Cognito: se fallisce `DeleteUser` l'account esiste ancora, l'utente rientra e riprova
(se intanto chiama `PUT /users/me` gli si ricrea un profilo vuoto, che la nuova cancellazione toglie). Con l'ordine
inverso, se fallisse `DELETE /users/me` l'utente non potrebbe più fare login per riprovare e i suoi dati resterebbero nel
database senza nessuno che li possa cancellare.

Limite: `DeleteUser` invalida il refresh token, ma ID e access token già emessi restano validi fino alla scadenza.
L'authorizer di API Gateway controlla solo firma e scadenza, non se l'utente esiste ancora. Per questo la SPA butta i
token al passo 4 e la loro durata è di 30 minuti.

Alternative scartate: chiamare `AdminDeleteUser` dalla Users Lambda (dalla VPC non c'è strada: servirebbe un interface
endpoint `cognito-idp`, che esiste ma ha limiti, oppure un evento gestito da una Lambda fuori dalla VPC).

## IAM

Con il solo user pool e i JWT **non ci sono ruoli né trust da configurare**: l'authorizer valida i token con le chiavi
pubbliche e non agisce nell'account. I ruoli comparirebbero con le identity pool (trust verso
`cognito-identity.amazonaws.com`) o con i trigger Lambda (resource policy sulla Lambda per `cognito-idp.amazonaws.com`),
che non usiamo. Vedi [iam.md](iam.md#cosa-non-ha-bisogno-di-ruoli).

## Sicurezza e rete

- Cognito è un servizio regionale fuori dalla VPC: niente security group.
- Le Lambda non lo chiamano, quindi non serve PrivateLink per Cognito. Esiste da novembre 2025, ma con limiti: non vale
  per la hosted UI/managed login né per il flusso client credentials, e un user pool con un dominio assegnato non è
  compatibile.
- I gruppi del token decidono il **ruolo**; l'**ownership** (l'immobile è tuo?) la controllano le Lambda nel database
  ([api-gateway.md](api-gateway.md#autorizzazione-su-due-livelli)).
- Cognito può usare SES per le email di verifica, con le quote di default.

## Riferimenti

- [Endpoint di Cognito per regione](https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html)

## All'orale

> **Perché all'API mandate l'ID token e non l'access token?**
> Perché le Lambda hanno bisogno di `email` e `sub` e l'ID token li contiene; con l'access token l'email andrebbe presa
> dal body (falsificabile) o chiesta a Cognito con `GetUser`, che dalla VPC senza NAT non si raggiunge. Non usiamo
> scope, quindi l'access token non darebbe nulla in più. Il limite: la buona pratica OIDC vuole l'access token per le
> API; se servissero scope cambieremmo solo la configurazione dell'authorizer.
>
> **Cos'è Cognito, in una frase?**
> Un authorization server gestito, come avere Spring Security più un Keycloak senza doverlo installare e mantenere.
>
> **Differenza tra user pool e identity pool?**
> Il user pool autentica e rilascia JWT; l'identity pool scambia un token con credenziali AWS temporanee. Usiamo solo il
> primo: gli upload passano da un presigned POST, non da credenziali AWS nel browser.
>
> **Come fa API Gateway a validare il token senza chiamare Cognito?**
> Verifica la firma con le chiavi pubbliche del pool (JWKS) e controlla issuer, audience e scadenza. È lo stesso
> meccanismo di `oauth2ResourceServer().jwt()` in Spring Security, configurato con l'issuer URI.
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
> token subito e la durata è corta (30 minuti).
