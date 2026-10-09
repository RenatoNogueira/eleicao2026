// Baixa do TSE os resultados de Deputado Federal (cargo 6) e Estadual (cargo 7) do Maranhao,
// por municipio, e gera data/deputados_federal.json e data/deputados_estadual.json.
// Uso: npm run dados:deputados      (opcional: ELE=6259 UF=ma node tools/tse-deputados.js)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELE = process.env.ELE || '6259'; // Eleicao Ordinaria Estadual 2026 - 1o turno
const UF = process.env.UF || 'ma';
const BASE = `https://resultados.tse.jus.br/oficial/ele2026/${ELE}/dados/${UF}`;
const CARGOS = [
  { id: '6', key: 'federal', nome: 'Deputado Federal' },
  { id: '7', key: 'estadual', nome: 'Deputado Estadual' },
];

const num = v => (v === undefined || v === '' || v === null ? 0 : parseInt(v, 10) || 0);
const flt = v => parseFloat(String(v ?? '0').replace(',', '.')) || 0;

// Os arquivos .jws sao JWS: header.payload.assinatura (base64url). O JSON esta no payload.
function decode(text) {
  const part = text.trim().split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

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

function flatten(carg) {
  const parties = [], cands = [];
  const fedByNum = Object.fromEntries((carg.fed || []).map(f => [f.n, f]));
  for (const agr of carg.agr || []) {
    for (const par of agr.par || []) {
      const fed = par.nfed && fedByNum[par.nfed] ? fedByNum[par.nfed].sg : '';
      const pi = parties.length;
      parties.push({ n: par.n, sg: par.sg, nm: par.nm, fed, com: agr.com || '', nom: num(par.tvtn), leg: num(par.tvtl), tot: num(par.tvtn) + num(par.tvtl) });
      for (const c of par.cand || []) cands.push({ ...c, pi });
    }
  }
  return { parties, cands };
}

async function main() {
  const csv = fs.readFileSync(path.join(ROOT, 'resultados_governador_por_municipio.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const mun = csv.slice(1).map(l => l.split(';')[0]);
  console.log(`${mun.length} municipios; eleicao ${ELE}/${UF}`);

  for (const cg of CARGOS) {
    const url = c => `${BASE}/${UF}${c}-c000${cg.id}-e00${ELE}-u.jws`;
    const st = await get(`${BASE}/${UF}-c000${cg.id}-e00${ELE}-u.jws`);
    const carg = st.carg[0];
    const { parties, cands } = flatten(carg);
    cands.sort((a, b) => num(b.vap) - num(a.vap));
    const idx = new Map(cands.map((c, i) => [c.sqcand, i]));

    const mv = cands.map(() => new Array(mun.length).fill(0));
    const pm = parties.map(() => new Array(mun.length).fill(0));
    const vv = new Array(mun.length).fill(0);
    let done = 0;
    await pool(mun, 10, async (code, mi) => {
      const m = await get(url(code));
      const f = flatten(m.carg[0]);
      f.cands.forEach(c => { const i = idx.get(c.sqcand); if (i !== undefined) mv[i][mi] = num(c.vap); });
      f.parties.forEach((p, k) => { const pi = parties.findIndex(x => x.n === p.n && x.sg === p.sg); if (pi >= 0) pm[pi][mi] = p.tot; });
      vv[mi] = num(m.v && m.v.vv);
      if (++done % 50 === 0) console.log(`  ${cg.key}: ${done}/${mun.length}`);
    });

    const elected = c => c.e === 's';
    const out = {
      cargo: cg.key, nome: cg.nome, eleicao: ELE, uf: UF.toUpperCase(),
      atualizado: `${st.dt} ${st.ht}`, vagas: num(carg.nv), qe: num(carg.qe),
      secoes: { total: num(st.s.ts), apuradas: num(st.s.st) },
      geral: {
        aptos: num(st.e.te), comp: num(st.e.c), abst: num(st.e.a),
        nom: num(st.v.vnom), leg: num(st.v.vl), validos: num(st.v.vv), branco: num(st.v.vb), nulo: num(st.v.tvn),
      },
      mun, vv,
      parties: parties.map((p, i) => ({ ...p, eleitos: cands.filter(c => c.pi === i && elected(c)).length, cands: cands.filter(c => c.pi === i).length })),
      cands: cands.map(c => ({ id: c.sqcand, n: c.n, nu: c.nmu, nm: c.nm, p: c.pi, v: num(c.vap), pc: flt(c.pvapn), st: c.st || '', e: elected(c) ? 1 : 0, dv: c.dvt })),
      mv, pm,
    };
    const file = path.join(ROOT, 'data', `deputados_${cg.key}.json`);
    fs.writeFileSync(file, JSON.stringify(out));
    const sumNom = cands.reduce((s, c) => s + num(c.vap), 0);
    console.log(`${cg.nome}: ${cands.length} candidatos, ${out.parties.length} partidos, ${out.cands.filter(c => c.e).length} eleitos (vagas ${out.vagas}); votos nominais ${sumNom} (TSE ${out.geral.nom}); ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
