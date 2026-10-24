// 1. Introduzione
module.exports = ({ S }) => {
  const { p, h1, h2, punto, tabella, dopoTabella } = S;
  return [
  h1("1. Introduzione"),

  h2("1.1 Il progetto e i requisiti"),
  p("Real Estate Platform è una piattaforma immobiliare **serverless** che gira su AWS, nella regione `eu-south-1` (Milano). I visitatori consultano gli annunci senza bisogno di un account; gli agenti pubblicano immobili con foto e video; gli acquirenti fanno offerte, e chi riceve un'offerta o ne conosce l'esito viene avvisato con un'email. È il progetto di gruppo per l'esame di Servizi Cloud dell'ITS."),
  p("Gli utenti registrati hanno uno di tre ruoli, che in Cognito sono altrettanti **gruppi**. Il ruolo arriva all'applicazione dentro il token e decide cosa si può fare."),
  tabella(
    ["Ruolo", "Cosa fa", "Cosa può fare in più rispetto al visitatore"],
    [
      ["Visitatore", "consulta gli annunci e i loro file", "— (non serve un account: la lettura è pubblica)"],
      ["`buyer`", "acquirente", "fare offerte sugli immobili, ritirarle, ricevere l'esito per email"],
      ["`agent`", "agente immobiliare", "pubblicare immobili, caricare foto e video, accettare o rifiutare le offerte sui propri immobili, ricevere le email delle nuove offerte"],
      ["`admin`", "amministratore", "modificare e cancellare gli immobili di chiunque"],
    ],
    [1500, 2600, 5500],
  ),
  dopoTabella(),
  p("Oltre alle funzioni, il progetto ha dei **requisiti non funzionali** che hanno guidato quasi tutte le scelte. Li elenchiamo qui perché nei capitoli successivi tornano spesso come motivazione."),
  punto("**Costo proporzionale all'uso.** Il traffico è basso e variabile: niente server sempre accesi, si paga per richiesta e il sistema scala da zero."),
  punto("**Sicurezza per costruzione.** Ogni componente ha solo i permessi che gli servono (*least privilege*), il database non è raggiungibile da Internet, nessuna password sta nel codice, il traffico è cifrato."),
  punto("**Dati in Italia e bassa latenza** per gli utenti italiani, da cui la regione di Milano."),
  punto("**Resistenza al guasto di un data center**: database e rete su due zone di disponibilità, e nessuna email persa in silenzio se l'invio fallisce."),
  punto("**Dati personali ridotti al minimo**: l'indirizzo email di un utente sta in un solo posto, Cognito."),
  punto("**Operabilità**: log, metriche e allarmi che avvisano il team, e procedure scritte per i casi in cui qualcosa non va."),
  p("La documentazione descrive la configurazione **prevista**. I file JSON del repository sono *template*, con account, ID e ARN reali sostituiti da segnaposto come `<ACCOUNT_ID>`, e nessuna risorsa è stata ancora creata su un account AWS."),

  h2("1.2 Come leggere questa relazione"),
  p("Il lettore che ci interessa conosce Java e Spring Boot ma non AWS, e vuole capire soprattutto **come le parti si collegano**: chi chiama chi, su quale rete, con quali permessi. Per questo la relazione non è un catalogo di servizi, e non spiega a fondo che cosa fa ciascuno: dice che cosa fa, in modo breve, e dedica lo spazio all'integrazione, all'architettura e ai rapporti IAM."),
  punto("**Capitolo 2 — Architettura d'insieme.** Il diagramma completo, letto per zone, e una tabella di tutti i componenti con il loro ruolo. È il posto dove ogni servizio viene descritto in breve."),
  punto("**Capitolo 3 — Il modello di sicurezza.** La base su cui poggia tutto il resto: le tre facce di IAM (trust policy, identity policy, resource policy), la rete come secondo lucchetto e la mappa delle autorizzazioni. Conviene leggerlo prima dei flussi."),
  punto("**Capitolo 4 — I flussi, uno per uno.** Il cuore della relazione. Sono sette: scaricare l'applicazione, login e chiamate all'API, dalla Lambda al database, caricare e servire i file, le notifiche email, gestione e cancellazione dell'account, log e allarmi. Ognuno segue lo stesso schema: una spiegazione, un **diagramma parziale** con il solo flusso in evidenza, il percorso in sintesi, la tabella *chi parla con chi*, le **autorizzazioni con le policy vere** lette dal repository, cosa succede quando qualcosa va storto e una tabella delle scelte con le alternative scartate."),
  punto("**Capitolo 5 — Decisioni e alternative scartate** e **capitolo 6 — Limiti e sviluppi possibili**: le scelte principali raggruppate per area, ciò che resta da verificare, i rischi che dichiariamo, i costi e le evoluzioni."),
  punto("**Appendici.** La A raccoglie tutti i ruoli e le policy IAM; la B il testo integrale delle configurazioni che non sono IAM."),
  p("La documentazione completa, un file per servizio, con tutte le tabelle e le domande da orale, è nel repository nella cartella `definitivo/`. Questa relazione ne riorganizza il contenuto come spiegazione continua; quando serve un dettaglio in più, il file del servizio è il posto dove cercarlo."),
  p("Una nota sulle convenzioni. Le risorse hanno nomi espliciti del tipo `real-estate-prod-<componente>`; le Lambda hanno nel testo un nome breve (la Offers Lambda è `real-estate-prod-offers`). Le analogie con Spring Boot servono a ricordare, non a dire che i due mondi coincidono. Le policy mostrate nei riquadri di codice sono copiate dai file del repository, mai riscritte a mano."),
  ];
};
