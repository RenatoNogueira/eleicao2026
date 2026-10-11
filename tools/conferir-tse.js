// Compara os totais do estado publicados no painel com os arquivos atuais do TSE.
// Uso: npm run conferir:tse   (sai com codigo 1 se algo estiver desatualizado)
// Serve para saber quando rodar npm run dados:tudo (ex.: apos totalizacao final ou 2o turno).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const B = 'https://resultados.tse.jus.br/oficial/ele2026';
const dec = t => JSON.parse(Buffer.from(t.trim().split('.')[1], 'base64url').toString('utf8'));
const num = v => parseInt(v || '0', 10) || 0;
const get = async u => { const r = await fetch(u + '?nocache=' + Date.now()); if (!r.ok) throw new Error(`${r.status} ${u}`); return dec(await r.text()); };
const cands = j => j.carg[0].agr.flatMap(a => a.par.flatMap(p => p.cand));

(async () => {
  const dif = [];
  const ler = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  // legislativo (estadual 6259): total de votos validos computados e votos por candidato
  for (const [k, c] of [['federal', 6], ['estadual', 7], ['senador', 5]]) {
    const L = ler(`data/legislativo_${k}.json`), j = await get(`${B}/6259/dados/ma/ma-c000${c}-e006259-u.jws`);
    const live = Object.fromEntries(cands(j).map(x => [x.n, num(x.vap)]));
    const ruins = L.cands.filter(x => live[x.n] !== x.v).length;
    if (num(j.v.vvc) !== L.geral.vvc || ruins) dif.push(`${k}: TSE ${j.dt} ${j.ht} (painel ${L.atualizado}) - vvc ${num(j.v.vvc)} x ${L.geral.vvc}, ${ruins} candidatos diferentes`);
  }
  // governador
  const g = await get(`${B}/6259/dados/ma/ma-c0003-e006259-u.jws`);
  const csv = fs.readFileSync(path.join(ROOT, 'resultados_governador_por_municipio.csv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const h = csv[0].split(';'), iv = h.indexOf('validos_tse');
  const vvc = csv.slice(1).reduce((s, l) => s + (+l.split(';')[iv] || 0), 0);
  if (vvc !== num(g.v.vvc)) dif.push(`governador: vvc painel ${vvc} x TSE ${num(g.v.vvc)} (${g.dt} ${g.ht})`);
  // presidente (1o e 2o turno)
  const P = ler('data/presidente.json');
  for (const [t, e] of [['t1', '6257'], ['t2', '6258']]) {
    if (!P[t]) continue;
    const j = await get(`${B}/${e}/dados/ma/ma-c0001-e00${e}-u.jws`);
    if (num(j.v.vv) !== P[t].ma.validos) dif.push(`presidente ${t}: validos painel ${P[t].ma.validos} x TSE ${num(j.v.vv)}${P[t].apurado ? '' : ' (2o turno passou a ter votos: rode npm run dados:presidente)'}`);
  }
  if (dif.length) { console.error('Dados do painel DESATUALIZADOS em relacao ao TSE:\n  - ' + dif.join('\n  - ') + '\nRode: npm run dados:tudo'); process.exit(1); }
  console.log('Dados do painel batem com o TSE (legislativo, governador e presidente).');
})().catch(e => { console.error('Falha ao consultar o TSE:', e.message); process.exit(2); });
