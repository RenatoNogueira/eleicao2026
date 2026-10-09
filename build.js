// Gera public/index.html (arquivo unico, offline) a partir de src/ (EJS) + CSV + malha do IBGE. a partir de src/ (EJS) + CSV + malha do IBGE.
// Uso: npm run build   |   npm run watch
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const CSV = path.join(ROOT, 'resultados_governador_por_municipio.csv');
const MAP = path.join(ROOT, 'data', 'mapa_ma.json');
const PUBLIC_DIR = path.join(ROOT, 'public'); // pasta publicada no Vercel

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(';');
  return lines.map(l => {
    const c = l.split(';');
    return Object.fromEntries(head.map((h, i) => [h, c[i]]));
  });
}

// ID do Google Analytics (GA4). Sobrescreva com GA_ID=... ou use GA_ID= (vazio) para desativar.
const gaId = process.env.GA_ID !== undefined ? process.env.GA_ID : 'G-KPKFQ4TD06';

function build() {
  const rows = readCsv(CSV);
  const data = rows.map(r => ({
    c: r.codigo_municipio,
    n: r.municipio,
    a: parseInt(r.braide_votos, 10),
    b: parseInt(r.orleans_votos, 10),
    s: r.fonte,
  }));
  const bad = data.filter(d => !d.c || Number.isNaN(d.a) || Number.isNaN(d.b));
  if (bad.length) throw new Error(`Linhas invalidas no CSV: ${bad.length}`);

  const mapJson = fs.readFileSync(MAP, 'utf8').trim();
  const missing = data.filter(d => !JSON.parse(mapJson).p[d.c]).length;
  if (missing) console.warn(`Aviso: ${missing} municipios sem geometria no mapa`);

  const tpl = path.join(SRC, 'index.ejs');
  const flagUri = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(SRC, 'assets', 'bandeira-ma.svg')).toString('base64');
  const dep = k => fs.readFileSync(path.join(ROOT, 'data', `deputados_${k}.json`), 'utf8').trim();
  const html = ejs.render(fs.readFileSync(tpl, 'utf8'), { data, mapJson, gaId, flagUri, depFederal: dep('federal'), depEstadual: dep('estadual') }, { filename: tpl });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html, 'utf8');
  console.log(`public/index.html gerado: ${(html.length / 1024).toFixed(1)} KB, ${data.length} municipios`);
}

build();
if (process.argv.includes('--watch')) {
  let t;
  const again = () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 150); };
  fs.watch(SRC, { recursive: true }, again);
  fs.watch(CSV, again);
  console.log('Observando src/ e o CSV...');
}
