# Domora

Progettazione di un portale immobiliare per più agenzie su AWS: catalogo pubblico, annunci, contatti e richieste di visita.

La nuova versione è documentata in [domora/docs](domora/docs/README.md). Per una lettura complessiva, partire da [Sintesi e presentazione](domora/docs/16-sintesi-e-presentazione.md).

Per la versione da realizzare durante la presentazione, vedere il [piano della demo AWS](domora/demo/README.md): mantiene PostgreSQL e i componenti centrali, riducendo capacità e servizi operativi per circa dieci ore di prove.

I file da preparare per il deploy sono elencati in [demo/DEPLOY.md](demo/DEPLOY.md) per la prova reale e [prod/DEPLOY.md](prod/DEPLOY.md) per la produzione teorica con GitHub Actions e Terraform.

La documentazione comprende sedici capitoli, indice e registro delle decisioni. Applicazione, infrastruttura e pipeline non sono implementate; prestazioni e recupero sono obiettivi da verificare e i costi sono stime.

Il branch `domora-nuova-versione` sostituisce la struttura documentale precedente. `main` conserva il materiale originario fino a un’eventuale adozione della nuova versione.
