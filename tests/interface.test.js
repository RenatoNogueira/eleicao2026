// Testes de interface do painel (navegador sem interface). Rode apos "npm run build":
//   cd tests && npm install && npm test        (ou, na raiz: npm run teste)
// Usa o Chrome/Edge instalado (CHROME_PATH sobrescreve). A pagina carrega Chart.js do CDN, entao precisa de internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function achaChrome() {
  const c = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const p = c.find(x => fs.existsSync(x));
  if (!p) throw new Error('Chrome/Edge nao encontrado. Defina CHROME_PATH.');
  return p;
}

let server, base, browser;
test.before(async () => {
  server = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const f = path.join(PUBLIC, u === '/' ? 'index.html' : u);
    fs.readFile(f, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d);
    });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: achaChrome(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

/* abre uma pagina, juntando erros de execucao; ignora falhas de rede externas (fontes, analytics) */
async function abrir(hash = '', viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|fonts\.g|googletagmanager/i.test(m.text())) erros.push('console: ' + m.text()); });
  await page.goto(base + '/' + hash, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.view.on') && typeof ST !== 'undefined', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500)); // fim da animacao de entrada
  return { page, erros };
}
const texto = (page, sel) => page.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim());

test('abre todas as abas sem erros e com o endereco em portugues', async () => {
  const { page, erros } = await abrir('#visao-geral');
  const rotas = { 'visao-geral': 'v-overview', mapa: 'v-map', municipios: 'v-cities', comparar: 'v-compare', analises: 'v-analysis', presidente: 'v-pres', 'zonas-e-secoes': 'v-secoes', legislativo: 'v-deps' };
  for (const [rota, view] of Object.entries(rotas)) {
    await page.evaluate(r => { location.hash = '#' + r; }, rota);
    await page.waitForFunction(v => document.querySelector('.view.on')?.id === v, { timeout: 10000 }, view);
    await new Promise(r => setTimeout(r, 600));
  }
  // endereco antigo em ingles continua valendo
  await page.evaluate(() => { location.hash = '#pres'; });
  await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-pres');
  assert.equal(await page.evaluate(() => location.hash), '#presidente');
  assert.deepEqual(erros, []);
  await page.close();
});

test('visao geral mostra os percentuais do TSE com duas casas', async () => {
  const { page, erros } = await abrir('#visao-geral');
  // o numero do topo e animado (contagem): espera o valor final
  await page.waitForFunction(() => document.querySelector('#hA').textContent === '54,02%', { timeout: 15000 });
  const r = await page.evaluate(() => ({ pa: ST.pa.toFixed(2), pb: ST.pb.toFixed(2), pk: ST.pk.toFixed(2), a: ST.a, b: ST.b, ab: ST.ab, hero: document.querySelector('#hA').textContent }));
  assert.equal(r.pa, '54.02'); assert.equal(r.pb, '34.76'); assert.equal(r.pk, '9.60');
  assert.equal(r.a, 2104122); assert.equal(r.b, 1354044); assert.equal(r.ab, 1022456);
  assert.equal(r.hero, '54,02%');
  // nenhum percentual com uma casa so em nenhuma aba
  for (const v of ['overview', 'cities', 'analysis', 'pres', 'deps']) {
    await page.evaluate(x => document.querySelector(`#nav button[data-v=${x}]`).click(), v);
    await new Promise(r => setTimeout(r, 1500));
    const t = await page.evaluate(() => document.querySelector('.view.on').innerText);
    const um = t.match(/\d+,\d%(?!\d)/g) || [];
    assert.deepEqual(um, [], `percentual com 1 casa na aba ${v}`);
  }
  assert.deepEqual(erros, []);
  await page.close();
});

test('busca global encontra candidato e abre a gaveta', async () => {
  const { page, erros } = await abrir('#visao-geral');
  await page.type('#gs', 'maedja');
  await page.waitForSelector('#sugg.on button');
  const lista = await texto(page, '#sugg');
  assert.match(lista, /Maedja Campos/);
  await page.evaluate(() => [...document.querySelectorAll('#sugg button')].find(b => /Maedja/i.test(b.innerText)).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForSelector('#drawer.on h2');
  assert.match(await texto(page, '#drawer h2'), /Maedja Campos/);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('no-scroll')), true, 'rolagem da pagina deve ficar travada com a gaveta aberta');
  assert.deepEqual(erros, []);
  await page.close();
});

