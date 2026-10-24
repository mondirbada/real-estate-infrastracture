// Mattoni grafici della relazione: testo con `codice` e **grassetto**, codice, tabelle, riquadri, figure.
const fs = require("fs");
const {
  Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  HeadingLevel, AlignmentType, ImageRun, LevelFormat,
} = require("docx");

const LARGHEZZA = 9638; // A4 con margini di 2 cm, in DXA
const BLU = "1F3864";
const ACCENTO = "2E75B6";
const GRIGIO = "6B7280";
const CODICE_SFONDO = "F3F4F6";

// "testo con `codice` e **grassetto**" -> TextRun
function runs(testo, base = {}) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let ultimo = 0, m;
  while ((m = re.exec(testo))) {
    if (m.index > ultimo) out.push(new TextRun({ text: testo.slice(ultimo, m.index), ...base }));
    const s = m[0];
    if (s.startsWith("`")) out.push(new TextRun({ text: s.slice(1, -1), font: "Consolas", size: 19, color: "0B5394", ...omit(base, ["font", "size"]) }));
    else if (s.startsWith("**")) out.push(...runs(s.slice(2, -2), { ...base, bold: true }));
    else out.push(...runs(s.slice(1, -1), { ...base, italics: true }));
    ultimo = m.index + s.length;
  }
  if (ultimo < testo.length) out.push(new TextRun({ text: testo.slice(ultimo), ...base }));
  return out;
}
function omit(o, chiavi) { const c = { ...o }; chiavi.forEach(k => delete c[k]); return c; }

const p = (testo, opz = {}) => new Paragraph({ children: runs(testo), spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, ...opz });
const h1 = (t, opz = {}) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], ...opz });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const h3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const punto = (testo, livello = 0) => new Paragraph({ children: runs(testo), numbering: { reference: "punti", level: livello }, spacing: { after: 60, line: 276 } });
const numero = (testo, rif = "numeri") => new Paragraph({ children: runs(testo), numbering: { reference: rif, level: 0 }, spacing: { after: 60, line: 276 } });

// Elenco numerato che riparte da 1: ogni chiamata è una lista nuova.
let istanza = 100;
const elencoNumerato = voci => { istanza += 1; const n = istanza; return voci.map(t => new Paragraph({
  children: runs(t), numbering: { reference: "numeri", level: 0, instance: n }, spacing: { after: 60, line: 276 } })); };

// Capitolo ancora da scrivere: una riga grigia che dice cosa conterrà.
const daScrivere = testo => new Paragraph({
  children: runs("Da scrivere — " + testo, { italics: true, color: GRIGIO }),
  spacing: { after: 160 },
});

// Blocco di codice: una riga per paragrafo, sfondo grigio e filo blu a sinistra.
function codice(testo, titolo) {
  const righe = testo.replace(/\n$/, "").split("\n");
  const bordo = { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENTO, space: 6 } };
  const out = [];
  if (titolo) out.push(new Paragraph({
    children: [new TextRun({ text: titolo, font: "Consolas", size: 16, color: GRIGIO })],
    spacing: { before: 120, after: 0 }, keepNext: true, indent: { left: 120 },
  }));
  righe.forEach((r, i) => out.push(new Paragraph({
    children: [new TextRun({ text: r === "" ? " " : r, font: "Consolas", size: 17 })],
    shading: { type: ShadingType.CLEAR, fill: CODICE_SFONDO, color: "auto" },
    border: bordo, indent: { left: 120, right: 120 },
    spacing: { before: i === 0 && !titolo ? 120 : 0, after: i === righe.length - 1 ? 160 : 0, line: 240 },
    keepNext: righe.length <= 25 && i < righe.length - 1, keepLines: true,
  })));
  return out;
}

// Riquadro evidenziato (per "All'orale", "In breve", avvertenze).
function riquadro(titolo, paragrafi) {
  const stile = {
    shading: { type: ShadingType.CLEAR, fill: "EAF2FB", color: "auto" },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: ACCENTO, space: 8 } },
    indent: { left: 160, right: 160 },
  };
  return [
    new Paragraph({ children: [new TextRun({ text: titolo, bold: true, color: BLU })], spacing: { before: 160, after: 0 }, keepNext: true, ...stile }),
    ...paragrafi.map((t, i) => new Paragraph({ children: runs(t), spacing: { after: i === paragrafi.length - 1 ? 200 : 60, line: 264 }, keepNext: i < paragrafi.length - 1, ...stile })),
  ];
}

// Tabella: prima riga intestazione blu, righe alterne. larghezze in DXA che sommano a LARGHEZZA.
function tabella(intestazione, righe, larghezze) {
  const tot = larghezze.reduce((a, b) => a + b, 0);
  const scala = LARGHEZZA / tot;
  const w = larghezze.map(x => Math.round(x * scala));
  w[w.length - 1] += LARGHEZZA - w.reduce((a, b) => a + b, 0);
  const bordo = { style: BorderStyle.SINGLE, size: 4, color: "C9D3E0" };
  const bordi = { top: bordo, bottom: bordo, left: bordo, right: bordo };
  const cella = (testo, i, intest, pari) => new TableCell({
    width: { size: w[i], type: WidthType.DXA }, borders: bordi,
    shading: intest ? { type: ShadingType.CLEAR, fill: BLU, color: "auto" } : (pari ? { type: ShadingType.CLEAR, fill: "F2F5FA", color: "auto" } : undefined),
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: runs(testo, intest ? { bold: true, color: "FFFFFF", size: 19 } : { size: 19 }), spacing: { after: 0, line: 252 } })],
  });
  return new Table({
    width: { size: LARGHEZZA, type: WidthType.DXA }, columnWidths: w,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: intestazione.map((t, i) => cella(t, i, true)) }),
      ...righe.map((r, j) => new TableRow({ cantSplit: true, children: r.map((t, i) => cella(t, i, false, j % 2 === 1)) })),
    ],
  });
}
const dopoTabella = () => new Paragraph({ children: [], spacing: { after: 120 } });

// Figura a tutta larghezza con didascalia. pxW/pxH: dimensioni del PNG.
function figura(file, pxW, pxH, didascalia) {
  const largPt = LARGHEZZA / 20; // punti
  const largPx = Math.round(largPt * 96 / 72);
  return [
    new Paragraph({
      children: [new ImageRun({ type: "png", data: fs.readFileSync(file), transformation: { width: largPx, height: Math.round(largPx * pxH / pxW) } })],
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
    }),
    new Paragraph({ children: runs(didascalia, { italics: true, color: GRIGIO, size: 18 }), alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
  ];
}

const numerazione = {
  config: [
    { reference: "punti", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } },
      { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 800, hanging: 260 } } } },
    ] },
    ...["numeri", "numeri2", "numeri3", "numeri4"].map(ref => ({ reference: ref, levels: [
      { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 300 } } } },
    ] })),
  ],
};

const stili = {
  default: { document: { run: { font: "Calibri", size: 22 } } },
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 32, bold: true, color: BLU, font: "Calibri" },
      paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0, keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENTO, space: 4 } } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 26, bold: true, color: BLU, font: "Calibri" },
      paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1, keepNext: true } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { size: 23, bold: true, color: ACCENTO, font: "Calibri" },
      paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2, keepNext: true } },
  ],
};

module.exports = { p, h1, h2, h3, punto, numero, elencoNumerato, daScrivere, codice, riquadro, tabella, dopoTabella, figura, runs,
  numerazione, stili, LARGHEZZA, BLU, ACCENTO, GRIGIO };
