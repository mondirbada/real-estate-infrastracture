// Conta le parole di ogni capitolo e il totale (appendici escluse).
// Uso: node conta.js            -> tutti i capitoli presenti
//      node conta.js 03-2-api   -> solo quelli indicati
// Riferimento: ~450 parole = una pagina di solo testo.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const dir = path.join(__dirname, "capitoli");
const scelti = process.argv[2] ? process.argv[2].split(",") : fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => f.slice(0, -3)).sort();
const tmp = path.join(require("os").tmpdir(), "conta-relazione.docx");
let tot = 0;
for (const c of scelti) {
  execFileSync("node", [path.join(__dirname, "genera.js"), "--solo", c, "--out", tmp], { stdio: "ignore" });
  const xml = execFileSync("unzip", ["-p", tmp, "word/document.xml"]).toString();
  const testo = xml.replace(/<w:p[ >]/g, "\n$&").replace(/<[^>]+>/g, " ");
  const n = testo.split(/\s+/).filter(Boolean).length;
  if (!c.startsWith("A-") && !c.startsWith("B-")) tot += n;
  console.log(c.padEnd(22), String(n).padStart(6), "parole", "≈", (n / 450).toFixed(1), "pagine");
}
console.log("TOTALE (senza appendici)".padEnd(22), String(tot).padStart(6), "parole", "≈", (tot / 450).toFixed(1), "pagine");
fs.rmSync(tmp, { force: true });
