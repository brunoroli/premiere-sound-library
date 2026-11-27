# Premiere Sound Library

Painel (plugin UXP) para o Adobe Premiere Pro: biblioteca de músicas e efeitos sonoros com categorias, e clique para colocar direto na timeline.

## Status: Fase 0 (prova de conceito)

Um painel de teste que:
1. deixa você escolher um arquivo de áudio;
2. importa esse arquivo no projeto (se ainda não estiver);
3. coloca na timeline, na posição do playhead, na faixa escolhida.

O objetivo é confirmar que a API do Premiere faz isso de forma confiável no **Mac e no Windows** antes de construir o resto.

## Como testar

1. Instale a **UXP Developer Tool** pelo app Creative Cloud.
2. Abra o Premiere com um projeto e uma sequência aberta na timeline.
3. Na UXP Developer Tool: **Add Plugin** → selecione o arquivo `plugin/manifest.json`.
4. Clique em **Load** (ou nos "..." → Load). O painel deve aparecer no Premiere (se não aparecer, procure no menu **Window / Janela → UXP Plugins**, ou similar).
5. No painel:
   - **1. Escolher arquivo de áudio**
   - Deixe as faixas como estão (áudio 2, vídeo 0) para o primeiro teste
   - Clique em **2a. Inserir no playhead (sobrescrever)**
6. Veja em qual faixa o áudio entrou. Os índices de faixa podem começar em 0 ou em 1 (a documentação não deixa claro), por isso o campo é editável.

### O que me mandar depois do teste
- Funcionou? Em qual faixa o áudio apareceu (A1, A2, A3…)?
- O botão **2b** (empurrar clipes) também funcionou?
- Alguma coisa foi parar numa faixa de vídeo?
- Se deu erro: o texto do **Log** do painel (print ou copiado).
- Repita no outro computador (Mac/Windows).

## Estrutura

```
plugin/
  manifest.json   configuração do plugin (nome, permissões, versão mínima do Premiere)
  index.html      interface do painel
  main.js         lógica: escolher arquivo, importar, colocar na timeline
```

## Roteiro

| Fase | Entrega |
|---|---|
| 0 | Teste: importar e colocar no playhead |
| 1 | Escolher pasta da biblioteca (Google Drive) e listar os áudios |
| 2 | Preview com play/pause |
| 3 | Categorias, tags e busca (salvas na pasta do Drive, caminhos relativos) |
| 4 | Clique para inserir com faixa configurável (música / SFX) |
| 5 | Favoritos, recentes, atalhos, inserir só um trecho |
