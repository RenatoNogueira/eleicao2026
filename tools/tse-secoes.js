// Baixa do TSE os boletins de urna (BU) do Maranhao e gera, por zona/secao, os votos de Governador:
//   resultados_governador_por_secao.csv
// Uso: npm run dados:secoes   (opcional: UF=ma PLEITO=3220 BRAIDE=55 ORLEANS=15 node tools/tse-secoes.js)
// Fluxo: ele-c.json (pleito) -> config/<uf>/<uf>-p<pleito>-cs.json (lista de zonas/secoes)
//        -> .../<mun>/<zona>/<secao>/p<pleito>-<uf>-m<mun>-z<zona>-s<secao>-aux.json (hash do BU)
//        -> .../<hash>/o<pleito>...-bu.dat (ASN.1 BER; envelope -> BU -> votos por cargo)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UF = (process.env.UF || 'ma').toLowerCase();
const CICLO = process.env.CICLO || 'ele2026';
const CARGOS = { 3: 'governador', 5: 'senador', 6: 'federal', 7: 'estadual' }; // codigo do cargo no BU -> chave
const CARGO = 3; // Governador (CSV)
const N_BRAIDE = process.env.BRAIDE || '55';
const N_ORLEANS = process.env.ORLEANS || '15';
const OUT = path.join(ROOT, 'resultados_governador_por_secao.csv');
const CSV_MUN = path.join(ROOT, 'resultados_governador_por_municipio.csv');
const CACHE = process.env.CACHE || path.join(require('os').tmpdir(), `tse-secoes-v2-${UF}.jsonl`); // retomada de execucoes interrompidas
const HOST = 'https://resultados.tse.jus.br/oficial';

async function fetchRetry(url, kind, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return kind === 'json' ? JSON.parse(await r.text()) : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries) throw e;
      await new Promise(r => setTimeout(r, 500 * i));
    }
  }
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// --- BER minimo: devolve arvore {cls, tag, cons, s, l, ch} ---
function ber(b, s, e) {
  const out = [];
  while (s < e) {
    const t = b[s++]; const cls = t >> 6, cons = (t >> 5) & 1; let tag = t & 31;
    if (tag === 31) { tag = 0; let x; do { x = b[s++]; tag = (tag << 7) | (x & 127); } while (x & 128); }
    let l = b[s++];
    if (l & 128) { const n = l & 127; l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[s++]; }
    const node = { cls, tag, cons, s, l };
    if (cons) node.ch = ber(b, s, s + l);
    out.push(node); s += l;
  }
  return out;
}
const int = (b, n) => { let v = 0; for (let i = 0; i < n.l; i++) v = v * 256 + b[n.s + i]; return v; };
const isCtx = (n, tag) => n.cls === 2 && n.tag === tag;

// Extrai, para cada cargo de CARGOS, { cand: {numero: votos}, branco, nulo } do arquivo -bu.dat
function parseBu(file) {
  const env = ber(file, 0, file.length);
  const oct = env[0].ch.find(n => n.cls === 0 && n.tag === 4);
  if (!oct) throw new Error('envelope sem BU');
  const bu = file.subarray(oct.s, oct.s + oct.l);
  const root = ber(bu, 0, bu.length);
  const res = {};
  (function walk(nodes) {
    for (const x of nodes) {
      if (!x.cons) continue;
      const cg = x.ch.find(c => !c.cons && isCtx(c, 1));
      const list = x.ch.find(c => c.cons && c.ch.length && c.ch.every(k => k.cons && k.ch.some(g => isCtx(g, 2))));
      if (cg && list && CARGOS[int(bu, cg)]) {
        const r = res[int(bu, cg)] = { cand: {}, branco: 0, nulo: 0 };
        for (const k of list.ch) {
          const tp = int(bu, k.ch.find(g => isCtx(g, 1)));
          const q = int(bu, k.ch.find(g => isCtx(g, 2)));
          const idn = k.ch.find(g => isCtx(g, 3));
          if (tp === 1 && idn) { const num = String(int(bu, idn.ch[idn.ch.length - 1])); r.cand[num] = (r.cand[num] || 0) + q; }
          else if (tp === 2) r.branco += q;
          else if (tp === 3) r.nulo += q;
        }
        continue;
      }
      walk(x.ch);
    }
  })(root);
  for (const c of Object.keys(CARGOS)) if (!res[c]) throw new Error('cargo ' + c + ' nao encontrado no BU');
  return res;
}

