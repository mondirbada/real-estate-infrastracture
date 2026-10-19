# API Gateway (HTTP API) e Cognito

## Authorizer JWT

L'authorizer JWT dell'HTTP API usa il user pool Cognito come issuer
(`https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>`) e l'ID dell'app client come
audience. Valida il token con le chiavi pubbliche del pool (JWKS) e **non richiede ruoli IAM**:
non chiama Cognito a ogni richiesta e non agisce nell'account.

Cognito, con solo user pool e JWT, non ha ruoli né trust da configurare. Servirebbero con le
*identity pool* (credenziali AWS agli utenti finali) o con i trigger Lambda, che non usiamo.

## API Gateway → Lambda

Per invocare una funzione, API Gateway non assume un nostro ruolo: è la funzione che lo ammette
con una **resource-based policy**. Template:
[`lambda-allow-api-gateway.json`](resource-policies/lambda-allow-api-gateway.json), da applicare
alle 5 Lambda di business sostituendo `<FUNCTION_NAME>`.

- Principal: `apigateway.amazonaws.com`.
- Azione: `lambda:InvokeFunction`.
- Condizione: `AWS:SourceArn` = `arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*`, cioè solo la
  nostra API. Senza la condizione, qualunque API Gateway di qualunque account potrebbe invocare la
  funzione (*confused deputy*). Si può restringere ancora per stage, metodo e percorso.

Non si scrive a mano come JSON: si crea con `aws lambda add-permission` (o la crea la console quando
si collega la route). Il file serve a documentare e spiegare il risultato.

## Log su CloudWatch

Per le **HTTP API** basta indicare il log group nelle impostazioni di accesso dello stage: non
serve il ruolo CloudWatch a livello account, che riguarda solo le REST API.

## CORS

Configurazione in [`config/http-api-cors.json`](../config/http-api-cors.json): solo l'origine del sito,
header `authorization` e `content-type`. Con il CORS configurato e route esplicite, l'API risponde
da sola alle richieste preflight `OPTIONS`.

## Riferimenti

- [Authorizer JWT per HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [CORS per HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)
- [Log delle HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)
