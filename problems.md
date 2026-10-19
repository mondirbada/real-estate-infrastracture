## Lambda + VPC

Facendo della ricerca, ho scoperto che le *lambda* per poter comunicare con l'*RDS Proxy*,
che è presente all'interno di una *VPC*, hanno bisogno di essere all'interno della stessa.

Per le lambda devo configurare l'accesso ad entrambe le *Subnet Private* dove vivono le
nostre *RDS Instances*, per poter permettere il trasferimento e collegamento.

**Decisione:** le lambda che usano il database (le 5 di business) vanno nella VPC, in entrambe
le subnet private. Le altre (la *Mailer*) restano fuori.

### Entrambe le AZ necessitano di una subnet pubblica e una privata? Se la subnet pubblica viene inutilizzata, è comunque obbligatoria?

**Decisione:** no. Una subnet è pubblica solo se ha una rotta verso un *Internet Gateway*, e serve
solo per NAT, load balancer o istanze con IP pubblico, che non abbiamo. Servono almeno 2 subnet
private in 2 AZ (lo richiedono il *DB subnet group* di Aurora e l'*RDS Proxy*).
Se un giorno servisse un NAT, allora si aggiunge una subnet pubblica per AZ.

### Non dobbiamo utilizzare api esterne come stripe. Per le api pubbliche di cognito è possibile utilizzare *AWS PrivateLink*.

**Decisione:** le lambda nella VPC non chiamano Cognito (l'*API Gateway* valida i token da sé),
quindi il PrivateLink per Cognito non serve. PrivateLink serve invece, come *interface endpoint*,
per i servizi AWS raggiunti dalla VPC: SNS per le lambda e, se necessario, Secrets Manager per l'*RDS Proxy*.

### È meglio inserire un NAT per permettere chiamate di api esterne alla nostra rete?

**Decisione:** no. Senza API esterne il NAT è un costo fisso inutile; usiamo gli endpoint VPC.
Una lambda nella VPC non ha Internet nemmeno se sta in una subnet pubblica.

### Le lambda devono davvero esistere all'interno della nostra VPC?

**Decisione:** solo quelle che parlano con l'*RDS Proxy*, perché il proxy non è raggiungibile da fuori
della VPC. Le altre, come la *Mailer*, stanno fuori: meno cold start, meno endpoint, meno costi.

### I ruoli e le policy, dobbiamo inserire quelli reali o li creiamo in maniera tale da essere nominati in maniera esplicita?

**Decisione:** nomi espliciti con una convenzione (`real-estate-<ambiente>-<componente>-<scopo>`);
gli identificativi reali (ID account, ID del proxy, ARN dei secret) restano segnaposto `<...>`
nei file in Git e si sostituiscono al provisioning.

## Aperto

- **Endpoint di Secrets Manager:** da verificare alla creazione del proxy se serve (vedi `architecture.md`).
- **Alternativa al Secrets Manager:** *RDS Proxy* supporta anche l'autenticazione IAM end-to-end
  (`DefaultAuthScheme=IAM_AUTH`), che elimina secret, endpoint e permessi KMS. Per ora scelto il
  modello con secret perché più comune; da riconsiderare se si vuole semplificare.
- **Nomi dei ruoli delle lambda:** i `_to_do` nel diagramma vanno sostituiti con i nomi dei ruoli.