async function main() {
  let pleito = process.env.PLEITO;
  if (!pleito) {
    const ele = await fetchRetry(`${HOST}/comum/config/ele-c.json`, 'json');
    const p = ele.pl.find(x => x.c === CICLO);
    if (!p) throw new Error(`ciclo ${CICLO} nao encontrado`);
    pleito = p.cd;
  }
  const P = String(pleito).padStart(6, '0');
  const base = `${HOST}/${CICLO}/arquivo-urna/${pleito}`;
  const cs = await fetchRetry(`${base}/config/${UF}/${UF}-p${P}-cs.json`, 'json');
  const abr = cs.abr.find(a => a.cd === UF);
  const jobs = [];
  for (const m of abr.mu) for (const z of m.zon) for (const s of z.sec) jobs.push({ mun: m.cd, nome: m.nm, zona: z.cd, secao: s.ns });
  console.log(`pleito ${pleito}/${UF}: ${abr.mu.length} municipios, ${jobs.length} secoes (atualizado ${cs.dg} ${cs.hg})`);

  const key = j => `${j.mun}/${j.zona}/${j.secao}`;
  const cache = new Map();
  if (fs.existsSync(CACHE)) fs.readFileSync(CACHE, 'utf8').split(/\r?\n/).filter(Boolean).forEach(l => { const o = JSON.parse(l); cache.set(key(o), o); });
  if (cache.size) console.log(`  cache: ${cache.size} secoes reaproveitadas (${CACHE})`);
  const rows = new Array(jobs.length);
  const fails = [], missing = [];
  let done = 0;
  await pool(jobs, 12, async (j, i) => {
    try {
      if (cache.has(key(j))) { rows[i] = cache.get(key(j)); return; }
      const dir = `${base}/dados/${UF}/${j.mun}/${j.zona}/${j.secao}`;
      const aux = await fetchRetry(`${dir}/p${P}-${UF}-m${j.mun}-z${j.zona}-s${j.secao}-aux.json`, 'json');
      let arq = null, hash = null;
      for (const h of aux.hashes || []) { const a = (h.arq || []).find(x => x.tp === 'bu'); if (a) { arq = a.nm; hash = h.hash; break; } }
      if (!arq) throw new Error('sem BU');
      const r = parseBu(await fetchRetry(`${dir}/${hash}/${arq}`, 'bin'));
      const g = r[CARGO];
      const braide = g.cand[N_BRAIDE] || 0, orleans = g.cand[N_ORLEANS] || 0;
      const nom = Object.values(g.cand).reduce((a, b) => a + b, 0);
      rows[i] = { ...j, braide, orleans, outros: nom - braide - orleans, branco: g.branco, nulo: g.nulo, cg: r };
      fs.appendFileSync(CACHE, JSON.stringify(rows[i]) + '\n');
    } catch (e) { (/^404 /.test(e.message) ? missing : fails).push(`${key(j)}: ${e.message}`); }
    if (++done % 1000 === 0) console.log(`  ${done}/${jobs.length}`);
  });
  if (fails.length) {
    console.error(`${fails.length} secoes com falha (CSV nao gravado):`);
    fails.slice(0, 20).forEach(f => console.error('  ' + f));
    process.exit(1);
  }

  if (missing.length) console.warn(`Aviso: ${missing.length} secoes sem BU publicado (404) foram ignoradas`);
  const done_rows = rows.filter(Boolean);
  const head = 'codigo_municipio;municipio;zona;secao;braide_votos;orleans_votos;outros_votos;brancos;nulos;total_votos';
  const lines = done_rows.map(r => [r.mun, r.nome, r.zona, r.secao, r.braide, r.orleans, r.outros, r.branco, r.nulo, r.braide + r.orleans + r.outros + r.branco + r.nulo].join(';'));
  fs.writeFileSync(OUT, '﻿' + [head, ...lines].join('\n') + '\n', 'utf8');
  console.log(`${path.basename(OUT)}: ${done_rows.length} secoes`);

  // Senador / Deputado Federal / Deputado Estadual: votos nominais por candidato e secao, em formato esparso.
  // data/secoes_<cargo>.json = { cargo, n, c: { numero: [idxSecao, votos, ...] }, br: [...], nu: [...] }
  // idxSecao = posicao da linha em resultados_governador_por_secao.csv (0 = primeira secao).
  for (const [cod, key] of Object.entries(CARGOS)) {
    if (cod === String(CARGO)) continue;
    const c = {}, br = [], nu = [];
    done_rows.forEach((r, idx) => {
      const x = r.cg[cod];
      br.push(x.branco); nu.push(x.nulo);
      for (const [num, v] of Object.entries(x.cand)) if (v) (c[num] || (c[num] = [])).push(idx, v);
    });
    const file = path.join(ROOT, 'data', `secoes_${key}.json`);
    fs.writeFileSync(file, JSON.stringify({ cargo: key, n: done_rows.length, c, br, nu }));
    // Conferencia com data/legislativo_<cargo>.json (votos nominais por candidato)
    const leg = path.join(ROOT, 'data', `legislativo_${key}.json`);
    let msg = '';
    if (fs.existsSync(leg)) {
      const L = JSON.parse(fs.readFileSync(leg, 'utf8'));
      const bad = L.cands.filter(k => (c[String(k.n)] || []).reduce((s, v, i) => s + (i % 2 ? v : 0), 0) !== k.v);
      msg = bad.length ? ` ATENCAO: ${bad.length} candidatos divergem do legislativo (ex.: ${bad.slice(0, 3).map(k => k.nm).join(', ')})` : ` OK: votos de ${L.cands.length} candidatos batem com o legislativo`;
    }
    console.log(`secoes_${key}.json: ${Object.keys(c).length} candidatos, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB;${msg}`);
  }

  // Conferencia com o CSV por municipio (soma das secoes x total do municipio)
  if (fs.existsSync(CSV_MUN)) {
    const sum = {};
    done_rows.forEach(r => { const s = sum[r.mun] || (sum[r.mun] = { a: 0, b: 0 }); s.a += r.braide; s.b += r.orleans; });
    const mun = fs.readFileSync(CSV_MUN, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1).map(l => l.split(';'));
    const diff = mun.filter(c => !sum[c[0]] || sum[c[0]].a !== +c[2] || sum[c[0]].b !== +c[4]);
    console.log(diff.length ? `ATENCAO: ${diff.length} municipios divergem do CSV por municipio: ${diff.slice(0, 10).map(c => c[1]).join(', ')}` : `OK: soma das secoes bate com os ${mun.length} municipios do CSV`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
  if (fs.existsSync(CACHE)) fs.readFileSync(CACHE, "utf8").split(/\r?\n/).filter(Boolean).forEach(l => { const o = JSON.parse(l); cache.set(key(o), o); });