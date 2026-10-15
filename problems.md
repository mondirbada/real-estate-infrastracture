## Lambda + VPC

Facendo della ricerca, ho scoperto che le *lambda* per poter comunicare con l'*RDS Proxy*,
che è presente all'interno di una *VPC*, hanno bisogno di essere all'interno della stessa.

Per le lambda devo configurare l'accesso ad entrambe le *Subnet Private* dove vivono le
nostre *RDS Instances*, per poter permettere il trasferimento e collegamento.

Entrambe le *AZ* necessitano di una subnet pubblica e una privata?
Se la subnet pubblica viene inutilizzata, è comunque obbligatoria?

Non dobbiamo utilizzare api esterne come stripe.
Per le api pubblice di cognito è possibile utilizzare *AWS PrivateLink*.

È meglio inserire un NAT per permettere chiamate di api esterne alla nostra rete?
Le lambda devono davvero esistere all'interno della nostra VPC?

I ruoli e le policy, dobbiamo inserire quelli reali o li creiamo in maniera tale da essere
nominati in maniera esplicita?
