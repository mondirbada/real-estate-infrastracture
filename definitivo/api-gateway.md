# API Gateway — HTTP API

API Gateway è la porta d'ingresso del backend: espone le route HTTP pubbliche, valida il JWT di Cognito con un
authorizer nativo, applica CORS e throttling e inoltra ogni richiesta alla Lambda del suo *scope*. Usiamo una
**HTTP API** (`<API_ID>`), con l'authorizer JWT e il CORS integrati.

## Collegamenti

| Direzione | Con chi | Come | Autorizzato da |
| --- | --- | --- | --- |
| Browser → API | SPA servita da [CloudFront](cloudfront.md) | HTTPS, `Authorization: Bearer <access token>` | authorizer JWT; CORS |
| API ← Cognito | [cognito.md](cognito.md) | issuer e JWKS del user pool | nessun ruolo |
| API → Lambda | [lambda-property.md](lambda-property.md), [lambda-users.md](lambda-users.md), [lambda-offers.md](lambda-offers.md), [lambda-presigned.md](lambda-presigned.md), [lambda-files.md](lambda-files.md) | invocazione sincrona, *Lambda proxy integration* | resource policy sulla Lambda |
| API → CloudWatch | [cloudwatch.md](cloudwatch.md) | log di accesso dello stage | basta il log group, nessun ruolo |

## Perché un'HTTP API

| | HTTP API (scelta) | REST API |
| --- | --- | --- |
| Costo | più bassa | più alta |
| Authorizer JWT nativo | sì | no (ha il Cognito authorizer) |
| CORS | integrato | da configurare per metodo |
| Usage plan, API key, validazione delle richieste, cache | no | sì |
| AWS WAF associato direttamente | no | sì |

Ci serve tutto quello che offre l'HTTP API e niente di ciò che ha in più la REST API. Esiste anche la WebSocket API,
che non usiamo. Il timeout d'integrazione è circa 29 secondi per la REST API e 30 secondi per l'HTTP API.

## Configurazione

### Integrazione e limiti

- Ogni route ha un'integrazione **Lambda proxy** (payload 2.0): la Lambda riceve l'intera richiesta HTTP come evento e
  restituisce status, header e body.
- Le route si pubblicano con un *deployment* su uno *stage* (il nostro di produzione), che può avere variabili di stage;
  lo stage ha l'*access log* su CloudWatch.
- Timeout dell'integrazione 30 secondi, payload massimo 10 MB: per questo i file non passano dall'API ma vanno su S3 con
  un presigned POST ([lambda-presigned.md](lambda-presigned.md)).

### Authorizer JWT

La SPA manda l'**access token** di Cognito: `Authorization: Bearer <access token>` (identity source
`$request.header.Authorization`; il prefisso `Bearer` è accettato).

- Issuer: `https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>`.
- Audience: l'ID dell'app client della SPA. L'authorizer confronta l'audience con il claim `aud` se c'è, altrimenti con
  `client_id`. L'access token di Cognito non ha `aud` (lo avrebbe solo con un *resource binding*, che non usiamo),
  quindi il controllo avviene su `client_id`.
- Valida firma (chiavi pubbliche JWKS del pool, tenute in cache da API Gateway), issuer, audience, scadenza (`exp`),
  `nbf` e `iat` **senza chiamare Cognito** a ogni richiesta. Se un controllo fallisce risponde 401 e la Lambda non parte.
- **Nessuno scope sulle route**: non usiamo scope personalizzati né resource server. I permessi applicativi stanno nei
  gruppi.

Alle Lambda inoltra i claim del token in `event.requestContext.authorizer.jwt.claims`. Le Lambda ne usano due:

| Claim | Valore che arriva alla Lambda | Uso |
| --- | --- | --- |
| `sub` | `"a1b2c3d4-..."` | chi è l'utente: proprietario, autore dell'offerta, chiave della riga in `users` |
| `cognito:groups` | una **stringa**, per esempio `"[buyer agent]"`, non un array JSON | controllo del ruolo |

Nella documentazione AWS i claim arrivano alla Lambda come coppie nome-valore di tipo stringa; il formato `"[a b]"` dei
claim lista è quello che si osserva con le HTTP API, e va verificato alla prima prova. Per questo il controllo del ruolo
passa da una funzione comune a tutte le Lambda, come un `JwtAuthenticationConverter` in Spring Security:

```javascript
// Legge identità e gruppi dai claim già validati dall'authorizer.
export function currentUser(event) {
  const claims = event.requestContext.authorizer.jwt.claims;
  if (claims.token_use !== "access") {
    throw new UnauthorizedError("serve un access token");
  }
  const raw = claims["cognito:groups"] ?? "";
  const groups = Array.isArray(raw) ? raw : raw.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
  return { sub: claims.sub, groups };
}
```

