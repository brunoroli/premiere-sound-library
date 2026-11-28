# Premiere Sound Library

Painel (plugin UXP) para o Adobe Premiere Pro: biblioteca de músicas e efeitos sonoros com categorias, e clique para colocar direto na timeline.

## Status: Fase 1 (biblioteca no painel)

- **Fase 0 ✅** — testado no Mac: importa e coloca o áudio no playhead. Índices de faixa começam em 0 (A1 = 0).
- **Fase 1** — o painel agora:
  1. pede a pasta da biblioteca (ex.: "Sounds fx" no Google Drive) e tenta lembrar dela nas próximas aberturas;
  2. lista todos os sons (.wav, .mp3, .aif, .m4a…), ignorando `.DS_Store` e arquivos de cache do Premiere (`.cfa`, `.pek`);
  3. cria uma aba por pasta onde os sons estão (categoria) — funciona mesmo escolhendo uma pasta acima, como "SFX e Trilhas" — e a aba **⭐ Favoritos** para pastas com "Preferidos"/"Favoritos" no nome;
  4. tem busca por nome;
  5. **clique no som → vai para a timeline no playhead**, na faixa escolhida (A1…A8, padrão A3), sobrescrevendo ou empurrando clipes.

- **Fase 2 ✅** — botão **▶** em cada som para ouvir antes (preview); ■ para parar. Clicar no **nome** continua colocando na timeline.
  - O painel tenta tocar **dentro dele mesmo** (via elemento `<video>`: primeiro `file://`, depois `data:` lendo o arquivo). Se nenhum funcionar, toca no **Source Monitor** (testado e funcionando). A linha de status mostra qual método foi usado: `(file)`, `(data)` ou `(monitor)`.

### Painel fixado / plugin some ao reabrir o Premiere
Plugins carregados pela **UXP Developer Tool** são temporários: ao fechar o Premiere, eles são descarregados, e o painel some do layout. Para o painel ficar instalado de vez:
1. Na UXP Developer Tool, nos **"..."** do plugin → **Package** → salve o arquivo `.ccx`.
2. Dê dois cliques no `.ccx` (o Creative Cloud instala o plugin).
3. Remova o plugin da UXP Developer Tool para não ficar duplicado.
4. Abra o painel pelo menu **Window** do Premiere e fixe na aba desejada.

- **Visual novo (0.4)** — tela inicial "Biblioteca" com cards por categoria (⭐ Favoritos, Todos e cada pasta); ao abrir uma categoria: título grande, busca, filtro **Curto / Médio / Longo** (≤1s, ≤3s, >3s) e cards de som com **▶ (ouvir)**, nome, **duração** e botão **+ (colocar na timeline)**. Clicar no card também toca o preview. Pasta, faixa e modo ficam nas configurações (⚙).
- **Layout compacto (0.5)** — uma linha de topo (voltar, título, nº de sons, ⚙) e uma linha com busca + filtros; todo o resto é a lista, que rola. Em painéis largos a lista vira **grade com várias colunas**. As configurações fecham sozinhas depois de escolher a pasta.
  - A duração é lida do arquivo (WAV exato; MP3 estimado) em segundo plano e guardada em cache. Outros formatos ficam sem duração.

### Requisito: Google Drive
O plugin lê os arquivos do disco. No Google Drive para computador, marque a pasta da biblioteca como **"Disponível off-line"**.

## Como testar

1. Na UXP Developer Tool, use **Load** (ou **Reload**, se já estava carregado) no plugin Sound Library.
2. No painel, clique em **Escolher pasta** e selecione a pasta "Sounds fx" (no Mac, fica em algo como `~/Library/CloudStorage/GoogleDrive-…/Meu Drive/Sounds fx`).
3. Navegue pelas abas, teste a busca e clique num som com o playhead posicionado.
4. Feche e reabra o Premiere: o painel deve lembrar a pasta (se não lembrar, me avise).

## Estrutura

```
plugin/
  manifest.json   configuração do plugin (nome, permissões, versão mínima do Premiere)
  index.html      interface do painel
  main.js         lógica: ler a pasta, abas/busca, importar e colocar na timeline
```

## Roteiro

| Fase | Entrega |
|---|---|
| 0 ✅ | Teste: importar e colocar no playhead |
| 1 🔄 | Escolher pasta, categorias por subpasta, favoritos, busca, clique para inserir |
| 2 🔄 | Preview com play/stop (via Source Monitor) |
| 3 | Categorias, tags e busca (salvas na pasta do Drive, caminhos relativos) |
| 4 | Clique para inserir com faixa configurável (música / SFX) |
| 5 | Favoritos, recentes, atalhos, inserir só um trecho |
