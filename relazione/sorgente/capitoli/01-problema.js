// 1. Il problema
module.exports = ({ S, REPO }) => {
  const { p, h1, h2, h3, punto, tabella, dopoTabella, riquadro } = S;
  return [
  h1("1. Il problema"),
  p("Real Estate Platform è il progetto di gruppo per l'esame di Servizi Cloud dell'ITS: una piattaforma immobiliare su AWS. Prima dei servizi, diciamo che cosa deve fare, per chi e con quali vincoli; il capitolo 2 riprende i requisiti uno per uno."),
  ...riquadro("Il materiale nel repository", [
    `Le configurazioni (CORS, coda e DLQ, allarmi, Cognito, condizioni del presigned POST…), la documentazione di ogni servizio e i sorgenti dei diagrammi sono nel repository del progetto: ${REPO}.`,
    "Nel testo compaiono per intero solo le policy IAM, ognuna nel paragrafo in cui viene usata.",
  ]),

  h2("1.1 Che cosa deve fare la piattaforma"),
  p("Gli agenti immobiliari pubblicano immobili in vendita. Ogni annuncio ha una descrizione, un prezzo e soprattutto **foto e video**. Chiunque deve poter sfogliare gli annunci senza registrarsi."),
  p("Chi è interessato a un immobile si registra e fa un'**offerta**. L'agente che ha pubblicato l'annuncio la vede, la accetta o la rifiuta; chi ha fatto l'offerta può ritirarla finché è in sospeso. A ogni passaggio la persona interessata riceve un'**email**: l'agente quando arriva una nuova offerta, l'acquirente quando conosce l'esito. Ogni utente gestisce il proprio profilo e può cancellare l'account: le offerte in sospeso che lo riguardano vanno chiuse, e l'altra parte deve saperlo."),
  p("Gli utenti registrati hanno uno di tre ruoli, e il ruolo decide che cosa possono fare."),
  tabella(
    ["Ruolo", "Chi è", "Che cosa può fare"],
    [
      ["visitatore", "chiunque, senza account", "consultare gli annunci, le foto e i video"],
      ["`buyer`", "acquirente", "fare offerte e ritirarle, ricevere l'esito per email"],
      ["`agent`", "agente immobiliare", "pubblicare, modificare e cancellare i propri immobili, caricarne foto e video, accettare o rifiutare le offerte ricevute, essere avvisato delle nuove offerte"],
      ["`admin`", "amministratore", "modificare e cancellare gli immobili di chiunque"],
    ],
    [1500, 2200, 5900],
  ),
  dopoTabella(),

  h2("1.2 Perché è un problema da cloud"),
  p("Fin qui è un'applicazione web come tante. Sono i vincoli a rendere il problema interessante: da loro nascono quasi tutte le scelte."),
  h3("Un carico variabile e imprevedibile"),
  p("Per giorni può non entrare quasi nessuno; poi un annuncio condiviso bene porta molte visite insieme. Dimensionare un server per il picco vuol dire pagarlo vuoto quasi sempre; dimensionarlo per la media vuol dire cadere proprio quando conta. Serve un sistema che **cresca e si riduca da solo**, fino a zero."),
  h3("File grandi"),
  p("Una foto arriva a qualche megabyte, un video a centinaia. Farli passare dal backend vuol dire occupare a lungo il calcolo e scontrarsi con i limiti di dimensione delle richieste. I file vanno caricati e serviti **senza passare dal codice dell'applicazione**, e chi carica non deve poter scrivere dove vuole o caricare qualunque cosa."),
  h3("Dati personali da proteggere"),
  p("La piattaforma conosce indirizzi email e offerte economiche: dati personali, soggetti al GDPR. Meno copie esistono di un dato, meno posti ci sono da proteggere e da ripulire quando l'utente chiede di essere cancellato. Il database non deve essere raggiungibile da Internet e ogni componente deve poter fare **solo ciò che gli serve**. Per lo stesso motivo i dati devono restare in Italia."),
  h3("Costi bassi, senza utenti fissi"),
  p("Senza utenti fissi, ogni costo che corre anche a sistema vuoto pesa: il modello giusto è **pagare in proporzione all'uso** e tenere al minimo ciò che resta acceso."),
  h3("Nessun server da gestire"),
  p("Non vogliamo installare sistemi operativi, applicare patch o sostituire macchine guaste: il lavoro deve stare sull'applicazione e sui collegamenti tra le parti. Tutto ciò che si può, lo gestisce AWS."),
  h3("Disponibile anche se cade una zona"),
  p("La piattaforma deve continuare a funzionare, senza perdere dati, se una zona di disponibilità non risponde. E un'email il cui invio fallisce non deve sparire in silenzio: va ritentata o messa da parte perché qualcuno la veda."),

  h2("1.3 I requisiti"),
  p("I primi sette requisiti sono funzionali, gli altri non funzionali."),
  punto("**R1 — Annunci pubblici.** Chiunque consulta gli annunci, con foto e video, senza account."),
  punto("**R2 — Registrazione, login e ruoli.** Gli utenti si registrano e accedono; ognuno ha un ruolo tra `buyer`, `agent` e `admin`, che decide che cosa può fare."),
  punto("**R3 — Gestione degli immobili.** Un `agent` pubblica, modifica e cancella i propri immobili; un `admin` modifica e cancella quelli di chiunque."),
  punto("**R4 — Foto e video.** Un `agent` carica i file dei propri annunci, con limiti di tipo e dimensione; i file sono serviti a tutti in modo veloce."),
  punto("**R5 — Offerte.** Un `buyer` fa e ritira offerte; l'`agent` proprietario dell'immobile le accetta o le rifiuta."),
  punto("**R6 — Notifiche.** Chi è coinvolto in un'offerta riceve un'email a ogni passaggio, e un nuovo utente riceve il benvenuto."),
  punto("**R7 — Account.** Ogni utente gestisce il proprio profilo e può cancellare l'account; le offerte in sospeso che lo riguardano si chiudono e l'altra parte viene avvisata."),
  punto("**R8 — Scalabilità e costo proporzionale.** Il sistema regge picchi improvvisi, scala fino a zero e costa in proporzione all'uso."),
  punto("**R9 — Nessun server da gestire.** Calcolo, database e rete sono servizi gestiti."),
  punto("**R10 — Protezione dei dati.** Database non raggiungibile da Internet, nessuna password nel codice, permessi minimi per ogni componente, cifratura in transito e a riposo, email degli utenti in un solo posto."),
  punto("**R11 — Disponibilità.** Il sistema sopravvive alla caduta di una zona di disponibilità, e nessuna notifica si perde in silenzio."),
  punto("**R12 — Dati in Italia.** Dati e servizi in una regione italiana, con latenza bassa per gli utenti."),
  punto("**R13 — Operabilità.** Log, metriche e allarmi avvisano il gruppo quando qualcosa non va."),
  ];
};