- Il `sub` si prende **sempre dai claim**, mai dal body o dai parametri della richiesta, che il client può scrivere come
  vuole.
- **Perché il controllo su `token_use`.** AWS avverte che non c'è un modo standard per distinguere un access token da un
  ID token, e l'ID token di Cognito ha `aud` uguale all'ID dell'app client: l'authorizer lo accetterebbe. La funzione
  comune rifiuta tutto ciò che non ha `token_use = access`. In alternativa si potrebbe chiedere uno scope sulla route
  (l'ID token non ha `scope`), ma vorrebbe dire configurare scope su ogni route.

**Decisione: il token è l'access token.** È la buona pratica OIDC per autorizzare le API, e alle Lambda bastano `sub` e
gruppi. L'email, che prima ci obbligava a usare l'ID token, ora la legge la Mailer da Cognito al momento dell'invio.
Motivi, vantaggi e svantaggi in [cognito.md](cognito.md#decisione-allapi-va-laccess-token); il furto del token e il
rischio residuo (l'authorizer non vede le revoche) in [cognito.md](cognito.md#furto-del-token).

### Autorizzazione su due livelli

- **Ruolo** (cosa può fare quel tipo di utente): letto dal claim `cognito:groups`, controllato nella Lambda dello scope.
- **Ownership** (se quell'immobile o quell'offerta è sua): la Lambda confronta il `sub` del token con il proprietario
  letto dal database, per esempio `WHERE id = :id AND owner_id = :sub`.

Non usiamo una **Lambda Authorizer** (che può essere *token-based* o *request-based*, con cache dei risultati). Su una route API Gateway usa un solo authorizer, quindi non si somma a quello JWT.
Se se ne attiva la cache, per default la risposta vale per tutte le route che usano l'authorizer, quindi una decisione
per singola risorsa non è affidabile lì dentro; senza cache servirebbe una lettura del database a ogni richiesta, con una
Lambda in VPC che aggiunge latenza e cold start a ogni chiamata.

### Route

Ogni route punta alla Lambda del suo scope. Le route di sola lettura degli annunci sono pubbliche (un visitatore può
guardare gli immobili senza account); tutte le altre richiedono il JWT.

| Route | Lambda | Accesso |
| --- | --- | --- |
| `GET /properties`, `GET /properties/{id}` | Property | pubblica |
| `POST /properties` | Property | JWT, gruppo `agent` |
| `PUT /properties/{id}`, `DELETE /properties/{id}` | Property | JWT, proprietario o `admin` |
| `GET /users/me`, `PUT /users/me`, `DELETE /users/me` | Users | JWT |
| `GET /users/{id}` (profilo pubblico dell'agente) | Users | pubblica |
| `POST /properties/{id}/offers` | Offers | JWT, gruppo `buyer` |
| `GET /offers`, `PUT /offers/{id}` (accetta o rifiuta), `DELETE /offers/{id}` | Offers | JWT, chi ha fatto l'offerta o il proprietario dell'immobile |
| `POST /properties/{id}/uploads` | Presigned | JWT, proprietario |
| `GET /properties/{id}/files` | Files | pubblica |
| `DELETE /files/{id}` | Files | JWT, proprietario |

Le route sono esplicite (niente `$default` né `ANY /{proxy+}`): con il CORS configurato l'API risponde da sola alle
richieste preflight `OPTIONS`, senza farle passare dall'authorizer.

### CORS

La SPA (dominio CloudFront) e l'API hanno origini diverse, quindi il browser applica CORS. La configurazione
(`CorsConfiguration` dell'HTTP API) ammette solo l'origine del sito, i metodi usati e gli header `authorization` e
`content-type`. `<SITE_DOMAIN>` è il dominio della distribuzione del sito, per esempio `d1234abcd.cloudfront.net`.

File: [`config/http-api-cors.json`](config/http-api-cors.json)

```json
{
  "AllowOrigins": [
    "https://<SITE_DOMAIN>"
  ],
  "AllowMethods": [
    "GET",
    "POST",
    "PUT",
    "DELETE"
  ],
  "AllowHeaders": [
    "authorization",
    "content-type"
  ],
  "MaxAge": 3600
}
```

### Throttling

Throttling sullo stage (rate e burst) contro gli abusi. AWS WAF non si può associare direttamente a un'HTTP API: è uno
sviluppo futuro, mettendo CloudFront davanti all'API.

## IAM

### API Gateway → Lambda: resource policy sulla funzione

Per invocare una funzione API Gateway non assume un nostro ruolo: è la funzione che lo ammette con una
**resource-based policy**. Si applica alle 5 Lambda di business sostituendo `<FUNCTION_NAME>`
(`real-estate-prod-property`, `-users`, `-offers`, `-presigned`, `-files`).

File: [`iam/resource-policies/lambda-allow-api-gateway.json`](iam/resource-policies/lambda-allow-api-gateway.json)

```json
{
  "Version": "2012-10-17",
  "Id": "default",
  "Statement": [
    {
      "Sid": "AllowHttpApiInvoke",
      "Effect": "Allow",
      "Principal": {
        "Service": "apigateway.amazonaws.com"
      },
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-south-1:<ACCOUNT_ID>:function:<FUNCTION_NAME>",
      "Condition": {
        "ArnLike": {
          "AWS:SourceArn": "arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*"
        }
      }
    }
  ]
}
```

- Principal `apigateway.amazonaws.com`, azione `lambda:InvokeFunction`.
- Condizione `AWS:SourceArn` = `arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*`: solo la nostra API. Senza,
  qualunque API Gateway di qualunque account potrebbe invocare la funzione (*confused deputy*). Si può restringere
  ancora per stage, metodo e percorso.
- Non si scrive a mano come JSON: si crea con `aws lambda add-permission` (o la crea la console quando si collega la
  route), per esempio
  `aws lambda add-permission --function-name real-estate-prod-property --statement-id apigw-invoke --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*"`.
  Il file documenta il risultato.

### Cosa non serve

- L'authorizer JWT non richiede ruoli: non chiama Cognito e non agisce nell'account.
- Log su CloudWatch: per le HTTP API basta indicare il log group nelle impostazioni di accesso dello stage. Il ruolo
  CloudWatch a livello account (`AmazonAPIGatewayPushToCloudWatchLogs`, trust `apigateway.amazonaws.com`) serve solo alle
  REST API.

## Sicurezza e rete

- Servizio regionale fuori dalla VPC: niente security group. Invoca le Lambda tramite il servizio Lambda, non entra
  nella VPC.
- HTTPS obbligatorio; JWT obbligatorio su tutte le route non pubbliche; throttling sullo stage.
- Custom domain: possibile con un certificato ACM nella stessa regione (le API regionali); per la presentazione basta
  il dominio predefinito di API Gateway.

## Costi

Si paga per richiesta; con il traffico del progetto resta nel livello gratuito o a pochi centesimi.

## Riferimenti

- [Authorizer JWT per HTTP API (`aud` o `client_id`, claim inoltrati alla Lambda)](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Formato del payload 2.0 verso la Lambda (`requestContext.authorizer.jwt.claims`)](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)
- [Lambda Authorizer per HTTP API (cache)](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html)
- [CORS per HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)
- [Log delle HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)

## All'orale

> **Che token riceve l'API e cosa controlla l'authorizer?**
> L'access token di Cognito. L'authorizer verifica la firma con il JWKS del pool, l'issuer, la scadenza e che il
> `client_id` sia quello della nostra SPA (l'access token non ha `aud`). Non chiama Cognito e non vede le revoche.
>
> **Come arriva il gruppo alla Lambda?**
> Nei claim, in `event.requestContext.authorizer.jwt.claims`: `cognito:groups` arriva come stringa tipo
> `"[buyer agent]"`, e una funzione comune la trasforma in lista. Il `sub` si legge da lì, mai dal body.
>
> **HTTP API o REST API: perché?**
> L'HTTP API costa meno e ha già authorizer JWT e CORS, cioè tutto ciò che ci serve. La REST API servirebbe per usage
> plan, API key, validazione delle richieste o WAF diretto.
>
> **Cos'è la Lambda proxy integration?**
> API Gateway passa alla Lambda l'intera richiesta (metodo, path, header, body, claim) e restituisce al client la
> risposta che la Lambda costruisce. È come se API Gateway fosse il `DispatcherServlet` e la Lambda il controller.
>
> **Perché non una Lambda Authorizer per controllare l'ownership?**
> La cache dell'authorizer, se attiva, riusa la decisione su tutte le route; senza cache servirebbe il database a ogni
> richiesta. L'authorizer dice chi sei, se l'immobile è tuo lo sa solo la Lambda con il database: è come tenere il
> filtro JWT di Spring Security per l'autenticazione e il controllo del proprietario nel service.
>
> **Come fa API Gateway a poter invocare la Lambda?**
> Con una resource policy sulla funzione: principal `apigateway.amazonaws.com` e `AWS:SourceArn` della nostra API.
>
> **Cosa succede se la Lambda impiega più di 30 secondi?**
> L'HTTP API risponde con un errore di timeout al client. Le operazioni lunghe (upload) non passano dall'API.
>
> **Come vi difendete dagli abusi?**
> Throttling sullo stage, JWT obbligatorio sulle route non pubbliche, CORS solo per il nostro sito. WAF sull'API è
> uno sviluppo futuro con CloudFront davanti.
