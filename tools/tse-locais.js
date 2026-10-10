// Gera locais_votacao_por_secao.csv (local de votacao, endereco, eleitores, secoes agregadas...) a partir do
// arquivo aberto do TSE "Eleitorado por local de votacao" (eleitorado_local_votacao_2026.zip, ~170 MB, todas as UFs).
// Uso: npm run dados:locais                      (baixa o zip do TSE para a pasta temporaria)
//      node tools/tse-locais.js <zip ou csv>     (usa um arquivo ja baixado)
// Fica so o 1o turno, so a UF (padrao MA) e so as secoes que existem em resultados_governador_por_secao.csv.
// Secoes agregadas nao tem urna propria: aparecem na coluna secoes_agregadas da secao principal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const UF = (process.env.UF || 'ma').toUpperCase();
const ANO = process.env.ANO || '2026';
const URL = `https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_${ANO}.zip`;
const SEC = path.join(ROOT, 'resultados_governador_por_secao.csv');
const OUT = path.join(ROOT, 'locais_votacao_por_secao.csv');

// Le uma entrada de um .zip (deflate ou stored) sem dependencias externas.
function zipEntry(buf, match) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip invalido');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (match.test(name)) {
      const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
      const data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nl + xl + cl;
  }
  throw new Error(`arquivo ${match} nao encontrado no zip`);
}

async function main() {
  let src = process.argv[2];
  if (!src) {
    src = path.join(os.tmpdir(), `eleitorado_local_votacao_${ANO}.zip`);
    console.log(`baixando ${URL}`);
    const r = await fetch(URL);
    if (!r.ok) throw new Error(`${r.status} ${URL}`);
    fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
  let raw = fs.readFileSync(src);
  if (/\.zip$/i.test(src)) raw = zipEntry(raw, new RegExp(`_${UF}\\.csv$`));
  const lines = raw.toString('latin1').split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(';').map(x => x.replace(/"/g, ''));
  const rows = lines.slice(1).map(l => {
    const c = l.split(';').map(x => x.replace(/^"|"$/g, ''));
    return Object.fromEntries(h.map((k, i) => [k, c[i]]));
  }).filter(r => r.NR_TURNO === '1' && r.SG_UF === UF);
  const pad = (v, n) => String(v).padStart(n, '0');
  const key = r => `${r.CD_MUNICIPIO}/${pad(r.NR_ZONA, 4)}/${pad(r.NR_SECAO, 4)}`;

  const secs = fs.readFileSync(SEC, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).slice(1).map(l => l.split(';'));
  const principal = new Map();
  const agreg = new Map(); // chave da secao principal -> [{secao, eleitores}]
  rows.forEach(r => {
    if (r.DS_TIPO_SECAO_AGREGADA === 'Principal') principal.set(key(r), r);
    else {
      const k = `${r.CD_MUNICIPIO}/${pad(r.NR_ZONA, 4)}/${pad(r.NR_SECAO_PRINCIPAL, 4)}`;
      (agreg.get(k) || agreg.set(k, []).get(k)).push({ s: pad(r.NR_SECAO, 4), e: +r.QT_ELEITOR_SECAO || 0 });
    }
  });

  const miss = [];
  const out = secs.map(c => {
    const k = `${c[0]}/${c[2]}/${c[3]}`, r = principal.get(k);
    if (!r) { miss.push(k); return null; }
    const ag = (agreg.get(k) || []).sort((a, b) => a.s.localeCompare(b.s));
    const t = s => s.replace(/;/g, ',').trim();
    return [c[0], c[2], c[3], t(r.NM_LOCAL_VOTACAO), t(r.DS_ENDERECO), t(r.NM_BAIRRO), r.NR_CEP, r.NR_LATITUDE, r.NR_LONGITUDE,
      t(r.DS_TIPO_LOCAL), r.CD_SITU_SECAO_ACESSIBILIDADE === '1' ? 'Sim' : 'Não', r.QT_ELEITOR_SECAO,
      ag.map(a => a.s).join(','), ag.reduce((s, a) => s + a.e, 0)].join(';');
  });
  if (miss.length) { console.error(`${miss.length} secoes do CSV sem local no TSE (ex.: ${miss.slice(0, 5).join(', ')})`); process.exit(1); }
  const head = 'codigo_municipio;zona;secao;local_votacao;endereco;bairro;cep;latitude;longitude;tipo_local;acessibilidade;eleitores_secao;secoes_agregadas;eleitores_agregados';
  fs.writeFileSync(OUT, '﻿' + [head, ...out].join('\n') + '\n', 'utf8');
  const nAg = [...agreg.values()].reduce((s, a) => s + a.length, 0);
  console.log(`${path.basename(OUT)}: ${out.length} secoes (${nAg} secoes agregadas, ${new Set(out.map(l => l.split(';').slice(0, 1).concat(l.split(';')[3]).join('|'))).size} locais)`);
}

main().catch(e => { console.error(e); process.exit(1); });