test('link direto de municipio abre a gaveta e o botao compartilhar existe', async () => {
  const { page, erros } = await abrir('#municipios/sao-luis');
  await page.waitForSelector('#drawer.on h2');
  assert.match(await texto(page, '#drawer h2'), /São Luís/);
  assert.ok(await page.$('#drawer .shr'), 'botao compartilhar da gaveta');
  assert.ok(await page.$('#share'), 'botao compartilhar do cabecalho');
  await page.evaluate(() => closeDrawer());
  assert.equal(await page.evaluate(() => location.hash), '#municipios');
  assert.deepEqual(erros, []);
  await page.close();
});

test('presidente: 1o turno do MA e gaveta de municipio', async () => {
  const { page, erros } = await abrir('#presidente');
  await page.evaluate(() => document.querySelector('#presScope button[data-s="ma"]').click());
  await new Promise(r => setTimeout(r, 600));
  const apurado = await page.evaluate(() => PRES.T[2].apurado);
  await page.evaluate(() => document.querySelector('#presTurn button[data-t="1"]').click());
  await new Promise(r => setTimeout(r, 800));
  const card = await texto(page, '#presCands .pcand');
  assert.match(card, /Lula/); assert.match(card, /63,99%/); assert.match(card, /de 4\.010\.439 votos válidos/);
  assert.match(await texto(page, '#presTurn'), apurado ? /^1º turno 2º turno$/ : /2º turno · aguardando/);
  await page.evaluate(() => openPres('08893'));
  await page.waitForSelector('#drawer.on h2');
  const g = await texto(page, '#drawer');
  assert.match(g, /São José de Ribamar/); assert.match(g, /de 105\.538 válidos/); assert.match(g, /Abstenção/);
  assert.deepEqual(erros, []);
  await page.close();
});

test('zonas e secoes: filtro de municipio, zona e secao', async () => {
  const { page, erros } = await abrir('#zonas-e-secoes');
  assert.match(await texto(page, '#sKpis'), /18\.093/);
  await page.evaluate(() => {
    const m = document.querySelector('#sMun');
    m.value = [...m.options].find(o => /são josé de ribamar/i.test(o.text)).value;
    m.dispatchEvent(new Event('change'));
    const z = document.querySelector('#sZona'); z.value = '0047'; z.dispatchEvent(new Event('change'));
    const s = document.querySelector('#sSec'); s.value = '81'; s.dispatchEvent(new Event('input'));
  });
  await new Promise(r => setTimeout(r, 600));
  const linha = await texto(page, '#sTbl tbody tr');
  assert.match(linha, /São José de Ribamar/); assert.match(linha, /148/); assert.match(linha, /72/);
  await page.evaluate(() => document.querySelector('#sTbl tbody tr').click());
  await page.waitForSelector('#drawer.on h2');
  assert.match(await texto(page, '#drawer'), /Maria Elisa Almeida Silva/i);
  assert.deepEqual(erros, []);
  await page.close();
});

