// Baixa do TSE os resultados de Presidente (cargo 1) do Brasil, do Maranhao e de cada municipio do MA
// e gera data/presidente.json.
// Uso: npm run dados:presidente   (opcional: ELE=6257 UF=ma node tools/tse-presidente.js)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELE = process.env.ELE || '6257'; // Eleicao Ordinaria Federal 2026 - 1o turno
const UF = process.env.UF || 'ma';
const BASE = `https://resultados.tse.jus.br/oficial/ele2026/${ELE}/dados`;
const CARGO = 'c0001';

const num = v => (v === undefined || v === '' || v === null ? 0 : parseInt(v, 10) || 0);
const flt = v => parseFloat(String(v ?? '0').replace(',', '.')) || 0;

// Os arquivos .jws sao JWS: header.payload.assinatura (base64url). O JSON esta no payload.
const decode = text => JSON.parse(Buffer.from(text.trim().split('.')[1], 'base64url').toString('utf8'));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return decode(await r.text());
    } catch (e) {
      if (i === tries) throw e;
      await new Promise(r => setTimeout(r, 400 * i));
    }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function cands(j) {
  const out = [];
  for (const agr of j.carg[0].agr || []) {
    for (const par of agr.par || []) {
      for (const c of par.cand || []) {
        const vice = (c.vs || []).find(v => v.tp === 'v');
        out.push({ id: c.sqcand, n: c.n, nu: c.nmu, nm: c.nm, sg: par.sg, com: agr.com || par.sg, v: num(c.vap), pc: flt(c.pvapn), e: c.e === 's' ? 1 : 0, st: c.st || '', vice: vice ? vice.nmu : '' });
      }
    }
  }
  return out;
}

function geral(j) {
  return {
    aptos: num(j.e && j.e.te), comp: num(j.e && j.e.c), abst: num(j.e && j.e.a),
    validos: num(j.v && j.v.vv), branco: num(j.v && j.v.vb), nulo: num(j.v && j.v.tvn),
    secoes: num(j.s && j.s.ts), apuradas: num(j.s && j.s.st),
  };
}

async function main() {
  const csv = fs.readFileSync(path.join(ROOT, 'resultados_governador_por_municipio.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const mun = csv.slice(1).map(l => l.split(';')[0]);
  console.log(`${mun.length} municipios; eleicao ${ELE}/${UF}`);

  const br = await get(`${BASE}/br/br-${CARGO}-e00${ELE}-u.jws`);
  const st = await get(`${BASE}/${UF}/${UF}-${CARGO}-e00${ELE}-u.jws`);
  const cst = cands(st).sort((a, b) => b.v - a.v);
  const cbr = Object.fromEntries(cands(br).map(c => [c.n, c]));
  const idx = new Map(cst.map((c, i) => [c.n, i]));

  const mv = cst.map(() => new Array(mun.length).fill(0));
  const mm = { vv: [], branco: [], nulo: [], aptos: [], comp: [] };
  let done = 0;
  await pool(mun, 10, async (code, mi) => {
    const m = await get(`${BASE}/${UF}/${UF}${code}-${CARGO}-e00${ELE}-u.jws`);
    cands(m).forEach(c => { const i = idx.get(c.n); if (i !== undefined) mv[i][mi] = c.v; });
    const g = geral(m);
    mm.vv[mi] = g.validos; mm.branco[mi] = g.branco; mm.nulo[mi] = g.nulo; mm.aptos[mi] = g.aptos; mm.comp[mi] = g.comp;
    if (++done % 50 === 0) console.log(`  ${done}/${mun.length}`);
  });

  const out = {
    cargo: 'presidente', nome: 'Presidente', eleicao: ELE, uf: UF.toUpperCase(),
    atualizado: `${st.dt} ${st.ht}`, turno: num(st.t),
    ma: geral(st), br: geral(br),
    cands: cst.map(c => ({ ...c, vbr: cbr[c.n] ? cbr[c.n].v : 0, pbr: cbr[c.n] ? cbr[c.n].pc : 0, ebr: cbr[c.n] ? cbr[c.n].e : 0 })),
    mun, ...mm, mv,
  };
  const file = path.join(ROOT, 'data', 'presidente.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const soma = mv.map(a => a.reduce((s, v) => s + v, 0));
  const bad = out.cands.filter((c, i) => soma[i] !== c.v);
  console.log(`presidente.json: ${out.cands.length} candidatos, ${(fs.statSync(file).size / 1024).toFixed(0)} KB; atualizado ${out.atualizado}`);
  console.log(bad.length ? `ATENCAO: ${bad.length} candidatos divergem da soma dos municipios` : 'OK: soma dos municipios bate com o total do estado');
}

main().catch(e => { console.error(e); process.exit(1); });
