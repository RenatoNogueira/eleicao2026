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
data/legislativo_*.json resultados de Deputado Federal/Estadual e Senador por município (gerados do TSE)
tools/tse-deputados.js baixa os dados do TSE e gera data/legislativo_*.json
build.js               lê o CSV + mapa e renderiza o EJS
```

Para ver localmente, abra `public/index.html` depois do build. No Vercel o build roda sozinho (`vercel.json`).

Para atualizar os resultados, troque `resultados_governador_por_municipio.csv` (mesmas colunas) e rode o build.

## Legislativo (deputados federal e estadual e senador)

A aba **Legislativo** usa `data/legislativo_{federal,estadual,senador}.json`, gerados a partir dos
arquivos públicos de resultado do TSE (eleição `6259`, 1º turno 2026, cargos 6, 7 e 5). Para atualizar:

```bash
npm run dados:legislativo   # baixa do TSE (~650 requisições) e regrava data/legislativo_*.json
npm run build
```