test('comparar candidatos: graficos, municipio e atalhos', async () => {
  const { page, erros } = await abrir('#comparar');
  await page.waitForSelector('#ccA');
  assert.equal(await page.evaluate(() => !!Chart.getChart('ccA') && !!Chart.getChart('ccB') && !!Chart.getChart('ccC')), true);
  await page.evaluate(() => { const m = document.querySelector('#ccMun'); m.value = '08893'; m.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForSelector('#ccM1');
  assert.match(await texto(page, '#ccBody'), /Posição no município/);
  await page.evaluate(() => { const m = document.querySelector('#ccMun'); m.value = 'all'; m.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForSelector('#ccA');
  await page.evaluate(() => document.querySelector('[data-ccpre=top]').click());
  await new Promise(r => setTimeout(r, 800));
  assert.equal(await page.$$eval('#ccBody .ccard', c => c.length), 4);
  assert.deepEqual(erros, []);
  await page.close();
});

test('mobile: barra inferior, folha Mais e sem rolagem horizontal', async () => {
  const { page, erros } = await abrir('#visao-geral', { width: 390, height: 844, isMobile: true, hasTouch: true });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#nav')).display), 'none');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#tabbar')).display), 'grid');
  await page.evaluate(() => document.querySelector('#tbMore').click());
  await new Promise(r => setTimeout(r, 500));
  assert.equal(await page.evaluate(() => document.querySelector('#moreSheet').classList.contains('on')), true);
  await page.evaluate(() => document.querySelector('#moreSheet button[data-v=secoes]').click());
  await page.waitForFunction(() => document.querySelector('.view.on')?.id === 'v-secoes');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'rolagem horizontal no mobile');
  assert.deepEqual(erros, []);
  await page.close();
});

test('aviso de nova versao fica oculto na versao atual', async () => {
  const { page } = await abrir('#visao-geral');
  assert.equal(await page.evaluate(() => document.querySelector('#updateBar').hidden), true);
  const v = await page.evaluate(async () => (await (await fetch('version.json', { cache: 'no-store' })).json()).id);
  assert.equal(v, await page.evaluate(() => BUILD_ID));
  await page.close();
});

test('presidente: 2o turno (aguardando ou apurado, conforme os dados)', async () => {
  const { page, erros } = await abrir('#presidente');
  await page.evaluate(() => document.querySelector('#presScope button[data-s="ma"]').click());
  await new Promise(r => setTimeout(r, 600));
  const apurado = await page.evaluate(() => PRES.T[2].apurado);
  await page.evaluate(() => document.querySelector('#presTurn button[data-t="2"]').click());
  await new Promise(r => setTimeout(r, 1200));
  if (!apurado) {
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#presPending')).display !== 'none'), true);
  } else {
    const d = await page.evaluate(() => ({ cards: document.querySelectorAll('#presCands .pcand').length, heads: [...document.querySelectorAll('#presTbl thead th')].map(t => t.innerText), chips: document.querySelector('#presLead').innerText, nota: document.querySelector('#presNote').innerText, soma: PRES.cands.reduce((s, c) => s + c.v, 0), validos: PRES.ma.validos }));
    assert.equal(d.cards, 2);
    assert.ok(d.heads.some(h => /vs 1º t./i.test(h)), 'coluna de variacao sobre o 1o turno');
    assert.match(d.chips, /Mudaram de líder/);
    assert.match(d.nota, /2º turno/);
    assert.equal(d.soma, d.validos, 'votos dos 2 candidatos devem somar os validos');
    await page.evaluate(() => openPres('08893'));
    await page.waitForSelector('#drawer.on h2');
    assert.match(await texto(page, '#drawer'), /No 1º turno/);
  }
  assert.deepEqual(erros, []);
  await page.close();
});

test('presidente Brasil: resultado geral e por estado', async () => {
  const { page, erros } = await abrir('#presidente');
  assert.equal(await page.evaluate(() => PS.scope), 'br', 'a aba abre no Brasil');
  const d = await page.evaluate(() => {
    const T = PRES.T[PS.turn];
    return { turno: PS.turn, tiles: document.querySelectorAll('#brTiles .tile').length, linhas: document.querySelectorAll('#brTbl tbody tr').length,
      validos: T.nat.geral.validos, somaUF: T.ufs.reduce((s, u) => s + u.validos, 0), kpi: document.querySelector('#brKpis').innerText.replace(/\s+/g, ' '),
      cards: document.querySelector('#brCands').innerText.replace(/\s+/g, ' '), graf: !!Chart.getChart('brWon') && !!Chart.getChart('brUF') };
  });
  assert.equal(d.tiles, 27); assert.equal(d.linhas, 28); assert.equal(d.somaUF, d.validos, 'estados devem somar o Brasil');
  assert.match(d.kpi, /Votos válidos/); assert.match(d.kpi, /Abstenção/);
  assert.match(d.cards, /Lula/); assert.match(d.cards, /Flavio Bolsonaro/); assert.ok(d.graf);
  await page.evaluate(() => document.querySelector('#brTiles .tile[data-uf="sp"]').click());
  await page.waitForSelector('#drawer.on h2');
  const g = await texto(page, '#drawer');
  assert.match(g, /São Paulo/); assert.match(g, /vs Brasil/); assert.match(g, /Abstenção/);
  await page.evaluate(() => closeDrawer());
  // do Brasil para o Maranhao e de volta
  await page.evaluate(() => document.querySelector('#presScope button[data-s="ma"]').click());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#presMa')).display !== 'none');
  assert.deepEqual(erros, []);
  await page.close();
});

test('presidente Brasil no celular: sem rolagem horizontal e com o mapa de estados', async () => {
  const { page, erros } = await abrir('#presidente', { width: 390, height: 844, isMobile: true, hasTouch: true });
  assert.equal(await page.evaluate(() => PS.scope), 'br');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'rolagem horizontal no mobile');
  assert.equal(await page.$$eval('#brTiles .tile', t => t.length), 27);
  const larg = await page.evaluate(() => { const r = document.querySelector('#brTiles').getBoundingClientRect(); return r.width <= window.innerWidth; });
  assert.equal(larg, true, 'mapa de estados dentro da tela');
  assert.deepEqual(erros, []);
  await page.close();
});
