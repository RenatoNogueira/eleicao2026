# Dashboard MA

`public/index.html` é **gerado** (não versionado) — não edite à mão. Edite `src/` e rode:

```bash
npm install      # uma vez
npm run build    # gera public/index.html (arquivo único, funciona offline)
npm run watch    # rebuild automático ao salvar
```

```
src/index.ejs          esqueleto da página
src/partials/          cabeçalho, rodapé, overlays (tooltip, gaveta)
src/views/             uma view por aba (overview, map, cities, compare, analysis)
src/styles/main.css    estilos
src/scripts/NN-*.ejs   JS em módulos, concatenados na ordem numérica
data/mapa_ma.json      malha dos municípios (IBGE) já projetada em SVG, chave = código TSE
data/deputados_*.json  resultados de Deputado Federal/Estadual por município (gerados do TSE)
tools/tse-deputados.js baixa os dados do TSE e gera data/deputados_*.json
build.js               lê o CSV + mapa e renderiza o EJS
```

Para ver localmente, abra `public/index.html` depois do build. No Vercel o build roda sozinho (`vercel.json`).

Para atualizar os resultados, troque `resultados_governador_por_municipio.csv` (mesmas colunas) e rode o build.

## Deputados (federal e estadual)

A aba **Deputados** usa `data/deputados_federal.json` e `data/deputados_estadual.json`, gerados a partir dos
arquivos públicos de resultado do TSE (eleição `6259`, 1º turno 2026, cargos 6 e 7). Para atualizar:

```bash
npm run dados:deputados   # baixa do TSE (~434 requisições) e regrava data/deputados_*.json
npm run build
```
