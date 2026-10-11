// Atualiza todos os dados na ordem certa e valida no final.
// Uso: npm run dados:tudo            (governador, legislativo, presidente, secoes, apuracao; valida)
//      npm run dados:rapido          (so governador, legislativo e presidente; valida)
//      node tools/atualizar-tudo.js --locais   (inclui o cadastro de locais de votacao, ~170 MB)
// A ordem importa: locais e apuracao seguem a ordem das secoes; o legislativo precisa estar pronto antes das secoes.
const { spawnSync } = require('child_process');
const path = require('path');

const rapido = process.argv.includes('--rapido');
const locais = process.argv.includes('--locais');
const passos = [
  ['governador (municipios e zonas)', 'tse-governador.js'],
  ['legislativo (deputados e senador)', 'tse-deputados.js'],
  ['presidente (1o e 2o turno)', 'tse-presidente.js'],
];
if (!rapido) {
  passos.push(['secoes (boletins de urna)', 'tse-secoes.js']);
  if (locais) passos.push(['locais de votacao', 'tse-locais.js']);
  passos.push(['apuracao (horarios das secoes)', 'tse-apuracao.js']);
}
passos.push(['validacao dos dados', 'validar-dados.js']);

const t0 = Date.now();
for (const [nome, arq] of passos) {
  console.log(`\n=== ${nome} ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, arq)], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nFalhou em "${nome}". Corrija e rode de novo (as etapas ja feitas usam cache).`); process.exit(r.status || 1); }
}
console.log(`\nConcluido em ${Math.round((Date.now() - t0) / 1000)} s. Proximo passo: npm run build e publicar.`);
