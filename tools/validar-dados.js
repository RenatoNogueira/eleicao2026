// Valida a consistencia de TODOS os dados do painel antes de publicar.
// Uso: npm run validar        (tambem roda no inicio de npm run build; erro = build falha e o deploy anterior continua no ar)
// Erros bloqueiam; avisos so informam (ex.: limitacoes conhecidas dos dados do TSE).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...a) => path.join(ROOT, ...a);

function lerCsv(arq) {
  const L = fs.readFileSync(arq, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const h = L[0].split(';');
  return L.slice(1).map((l, i) => {
    const c = l.split(';');
    if (c.length !== h.length) throw new Error(`${path.basename(arq)} linha ${i + 2}: ${c.length} colunas (esperado ${h.length})`);
    return Object.fromEntries(h.map((k, j) => [k, c[j]]));
  });
}
const json = arq => JSON.parse(fs.readFileSync(arq, 'utf8'));
const soma = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

function validar({ silencioso = false } = {}) {
  const erros = [], avisos = [], ok = [];
  const erro = m => erros.push(m), aviso = m => avisos.push(m), bom = m => ok.push(m);
  const exige = (cond, msg, bomMsg) => { if (cond) { if (bomMsg) bom(bomMsg) } else erro(msg) };

  // ---- arquivos obrigatorios ----
  const arqs = ['resultados_governador_por_municipio.csv', 'resultados_governador_por_zona.csv', 'resultados_governador_por_secao.csv',
    'locais_votacao_por_secao.csv', 'data/mapa_ma.json', 'data/apuracao.json', 'data/presidente.json',
    'data/legislativo_federal.json', 'data/legislativo_estadual.json', 'data/legislativo_senador.json',
    'data/secoes_federal.json', 'data/secoes_estadual.json', 'data/secoes_senador.json'];
  const falta = arqs.filter(a => !fs.existsSync(P(a)));
  if (falta.length) { erro('arquivos ausentes: ' + falta.join(', ')); return { erros, avisos, ok }; }

  let M, Z, S, LOC;
  try { M = lerCsv(P(arqs[0])); Z = lerCsv(P(arqs[1])); S = lerCsv(P(arqs[2])); LOC = lerCsv(P(arqs[3])); }
  catch (e) { erro(e.message); return { erros, avisos, ok }; }
  const mapa = json(P('data/mapa_ma.json'));

  // ---- municipios ----
  exige(M.length === 217, `esperados 217 municipios, ha ${M.length}`, '217 municipios');
  const cods = new Set(M.map(m => m.codigo_municipio));
  exige(cods.size === M.length, 'codigos de municipio duplicados');
  const semGeo = M.filter(m => !mapa.p[m.codigo_municipio]).map(m => m.municipio);
  exige(!semGeo.length, 'municipios sem geometria no mapa: ' + semGeo.join(', '), 'todos os municipios tem geometria');
  for (const m of M) {
    const a = +m.braide_votos, b = +m.orleans_votos, k = +m.camarao_votos, o = +m.outros_votos, sj = +m.anulados_sub_judice, v = +m.validos_tse;
    if (![a, b, k, o, sj, v].every(Number.isFinite)) { erro(`${m.municipio}: valor nao numerico`); continue; }
    if (a + b + k + o + sj !== v) erro(`${m.municipio}: braide+orleans+camarao+outros+sub judice (${a + b + k + o + sj}) != validos_tse (${v})`);
    if (+m.comparecimento + +m.abstencao !== +m.eleitores_aptos) erro(`${m.municipio}: comparecimento+abstencao != eleitores_aptos`);
    if (+m.comparecimento < v + +m.brancos + +m.nulos - 0) erro(`${m.municipio}: comparecimento menor que votos apurados`);
    const lider = a > b ? 'Braide' : 'Orleans';
    if (!new RegExp(lider, 'i').test(m.lider)) erro(`${m.municipio}: lider "${m.lider}" incoerente com os votos`);
    const pct = parseFloat(m['braide_%_validos'].replace(',', '.'));
    if (Math.abs(a / v * 100 - pct) > 0.006) erro(`${m.municipio}: braide_%_validos (${pct}) != calculado`);
  }

  // ---- zonas x municipios ----
  exige(Z.length === 223, `esperadas 223 zonas, ha ${Z.length}`, '223 zonas');
  const zPorMun = {};
  Z.forEach(z => { (zPorMun[z.codigo_municipio] = zPorMun[z.codigo_municipio] || []).push(z); });
  for (const m of M) {
    const zs = zPorMun[m.codigo_municipio] || [];
    if (!zs.length) { erro(`${m.municipio}: sem zonas`); continue; }
    for (const [cz, cm] of [['braide_votos', 'braide_votos'], ['orleans_votos', 'orleans_votos'], ['camarao_votos', 'camarao_votos'], ['validos_tse', 'validos_tse'],
      ['eleitores_aptos', 'eleitores_aptos'], ['comparecimento', 'comparecimento'], ['abstencao', 'abstencao']]) {
      if (soma(zs, z => +z[cz]) !== +m[cm]) { erro(`${m.municipio}: soma das zonas de ${cz} != municipio`); break; }
    }
  }
  bom('zonas somam os municipios');

  // ---- secoes x municipios ----
  exige(S.length === 18093, `esperadas 18093 secoes, ha ${S.length}`, '18093 secoes');
  const chave = r => `${r.codigo_municipio}/${r.zona}/${r.secao}`;
  exige(new Set(S.map(chave)).size === S.length, 'secoes duplicadas no CSV de secoes');
  const sPorMun = {};
  S.forEach(s => {
    const x = sPorMun[s.codigo_municipio] || (sPorMun[s.codigo_municipio] = { a: 0, b: 0, k: 0, o: 0, br: 0, nu: 0 });
    x.a += +s.braide_votos; x.b += +s.orleans_votos; x.k += +s.camarao_votos; x.o += +s.outros_votos; x.br += +s.brancos; x.nu += +s.nulos;
  });
  for (const m of M) {
    const x = sPorMun[m.codigo_municipio];
    if (!x) { erro(`${m.municipio}: sem secoes`); continue; }
    if (x.a !== +m.braide_votos || x.b !== +m.orleans_votos || x.k !== +m.camarao_votos) erro(`${m.municipio}: votos das secoes != municipio`);
    if (x.a + x.b + x.k + x.o !== +m.validos_tse) erro(`${m.municipio}: base das secoes (${x.a + x.b + x.k + x.o}) != validos_tse (${m.validos_tse})`);
    if (x.br !== +m.brancos || x.nu !== +m.nulos) erro(`${m.municipio}: brancos/nulos das secoes != municipio`);
  }
  bom('secoes somam os municipios (votos, base, brancos e nulos)');

  // ---- locais e apuracao alinhados com as secoes ----
  exige(LOC.length === S.length && LOC.every((l, i) => l.codigo_municipio === S[i].codigo_municipio && l.zona === S[i].zona && l.secao === S[i].secao),
    'locais_votacao_por_secao.csv fora de sincronia com o CSV de secoes (rode npm run dados:locais)', 'locais alinhados com as secoes');
  const ap = json(P('data/apuracao.json'));
  exige(ap.n === S.length && ap.t.length === S.length, 'data/apuracao.json fora de sincronia (rode npm run dados:apuracao)', 'apuracao alinhada com as secoes');
  exige(ap.t.every(t => Number.isFinite(t) && t >= 0), 'apuracao com horario invalido');
  const fora = LOC.filter(l => { const la = parseFloat(l.latitude.replace(',', '.')), lo = parseFloat(l.longitude.replace(',', '.')); return !(la < 0 && la > -11 && lo < -41 && lo > -50) });
  if (fora.length) aviso(`${fora.length} locais de votacao sem coordenada valida (o botao "Ver no mapa" some nesses casos)`);
  const exc = S.filter((s, i) => +s.total_votos > +LOC[i].eleitores_secao + +LOC[i].eleitores_agregados);
  if (exc.length > S.length * 0.005) erro(`${exc.length} secoes com mais votos que eleitores no cadastro (>0,5%): revise o CSV de locais`);
  else if (exc.length) aviso(`${exc.length} secoes com mais votos que eleitores no cadastro de locais (limitacao do cadastro; a abstencao por secao e tratada como estimativa)`);

  // ---- legislativo x secoes x municipios ----
  const idxMun = Object.fromEntries(M.map((m, i) => [m.codigo_municipio, i]));
  for (const k of ['federal', 'estadual', 'senador']) {
    const L = json(P(`data/legislativo_${k}.json`)), J = json(P(`data/secoes_${k}.json`));
    exige(L.mun.length === 217 && L.mun.every(c => cods.has(c)), `legislativo_${k}: municipios divergem do CSV`);
    exige(Array.isArray(L.vc) && L.vc.length === 217, `legislativo_${k}: falta vc (rode npm run dados:legislativo)`);
    exige(J.n === S.length, `secoes_${k}.json fora de sincronia com o CSV de secoes (rode npm run dados:secoes)`);
    if (J.n !== S.length || !Array.isArray(L.vc)) continue;
    // votos por candidato: estado x secoes
    const tot = {};
    for (const n in J.c) tot[n] = J.c[n].reduce((s, v, i) => s + (i % 2 ? v : 0), 0);
    const ruim = L.cands.filter(c => (tot[String(c.n)] || 0) !== c.v);
    exige(!ruim.length, `${k}: ${ruim.length} candidatos com votos das secoes != estado (${ruim.slice(0, 3).map(c => c.nm).join(', ')})`);
    const naoReg = Object.keys(J.c).filter(n => !L.cands.some(c => String(c.n) === n));
    exige(!naoReg.length, `${k}: secoes com candidatos fora do resultado do TSE: ${naoReg.join(', ')} (rode npm run dados:secoes)`);
    // base por municipio: nominais + legenda das secoes == vvc do municipio
    const por = new Array(217).fill(0);
    const nom = new Array(S.length).fill(0);
    for (const n in J.c) { const a = J.c[n]; for (let i = 0; i < a.length; i += 2) nom[a[i]] += a[i + 1]; }
    S.forEach((s, i) => { por[idxMun[s.codigo_municipio]] += nom[i] + (J.lg ? J.lg[i] : 0); });
    const dif = L.mun.filter((c, i) => por[idxMun[c]] !== L.vc[i]);
    exige(!dif.length, `${k}: ${dif.length} municipios com base das secoes != votos validos computados do TSE`, `${k}: base das secoes bate com o TSE em todos os municipios`);
    // totais do estado
    // vnom do TSE exclui os anulados sub judice; os candidatos incluem
    exige(soma(L.cands, c => c.v) === L.geral.nom + (L.geral.subjudice || 0), `${k}: soma dos candidatos != votos nominais + sub judice do estado`);
    exige(L.geral.vvc === L.vc.reduce((s, v) => s + v, 0), `${k}: vvc do estado != soma dos municipios`);
    exige(L.cands.filter(c => c.e).length === L.vagas, `${k}: eleitos (${L.cands.filter(c => c.e).length}) != vagas (${L.vagas})`);
    const percBase = L.geral.vvc;
    const dp = L.cands.filter(c => Math.abs(c.v / percBase * 100 - c.pc) > 0.01);
    if (dp.length) aviso(`${k}: ${dp.length} candidatos com % do TSE diferente de votos/vvc (>0,01 p.p.)`);
  }

  // ---- presidente ----
  const Pz = json(P('data/presidente.json'));
  exige(Pz.mun.length === 217 && Pz.mun.every((c, i) => c === M[i].codigo_municipio), 'presidente.json: municipios fora da ordem do CSV (rode npm run dados:presidente)', 'presidente alinhado com os municipios');
  for (const t of ['t1', 't2']) {
    const T = Pz[t]; if (!T) { aviso(`presidente.${t} ausente`); continue; }
    const somaC = T.mv.map(a => a.reduce((s, v) => s + v, 0));
    const ruim = T.cands.filter((c, i) => somaC[i] !== c.v);
    exige(!ruim.length, `presidente.${t}: ${ruim.length} candidatos com soma dos municipios != estado`);
    if (T.apurado) exige(T.vv.reduce((s, v) => s + v, 0) === T.ma.validos, `presidente.${t}: validos dos municipios != estado`);
    // Brasil por estado: 27 UFs + exterior somam o total nacional; Maranhao igual ao detalhe por municipio
    if (T.nat && T.ufs) {
      exige(T.ufs.length === 28, `presidente.${t}: esperados 27 estados + exterior, ha ${T.ufs.length} (rode npm run dados:presidente)`);
      exige(T.ufs.reduce((s, u) => s + u.validos, 0) === T.nat.geral.validos, `presidente.${t}: soma dos estados != votos validos do Brasil`);
      const dv = T.nat.cands.filter((c, i) => T.ufs.reduce((s, u) => s + u.v[i], 0) !== c.v);
      exige(!dv.length, `presidente.${t}: ${dv.length} candidatos com soma dos estados != total nacional`);
      const ma = T.ufs.find(u => u.uf === 'ma');
      exige(ma && ma.validos === T.ma.validos, `presidente.${t}: Maranhao nos estados != detalhe por municipio`);
    } else if (T.apurado) erro(`presidente.${t}: faltam os dados por estado (rode npm run dados:presidente)`);
  }
  bom('presidente confere (soma dos municipios = estado)');

  // ---- sanidade geral dos numeros ----
  const naoNum = [];
  const varrer = (o, p) => { if (Array.isArray(o)) { if (o.length && typeof o[0] === 'number') { if (o.some(v => !Number.isFinite(v))) naoNum.push(p) } else o.forEach((x, i) => { if (i < 3) varrer(x, p) }) } else if (o && typeof o === 'object') for (const k in o) varrer(o[k], p + '.' + k) };
  varrer(Pz, 'presidente'); varrer(ap, 'apuracao');
  exige(!naoNum.length, 'valores nao numericos (NaN/Infinity) em: ' + naoNum.join(', '));

  if (!silencioso) {
    ok.forEach(m => console.log('  ok   ' + m));
    avisos.forEach(m => console.log('  AVISO ' + m));
    erros.forEach(m => console.error('  ERRO  ' + m));
    console.log(erros.length ? `\n${erros.length} erro(s) nos dados.` : `\nDados consistentes (${ok.length} verificacoes, ${avisos.length} aviso(s)).`);
  }
  return { erros, avisos, ok };
}

module.exports = { validar };
if (require.main === module) {
  const r = validar();
  process.exit(r.erros.length ? 1 : 0);
}
