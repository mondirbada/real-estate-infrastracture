// Genera la relazione in docx componendo i capitoli di capitoli/.
// Uso: node genera.js [--solo 04-2-api,04-6-account] [--out file.docx]
//   --solo  genera soltanto i capitoli indicati (per controllare un capitolo da solo)
//   --out   percorso del docx (default: ../relazione.docx)
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber,
  TableOfContents, PageBreak, BorderStyle,
} = require("docx");
const S = require("./stile");

const RADICE = path.resolve(__dirname, "../..");
const DEF = path.join(RADICE, "definitivo");
const DIAGRAMMI = path.resolve(__dirname, "../diagrammi");
const leggiJson = f => fs.readFileSync(path.join(DEF, f), "utf8").replace(/\n$/, "");
const ctx = { S, leggiJson, DEF, DIAGRAMMI, RADICE };

// Ordine dei capitoli: ogni voce è un file capitoli/<nome>.js che esporta (ctx) => [elementi].
// Se il file non c'è ancora, al suo posto va il segnaposto.
const CAPITOLI = [
  ["01-introduzione", "1. Introduzione", "il progetto, i requisiti, come leggere la relazione."],
  ["02-architettura", "2. Architettura d'insieme", "diagramma completo, componenti in breve, scelte di fondo."],
  ["03-sicurezza", "3. Il modello di sicurezza", "le tre facce di IAM, la rete come secondo lucchetto, la mappa delle autorizzazioni."],
  ["04-0-flussi", "4. I flussi, uno per uno", "introduzione ai flussi."],
  ["04-1-spa", "4.1 Scaricare l'applicazione", "CloudFront, OAC, bucket del sito."],
  ["04-2-api", "4.2 Login e chiamate all'API", "Cognito, access token, authorizer JWT, invocazione delle Lambda."],
  ["04-3-database", "4.3 Dalla Lambda al database", "RDS Proxy, IAM auth, Secrets Manager, KMS, Aurora."],
  ["04-4-file", "4.4 Caricare e servire i file", "presigned POST, notifica S3, CloudFront, cancellazione."],
  ["04-5-notifiche", "4.5 Le notifiche email", ""],
  ["04-6-account", "4.6 Gestione e cancellazione dell'account", "Cognito dal frontend, ordine della cancellazione."],
  ["04-7-osservabilita", "4.7 Log, metriche e allarmi", "CloudWatch."],
  ["05-decisioni", "5. Decisioni e alternative scartate", "tabella delle decisioni."],
  ["06-limiti", "6. Limiti e sviluppi possibili", "rischi residui, costi, evoluzioni."],
  ["A-ruoli-policy", "Appendice A — Ruoli e policy", "elenco completo."],
  ["B-configurazioni", "Appendice B — Configurazioni", "configurazioni non IAM."],
];

const arg = (nome) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };
const solo = arg("--solo") ? arg("--solo").split(",") : null;
const out = path.resolve(arg("--out") || path.join(__dirname, "../relazione.docx"));

function capitolo([file, titolo, descrizione]) {
  const f = path.join(__dirname, "capitoli", file + ".js");
  if (fs.existsSync(f)) return require(f)(ctx);
  const testa = /^\d\.\s|^Appendice/.test(titolo) ? S.h1(titolo) : S.h2(titolo);
  return [testa, S.daScrivere(descrizione)];
}

// ---------- Copertina e indice ----------
const copertina = [
  new Paragraph({ children: [], spacing: { before: 2400 } }),
  new Paragraph({ children: [new TextRun({ text: "Real Estate Platform", size: 56, bold: true, color: S.BLU })] }),
  new Paragraph({ children: [new TextRun({ text: "Architettura serverless su AWS", size: 32, color: S.ACCENTO })], spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: S.ACCENTO, space: 8 } } }),
  new Paragraph({ children: [new TextRun({ text: "Relazione di progetto — Servizi Cloud", size: 26 })], spacing: { before: 240, after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: "ITS ICT Piemonte — Software Development", size: 22, color: S.GRIGIO })] }),
  new Paragraph({ children: [], spacing: { before: 2400 } }),
  new Paragraph({ children: [new TextRun({ text: "Gruppo", bold: true, size: 22 })] }),
  new Paragraph({ children: [new TextRun({ text: "Matteo Charrier, Tommaso Fatticcioni, [altri componenti]", size: 22 })], spacing: { after: 240 } }),
  new Paragraph({ children: [new TextRun({ text: "Regione AWS: eu-south-1 (Milano)", size: 20, color: S.GRIGIO })] }),
  new Paragraph({ children: [new TextRun({ text: "Ottobre 2026", size: 20, color: S.GRIGIO })] }),
  new Paragraph({ children: [new PageBreak()] }),
];
const indice = [
  new Paragraph({ children: [new TextRun({ text: "Indice", size: 32, bold: true, color: S.BLU })], spacing: { after: 200 } }),
  new TableOfContents("Indice", { hyperlink: true, headingStyleRange: "1-3" }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ---------- Documento ----------
const pagina = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567 } };
const intestazione = new Header({ children: [new Paragraph({
  children: [new TextRun({ text: "Real Estate Platform — Relazione di progetto", size: 16, color: S.GRIGIO })],
  alignment: AlignmentType.RIGHT,
})] });
const piede = new Footer({ children: [new Paragraph({
  children: [new TextRun({ children: ["Pagina ", PageNumber.CURRENT, " di ", PageNumber.TOTAL_PAGES], size: 16, color: S.GRIGIO })],
  alignment: AlignmentType.CENTER,
})] });

const corpo = CAPITOLI.filter(c => !solo || solo.includes(c[0])).flatMap(capitolo);

const doc = new Document({
  creator: "Gruppo Real Estate Platform",
  title: "Real Estate Platform — Relazione di progetto",
  features: { updateFields: !process.env.NO_UPDATE },
  styles: S.stili,
  numbering: S.numerazione,
  sections: [
    ...(solo ? [] : [{ properties: { page: pagina }, children: [...copertina, ...indice] }]),
    { properties: { page: pagina }, headers: { default: intestazione }, footers: { default: piede }, children: corpo },
  ],
});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log("scritto", out); });
