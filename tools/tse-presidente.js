// Baixa do TSE os resultados de Presidente (cargo 1) do Brasil, do Maranhao e de cada municipio do MA,
// nos dois turnos, e gera data/presidente.json = { uf, mun, t1: {...}, t2: {...} }.
// Uso: npm run dados:presidente   (opcional: ELE=6257 ELE2=6258 UF=ma node tools/tse-presidente.js)
// O codigo do 2o turno vem de comum/config/ele-c.json (campo cdt2 da eleicao do 1o turno).
// Enquanto o 2o turno nao tem votos apurados, t2.apurado = false (os arquivos existem, mas zerados).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELE1 = process.env.ELE || '6257'; // Eleicao Ordinaria Federal 2026 - 1o turno
const UF = process.env.UF || 'ma';
const CARGO = 'c0001';
const HOST = 'https://resultados.tse.jus.br/oficial';

const num = v => (v === undefined || v === '' || v === null ? 0 : parseInt(v, 10) || 0);
const flt = v => parseFloat(String(v ?? '0').replace(',', '.')) || 0;

// Os arquivos .jws sao JWS: header.payload.assinatura (base64url). O JSON esta no payload.
const decode = text => {
  const t = text.trim();
  return t.startsWith('{') ? JSON.parse(t) : JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
};

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
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
  for (const agr of (j && j.carg && j.carg[0].agr) || []) {
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
  if (!j) return { aptos: 0, comp: 0, abst: 0, validos: 0, branco: 0, nulo: 0, secoes: 0, apuradas: 0 };
  return {
    aptos: num(j.e && j.e.te), comp: num(j.e && j.e.c), abst: num(j.e && j.e.a),
    validos: num(j.v && j.v.vv), branco: num(j.v && j.v.vb), nulo: num(j.v && j.v.tvn),
    secoes: num(j.s && j.s.ts), apuradas: num(j.s && j.s.st),
  };
}

async function turno(ele, mun) {
  const base = `${HOST}/ele2026/${ele}/dados`;
  const br = await get(`${base}/br/br-${CARGO}-e00${ele}-u.jws`);
  const st = await get(`${base}/${UF}/${UF}-${CARGO}-e00${ele}-u.jws`);
  if (!st) return null;
  const cst = cands(st).sort((a, b) => b.v - a.v);
  const cbr = Object.fromEntries(cands(br).map(c => [c.n, c]));
  const idx = new Map(cst.map((c, i) => [c.n, i]));
  const mv = cst.map(() => new Array(mun.length).fill(0));
  const mm = { vv: [], branco: [], nulo: [], aptos: [], comp: [] };
  await pool(mun, 10, async (code, mi) => {
    const m = await get(`${base}/${UF}/${UF}${code}-${CARGO}-e00${ele}-u.jws`);
    cands(m).forEach(c => { const i = idx.get(c.n); if (i !== undefined) mv[i][mi] = c.v; });
    const g = geral(m);
    mm.vv[mi] = g.validos; mm.branco[mi] = g.branco; mm.nulo[mi] = g.nulo; mm.aptos[mi] = g.aptos; mm.comp[mi] = g.comp;
  });
  const ma = geral(st);
  return {
    turno: num(st.t), eleicao: ele, atualizado: `${st.dt} ${st.ht}`.trim(), apurado: ma.validos > 0,
    ma, br: geral(br),
    cands: cst.map(c => ({ ...c, vbr: cbr[c.n] ? cbr[c.n].v : 0, pbr: cbr[c.n] ? cbr[c.n].pc : 0, ebr: cbr[c.n] ? cbr[c.n].e : 0 })),
    ...mm, mv,
  };
}

async function main() {
  const csv = fs.readFileSync(path.join(ROOT, 'resultados_governador_por_municipio.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const mun = csv.slice(1).map(l => l.split(';')[0]);

  let ele2 = process.env.ELE2;
  if (!ele2) {
    const cfg = await get(`${HOST}/comum/config/ele-c.json`);
    for (const p of (cfg && cfg.pl) || []) for (const e of p.e || []) if (e.cd === ELE1 && e.cdt2) ele2 = e.cdt2;
  }
  console.log(`${mun.length} municipios; ${UF}; 1o turno ${ELE1}; 2o turno ${ele2 || '(nao encontrado)'}`);

  const t1 = await turno(ELE1, mun);
  if (!t1) throw new Error('1o turno indisponivel');
  const t2 = ele2 ? await turno(ele2, mun) : null;

  const out = { cargo: 'presidente', nome: 'Presidente', uf: UF.toUpperCase(), mun, t1, t2 };
  const file = path.join(ROOT, 'data', 'presidente.json');
  fs.writeFileSync(file, JSON.stringify(out));

  for (const [k, t] of [['1o', t1], ['2o', t2]]) {
    if (!t) { console.log(`${k} turno: sem arquivos no TSE`); continue; }
    const soma = t.mv.map(a => a.reduce((s, v) => s + v, 0));
    const bad = t.cands.filter((c, i) => soma[i] !== c.v);
    console.log(`${k} turno: ${t.cands.length} candidatos, ${t.apurado ? `apurado (${t.ma.apuradas}/${t.ma.secoes} secoes, atualizado ${t.atualizado})` : 'ainda sem votos apurados'}; ` +
      (bad.length ? `ATENCAO: ${bad.length} candidatos divergem da soma dos municipios` : 'soma dos municipios confere'));
  }
  console.log(`presidente.json: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

main().catch(e => { console.error(e); process.exit(1); });
