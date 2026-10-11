// Gera public/index.html (arquivo unico, offline) a partir de src/ (EJS) + CSV + malha do IBGE. a partir de src/ (EJS) + CSV + malha do IBGE.
// Uso: npm run build   |   npm run watch
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const CSV = path.join(ROOT, 'resultados_governador_por_municipio.csv');
const CSV_SEC = path.join(ROOT, 'resultados_governador_por_secao.csv');
const CSV_LOC = path.join(ROOT, 'locais_votacao_por_secao.csv');
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
    k: parseInt(r.camarao_votos, 10) || 0,        // Felipe Camarao
    o: parseInt(r.outros_votos, 10) || 0,         // demais candidatos
    sj: parseInt(r.anulados_sub_judice, 10) || 0, // anulados sub judice (contam na base do TSE)
    br: parseInt(r.brancos, 10) || 0,
    nu: parseInt(r.nulos, 10) || 0,
    ap: parseInt(r.eleitores_aptos, 10) || 0,     // eleitorado apto
    cp: parseInt(r.comparecimento, 10) || 0,
    ab: parseInt(r.abstencao, 10) || 0,
    v: parseInt(r.validos_tse, 10) || 0,          // base dos percentuais do TSE (validos + sub judice)
  }));
  const bad = data.filter(d => !d.c || Number.isNaN(d.a) || Number.isNaN(d.b));
  if (bad.length) throw new Error(`Linhas invalidas no CSV: ${bad.length}`);

  const mapJson = fs.readFileSync(MAP, 'utf8').trim();
  const missing = data.filter(d => !JSON.parse(mapJson).p[d.c]).length;
  if (missing) console.warn(`Aviso: ${missing} municipios sem geometria no mapa`);

  // Secoes (zona/secao): colunas codigo_municipio;municipio;zona;secao;braide;orleans;outros;brancos;nulos;total
  const mun = [], munIdx = new Map();
  const secRows = (fs.existsSync(CSV_SEC) ? readCsv(CSV_SEC) : []).map(r => {
    if (!munIdx.has(r.codigo_municipio)) { munIdx.set(r.codigo_municipio, mun.length); mun.push(r.codigo_municipio); }
    return [munIdx.get(r.codigo_municipio), r.zona, r.secao, +r.braide_votos, +r.orleans_votos, +r.outros_votos, +r.brancos, +r.nulos, +(r.camarao_votos || 0)];
  });
  if (secRows.some(r => r.slice(3).some(Number.isNaN))) throw new Error('Linhas invalidas no CSV de secoes');
  if (!secRows.length) console.warn('Aviso: resultados_governador_por_secao.csv nao encontrado; aba Zonas e secoes ficara vazia');
  // hash do conteudo de cada data/secoes_<cargo>.json: vira ?v=<hash> na URL e evita cache velho apos atualizar os dados
  const ver = {};
  ['senador', 'federal', 'estadual'].forEach(k => {
    const p = path.join(ROOT, 'data', `secoes_${k}.json`);
    if (fs.existsSync(p)) ver[k] = require('crypto').createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10);
  });
  // Locais de votacao: alinhados por posicao ao CSV de secoes; locais repetidos (varias secoes na mesma escola) vao uma vez so
  let locaisJson = null;
  if (fs.existsSync(CSV_LOC)) {
    const L = readCsv(CSV_LOC);
    const sec = readCsv(CSV_SEC);
    if (L.length !== sec.length || L.some((l, i) => l.codigo_municipio !== sec[i].codigo_municipio || l.zona !== sec[i].zona || l.secao !== sec[i].secao))
      throw new Error('locais_votacao_por_secao.csv fora de sincronia com resultados_governador_por_secao.csv (rode npm run dados:locais)');
    const idx = new Map(), locs = [];
    const s2 = L.map(l => {
      const k = [l.codigo_municipio, l.local_votacao, l.endereco].join('|');
      if (!idx.has(k)) { idx.set(k, locs.length); locs.push([l.local_votacao, l.endereco, l.bairro, l.cep, l.latitude.replace(',', '.'), l.longitude.replace(',', '.'), l.tipo_local]); }
      return [idx.get(k), +l.eleitores_secao, l.acessibilidade === 'Sim' ? 1 : 0, l.secoes_agregadas, +l.eleitores_agregados];
    });
    locaisJson = JSON.stringify({ locs, s: s2 });
    ver.locais = require('crypto').createHash('sha1').update(locaisJson).digest('hex').slice(0, 10);
  } else console.warn('Aviso: locais_votacao_por_secao.csv nao encontrado (rode npm run dados:locais); detalhes de local ficarao ausentes');
  // horario em que cada secao chegou ao TSE (mesma ordem do CSV de secoes): apuracao voto a voto
  const APU = path.join(ROOT, 'data', 'apuracao.json');
  let apuracaoJson = 'null';
  if (fs.existsSync(APU)) {
    const a = JSON.parse(fs.readFileSync(APU, 'utf8'));
    if (a.n !== secRows.length) throw new Error('data/apuracao.json fora de sincronia com o CSV de secoes (rode npm run dados:apuracao)');
    apuracaoJson = JSON.stringify(a);
  } else console.warn('Aviso: data/apuracao.json nao encontrado (rode npm run dados:apuracao); o grafico de apuracao ficara oculto');
  // URL publica do site (a previa ao compartilhar exige endereco absoluto): SITE_URL ou as variaveis do Vercel
  const host = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
  const siteUrl = host ? (/^https?:\/\//.test(host) ? host : 'https://' + host).replace(/\/$/, '') : '';
  const ogSrc = path.join(SRC, 'assets', 'og-image.png');
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  if (fs.existsSync(ogSrc)) fs.copyFileSync(ogSrc, path.join(PUBLIC_DIR, 'og-image.png'));
  const presidenteJson = fs.readFileSync(path.join(ROOT, 'data', 'presidente.json'), 'utf8').trim();
  // abstencao oficial por zona (TSE): { "codMun|zona": [eleitores aptos, abstencao] }
  const zab = {};
  const ZON = path.join(ROOT, 'resultados_governador_por_zona.csv');
  if (fs.existsSync(ZON)) readCsv(ZON).forEach(z => { zab[z.codigo_municipio + '|' + z.zona] = [parseInt(z.eleitores_aptos, 10) || 0, parseInt(z.abstencao, 10) || 0]; });
  const secoesJson = JSON.stringify({ mun, rows: secRows, ver, zab });

  const tpl = path.join(SRC, 'index.ejs');
  const flagSvg = fs.readFileSync(path.join(SRC, 'assets', 'bandeira-ma.svg'));
  const flagUri = 'data:image/svg+xml;base64,' + flagSvg.toString('base64');
  // Icone (favicon): bandeira centralizada em um quadrado arredondado escuro
  const flagInner = flagSvg.toString('utf8').replace(/<\?xml[^>]*>\s*/, '').replace(/<!DOCTYPE[^>]*>\s*/, '')
    .replace(/<svg[^>]*>/, '<svg x="10" y="23" width="76" height="50.67" viewBox="0 0 1350 900">');
  const iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 96 96">'
    + '<rect width="96" height="96" rx="22" fill="#0b1020"/>'
    + '<clipPath id="fc"><rect x="10" y="23" width="76" height="50.67" rx="6"/></clipPath>'
    + `<g clip-path="url(#fc)">${flagInner}</g></svg>`;
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), iconSvg, 'utf8');
  const iconUri = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg).toString('base64');
  const dep = k => fs.readFileSync(path.join(ROOT, 'data', `legislativo_${k}.json`), 'utf8').trim();
  let html = ejs.render(fs.readFileSync(tpl, 'utf8'), { buildId: '__BUILD_ID__', data, mapJson, secoesJson, presidenteJson, apuracaoJson, siteUrl, gaId, flagUri, iconUri, depFederal: dep('federal'), depEstadual: dep('estadual'), depSenador: dep('senador') }, { filename: tpl });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  // id da versao: hash do conteudo da pagina (igual conteudo = mesmo id); o painel compara com public/version.json
  const buildId = require('crypto').createHash('sha1').update(html).digest('hex').slice(0, 12);
  html = html.split('__BUILD_ID__').join(buildId);
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'version.json'), JSON.stringify({ id: buildId, geradoEm: new Date().toISOString() }), 'utf8');
  if (locaisJson) { fs.mkdirSync(path.join(PUBLIC_DIR, 'data'), { recursive: true }); fs.writeFileSync(path.join(PUBLIC_DIR, 'data', 'locais.json'), locaisJson); }
  // Votos por secao de Senador/Deputados (carregados sob demanda pela aba Zonas e secoes)
  const dd = path.join(PUBLIC_DIR, 'data');
  fs.mkdirSync(dd, { recursive: true });
  const sec = ['senador', 'federal', 'estadual'].filter(k => fs.existsSync(path.join(ROOT, 'data', `secoes_${k}.json`)));
  sec.forEach(k => fs.copyFileSync(path.join(ROOT, 'data', `secoes_${k}.json`), path.join(dd, `secoes_${k}.json`)));
  if (sec.length < 3) console.warn('Aviso: faltam data/secoes_{senador,federal,estadual}.json (rode npm run dados:secoes)');
  console.log(`public/index.html gerado: ${(html.length / 1024).toFixed(1)} KB, ${data.length} municipios, ${secRows.length} secoes`);
}

build();
if (process.argv.includes('--watch')) {
  let t;
  const again = () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 150); };
  fs.watch(SRC, { recursive: true }, again);
  fs.watch(CSV, again);
  console.log('Observando src/ e o CSV...');
}
