// Regrava resultados_governador_por_municipio.csv com o resultado COMPLETO de Governador (todos os candidatos),
// com os percentuais calculados como o TSE divulga: votos do candidato / votos validos computados (vvc =
// validos + anulados sub judice). Mantem as colunas antigas (Braide x Orleans "entre os dois") e acrescenta as novas.
// Uso: npm run dados:governador   (opcional: ELE=6259 UF=ma BRAIDE=55 ORLEANS=15 CAMARAO=13)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV = path.join(ROOT, 'resultados_governador_por_municipio.csv');
const ELE = process.env.ELE || '6259'; // Eleicao Ordinaria Estadual 2026 - 1o turno
const UF = process.env.UF || 'ma';
const N_BRAIDE = process.env.BRAIDE || '55';
const N_ORLEANS = process.env.ORLEANS || '15';
const N_CAMARAO = process.env.CAMARAO || '13';
const BASE = `https://resultados.tse.jus.br/oficial/ele2026/${ELE}/dados/${UF}`;

const num = v => (v === undefined || v === '' || v === null ? 0 : parseInt(v, 10) || 0);
const dec = text => JSON.parse(Buffer.from(text.trim().split('.')[1], 'base64url').toString('utf8'));
const br2 = n => n.toFixed(2).replace('.', ',');

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return dec(await r.text());
    } catch (e) {
      if (i === tries) throw e;
      await new Promise(r => setTimeout(r, 400 * i));
    }
  }
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// Votos por candidato, mais os totais do TSE (vvc, anulados sub judice, brancos, nulos)
function parse(j) {
  const c = {};
  let sj = 0;
  for (const agr of j.carg[0].agr || []) for (const par of agr.par || []) for (const k of par.cand || []) {
    const v = num(k.vap);
    c[k.n] = v;
    if (/sub judice/i.test(k.dvt || '') || /anulado/i.test(k.dvt || '')) sj += v;
  }
  return { c, sj, vvc: num(j.v.vvc), vv: num(j.v.vv), vb: num(j.v.vb), nulo: num(j.v.tvn), ap: num(j.e.te), cp: num(j.e.c), ab: num(j.e.a) };
}

// Resultado por zona eleitoral (TSE publica arquivo por zona): inclui eleitorado, comparecimento e abstencao oficiais
async function zonas(rows, nA, nB, nK) {
  const cfg = await (await fetch(`https://resultados.tse.jus.br/oficial/ele2026/${ELE}/config/mun-e00${ELE}-cm.json`)).json();
  const mu = cfg.abr.find(a => a.cd === UF).mu;
  const nome = Object.fromEntries(rows.map(r => [r.codigo_municipio, r.municipio]));
  const jobs = [];
  mu.forEach(m => m.z.forEach(z => jobs.push({ mun: m.cd, zona: z })));
  const out = new Array(jobs.length);
  await pool(jobs, 10, async (j, i) => {
    const x = await get(`${BASE}/${UF}${j.mun}-z${j.zona}-c0003-e00${ELE}-u.jws`);
    const p = parse(x);
    const a = p.c[nA] || 0, b = p.c[nB] || 0, k = p.c[nK] || 0;
    out[i] = [j.mun, nome[j.mun] || '', j.zona, a, b, k, p.vvc, p.vb, p.nulo, p.ap, p.cp, p.ab].join(';');
  });
  const head = 'codigo_municipio;municipio;zona;braide_votos;orleans_votos;camarao_votos;validos_tse;brancos;nulos;eleitores_aptos;comparecimento;abstencao';
  fs.writeFileSync(path.join(ROOT, 'resultados_governador_por_zona.csv'), '\uFEFF' + [head, ...out].join('\n') + '\n', 'utf8');
  const tot = out.map(l => l.split(';')).reduce((s, c) => ({ a: s.a + +c[3], ab: s.ab + +c[11], ap: s.ap + +c[9] }), { a: 0, ab: 0, ap: 0 });
  console.log(`zonas: ${out.length}; Braide ${tot.a}, aptos ${tot.ap}, abstencao ${tot.ab}`);
}

async function main() {
  const old = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const h = old[0].split(';');
  const rows = old.slice(1).map(l => { const c = l.split(';'); return Object.fromEntries(h.map((k, i) => [k, c[i]])); });
  const st = parse(await get(`${BASE}/${UF}-c0003-e00${ELE}-u.jws`));
  console.log(`${rows.length} municipios; estado: vvc ${st.vvc}, validos ${st.vv}, sub judice ${st.sj}`);

  const res = new Array(rows.length);
  await pool(rows, 10, async (r, i) => { res[i] = parse(await get(`${BASE}/${UF}${r.codigo_municipio}-c0003-e00${ELE}-u.jws`)); });

  const head = ['codigo_municipio', 'municipio', 'braide_votos', 'braide_%_entre_os_dois', 'orleans_votos', 'orleans_%_entre_os_dois',
    'diferenca_braide_menos_orleans', 'lider', 'fonte',
    'camarao_votos', 'outros_votos', 'anulados_sub_judice', 'brancos', 'nulos', 'validos_tse',
    'braide_%_validos', 'orleans_%_validos', 'camarao_%_validos', 'eleitores_aptos', 'comparecimento', 'abstencao'];
  const out = rows.map((r, i) => {
    const x = res[i], a = x.c[N_BRAIDE] || 0, b = x.c[N_ORLEANS] || 0, k = x.c[N_CAMARAO] || 0;
    if (a !== +r.braide_votos || b !== +r.orleans_votos) throw new Error(`votos divergem do CSV anterior em ${r.municipio}`);
    const todos = Object.values(x.c).reduce((s, v) => s + v, 0);
    const outros = todos - a - b - k - x.sj; // candidatos sem votos relevantes (nao inclui anulados sub judice)
    const base = x.vvc;
    return [r.codigo_municipio, r.municipio, a, r['braide_%_entre_os_dois'], b, r['orleans_%_entre_os_dois'], r.diferenca_braide_menos_orleans, r.lider, r.fonte,
      k, outros, x.sj, x.vb, x.nulo, base, br2(a / base * 100), br2(b / base * 100), br2(k / base * 100), x.ap, x.cp, x.ab].join(';');
  });
  fs.writeFileSync(CSV, '﻿' + [head.join(';'), ...out].join('\n') + '\n', 'utf8');

  const sum = k => res.reduce((s, x, i) => s + (k(x, rows[i])), 0);
  const tot = { a: sum(x => x.c[N_BRAIDE] || 0), b: sum(x => x.c[N_ORLEANS] || 0), vvc: sum(x => x.vvc) };
  console.log(`soma dos municipios: Braide ${tot.a} (${br2(tot.a / tot.vvc * 100)}%), Orleans ${tot.b} (${br2(tot.b / tot.vvc * 100)}%), vvc ${tot.vvc} (estado ${st.vvc})`);
  const ab = sum(x => x.ab);
  console.log(`abstencao: soma dos municipios ${ab}, estado ${st.ab} (comparecimento ${sum(x => x.cp)}, aptos ${sum(x => x.ap)})`);
  await zonas(rows, N_BRAIDE, N_ORLEANS, N_CAMARAO);
  console.log(tot.vvc === st.vvc && tot.a === st.c[N_BRAIDE] && tot.b === st.c[N_ORLEANS] ? 'OK: soma dos municipios bate com o total do estado' : 'ATENCAO: soma dos municipios diverge do estado');
}

main().catch(e => { console.error(e); process.exit(1); });
