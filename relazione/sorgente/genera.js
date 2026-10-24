// Genera la relazione in docx componendo i capitoli di capitoli/.
// Uso: node genera.js [--solo 04-2-api,04-6-account] [--out file.docx]
//   --solo  genera soltanto i capitoli indicati (per controllare un capitolo da solo)
//   --out   percorso del docx (default: ../relazione.docx)
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber,
  TableOfContents, PageBreak, BorderStyle, ExternalHyperlink,
} = require("docx");
const S = require("./stile");

const RADICE = path.resolve(__dirname, "../..");
const DEF = path.join(RADICE, "definitivo");
const DIAGRAMMI = path.resolve(__dirname, "../diagrammi");
const leggiJson = f => fs.readFileSync(path.join(DEF, f), "utf8").replace(/\n$/, "");
const REPO = "https://github.com/mondirbada/real-estate-infrastracture/tree/main/definitivo";
const ctx = { S, leggiJson, DEF, DIAGRAMMI, RADICE, REPO };

// Ordine dei capitoli: ogni voce è un file capitoli/<nome>.js che esporta (ctx) => [elementi].
// Se il file non c'è ancora, al suo posto va il segnaposto.
const CAPITOLI = [
  ["01-problema", "1. Il problema", "cosa deve fare la piattaforma e con quali vincoli."],
  ["02-soluzione", "2. La soluzione in sintesi", "diagramma completo, requisito → soluzione, scelte di fondo."],
  ["03-0-flussi", "3. Come comunicano i componenti", "introduzione ai flussi."],
  ["03-1-spa", "3.1 Scaricare l'applicazione", ""],
  ["03-2-api", "3.2 Login e chiamate all'API", ""],
  ["03-3-database", "3.3 Dalla Lambda al database", ""],
  ["03-4-file", "3.4 Caricare e servire i file", ""],
  ["03-5-notifiche", "3.5 Le notifiche email e la dead-letter queue", ""],
  ["03-6-account", "3.6 Gestione e cancellazione dell'account", ""],
  ["03-7-osservabilita", "3.7 Log, metriche e allarmi", ""],
  ["04-sicurezza", "4. Sicurezza e IAM", ""],
  ["05-decisioni-limiti", "5. Decisioni, alternative e limiti", ""],
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
  new Paragraph({ children: [new TextRun({ text: "Charrier, Fatticcioni, Badaoui, Pappalardo, Xu, Jimenez", size: 22 })], spacing: { after: 240 } }),
  new Paragraph({ children: [new TextRun({ text: "Regione AWS: eu-south-1 (Milano)", size: 20, color: S.GRIGIO })] }),
  new Paragraph({ children: [new TextRun({ text: "Ottobre 2026", size: 20, color: S.GRIGIO })], spacing: { after: 240 } }),
  new Paragraph({ children: [new TextRun({ text: "Documentazione completa, configurazioni e diagrammi:", size: 20, color: S.GRIGIO })] }),
  new Paragraph({ children: [new ExternalHyperlink({ link: REPO, children: [new TextRun({ text: REPO, size: 20, style: "Hyperlink" })] })] }),
  new Paragraph({ children: [new PageBreak()] }),
];
const indice = [
  new Paragraph({ children: [new TextRun({ text: "Indice", size: 32, bold: true, color: S.BLU })], spacing: { after: 200 } }),
  new TableOfContents("Indice", { hyperlink: true, headingStyleRange: "1-2" }),
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
