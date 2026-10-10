// Coleta o horario em que o TSE recebeu/totalizou cada secao (campo dr/hr do arquivo aux de cada BU) e grava
// data/apuracao.json = { inicio, n, t: [minutos desde 00:00 de "inicio", na mesma ordem das linhas de
// resultados_governador_por_secao.csv] }. Com os votos de cada secao, isso permite desenhar a apuracao voto a voto.
// Uso: npm run dados:apuracao   (opcional: UF=ma PLEITO=3220)
// Rode depois de dados:secoes: a ordem das secoes e a do CSV de secoes.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UF = (process.env.UF || 'ma').toLowerCase();
const CICLO = process.env.CICLO || 'ele2026';
const HOST = 'https://resultados.tse.jus.br/oficial';
const CACHE = process.env.CACHE || path.join(os.tmpdir(), `tse-apuracao-${UF}.jsonl`);
const SEC = path.join(ROOT, 'resultados_governador_por_secao.csv');
const OUT = path.join(ROOT, 'data', 'apuracao.json');

async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
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

const key = c => `${c[0]}/${c[2]}/${c[3]}`;

async function main() {
  let pleito = process.env.PLEITO;
  if (!pleito) {
    const ele = await getJson(`${HOST}/comum/config/ele-c.json`);
    pleito = ele.pl.find(x => x.c === CICLO).cd;
  }
  const P = String(pleito).padStart(6, '0');
  const base = `${HOST}/${CICLO}/arquivo-urna/${pleito}/dados/${UF}`;
  const rows = fs.readFileSync(SEC, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1).map(l => l.split(';'));
  console.log(`${rows.length} secoes`);

  const cache = new Map();
  if (fs.existsSync(CACHE)) fs.readFileSync(CACHE, 'utf8').split(/\r?\n/).filter(Boolean).forEach(l => { const [k, v] = l.split('\t'); cache.set(k, v); });
  if (cache.size) console.log(`  cache: ${cache.size} secoes`);

  const stamp = new Array(rows.length);
  let done = 0;
  await pool(rows, 12, async (c, i) => {
    const k = key(c);
    if (cache.has(k)) stamp[i] = cache.get(k);
    else {
      const j = await getJson(`${base}/${c[0]}/${c[2]}/${c[3]}/p${P}-${UF}-m${c[0]}-z${c[2]}-s${c[3]}-aux.json`);
      const h = (j.hashes || [])[0];
      if (!h || !h.dr || !h.hr) throw new Error(`sem horario em ${k}`);
      stamp[i] = `${h.dr} ${h.hr}`;
      fs.appendFileSync(CACHE, `${k}\t${stamp[i]}\n`);
    }
    if (++done % 2000 === 0) console.log(`  ${done}/${rows.length}`);
  });

  // minutos desde 00:00 do dia da primeira recepcao
  const parse = s => { const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d)$/.exec(s); return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) / 60000; };
  const mins = stamp.map(parse);
  const t0 = Math.floor(Math.min(...mins) / 1440) * 1440;
  const first = new Date(t0 * 60000).toISOString().slice(0, 10);
  const out = { inicio: first, n: rows.length, t: mins.map(m => Math.round((m - t0) * 10) / 10) };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const s = [...out.t].sort((a, b) => a - b);
  const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')} (+${Math.floor(m / 1440)}d)`;
  console.log(`apuracao.json: ${out.n} secoes; 1a ${hhmm(s[0])}, mediana ${hhmm(s[Math.floor(s.length / 2)])}, ultima ${hhmm(s[s.length - 1])}`);
}

main().catch(e => { console.error(e); process.exit(1); });
