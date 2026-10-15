# Valenzia — editor de mundo

Editor de mapa de RPG. O mapa começa vazio — só terra e mar — e você constrói
em cima dele: divide continentes em países, divide o oceano em mares, pinta
biomas e marca cidades e pontos de interesse.

React + TypeScript + Vite. O mapa é desenhado em `<canvas>`; os marcadores
ficam numa camada HTML por cima.

## Como começar

```bash
npm install

# 1. Salve o mapa em branco (só o verde da terra e o azul do mar) em:
#    public/source/base.png

# 2. Diga ao editor onde é terra e onde é mar:
npm run prepare:map

# 3. Suba o editor:
npm run dev
```

## A ideia

A imagem é só o pano de fundo e **nunca é alterada**. Tudo que você cria vive
em camadas próprias, e por isso renomear um país, remapear uma fronteira ou
trocar um bioma é mudar um dado — não repintar um pixel.

São duas camadas, cada uma guardando um número por pixel:

| Camada | O que guarda |
| --- | --- |
| **Território** | o país (na terra) ou o mar (na água) de cada pixel |
| **Bioma** | floresta, deserto, pântano, montanha... |

Território é uma camada só para países e mares porque um pixel nunca é os
dois. Bioma é separada porque uma floresta vive *dentro* de um país.

### A máscara de terra é um gabarito

O `prepare:map` responde uma única pergunta para cada pixel: terra ou mar? Esse
resultado vira o gabarito do pincel. Ao pintar um país, a tinta só pega no
verde — você pode passar o pincel por cima do oceano à vontade que ele **para
sozinho na costa**. Para mares, o contrário.

E fronteira entre dois países nunca tem buraco nem sobreposição, por
construção: pintar o país B simplesmente reescreve o pixel que era do A.

### Arquivos

| Arquivo | O que é |
| --- | --- |
| `public/mask.png` | terra (branco) e mar (preto) |
| `public/coast.png` | a linha de costa, desenhada por cima da pintura |
| `public/data/geo.json` | dimensões e as duas cores |
| `public/data/world.json` | **seu conteúdo**: nomes, fichas, pontos |
| `public/data/territory.png` | **sua pintura**: países e mares |
| `public/data/biome.png` | **sua pintura**: biomas |

Os três primeiros derivam da imagem e estão no `.gitignore`. Os três últimos
são o seu mundo — esses valem versionar.

As camadas viram PNG porque são 7,7 milhões de posições cada: não caberiam em
JSON. O número do slot é gravado em `R + G*256`. Como são poucos valores em
áreas chapadas, o PNG comprime muito bem.

## Usando

**Ferramentas** — no botão flutuante no canto inferior esquerdo. Ele mostra
sempre a ferramenta em uso; clique para trocar. Atalhos entre parênteses:

- **Mover** (`M`) — padrão. Só arrasta o mapa; nada no mundo é alterado.
- **Selecionar** (`V`) — clique abre a ficha do que estiver embaixo.
- **Balde** (`G`) — preenche a massa de terra inteira num clique. É assim que
  uma ilha vira um país de uma vez.
- **Laço** (`L`) — segure e desenhe uma volta; ao soltar, o miolo vira
  território. Jeito mais rápido de recortar um pedaço de continente.
- **Pincel** (`B`) — pinta por cima para subdividir. `[` e `]` mudam o tamanho.
- **Borracha** (`E`) — devolve a área para "sem dono".

O botão do meio e o direito do mouse arrastam o mapa mesmo com o pincel ativo.
`Ctrl+Z` desfaz — inclusive pinceladas e exclusões. Com o pincel ou a borracha
ativos, o controle de tamanho aparece acima do botão flutuante (ou `[` e `]`).

A barra de cima fica só com o nome do mundo, o que o pincel vai aplicar, as
três visões e um menu de três pontos — desfazer, salvar, exportar, importar,
enquadrar e os interruptores de fronteiras, nomes e pontos. O pontinho dourado
ao lado do nome avisa que há alterações não salvas.

O painel da direita tem dois níveis: a lista, ou a ficha do item escolhido —
nunca os dois ao mesmo tempo. A seta no topo da ficha volta para a lista.

**O fluxo normal:** crie um país no painel da direita (ele já entra no modo
balde), clique na massa de terra para preencher, depois crie o país vizinho e
tome a parte dele com o laço ou o pincel. Repita.

O laço não precisa de pontaria: contorne por fora, passando pelo oceano se for
mais confortável, que só a terra dentro da volta é pintada.

### Como o laço decide o que é "dentro"

Não por paridade de cruzamentos — essa regra abre buracos quando o traço se
cruza, e traço à mão livre se cruza o tempo todo. Em vez disso o caminho é
rasterizado como uma cerca e a inundação começa **de fora** da moldura: o que a
água de fora não alcança é o miolo. Aguenta rabisco com nó, laço em oito e
volta por cima do próprio traço.

A cerca é desenhada em 8-vizinhos e a inundação anda em 4-vizinhos. Essa
combinação é o que garante que uma diagonal da cerca vede de verdade, sem
vazar pelo canto.

**Biomas** funcionam igual: escolha um tipo, ele vira uma área nomeada, e você
pinta.

## As três visões

Na barra superior, ou com as teclas `1` `2` `3`:

| Visão | O que mostra |
| --- | --- |
| **Política** | só as cores dos países e mares |
| **Biomas** | só as cores dos biomas, com as fronteiras por cima |
| **Mista** | o bioma em hachura sobre a cor do país |

A hachura existe porque na visão mista precisa dar para ver os dois: as faixas
deixam a cor do país aparecer entre elas. Na visão de biomas não há país
embaixo, então a cor entra chapada — e terra sem bioma nenhum volta ao verde do
mundo, em vez de ficar com a cor do país.

As fronteiras continuam desenhadas nas três, e têm um interruptor próprio.

## Pontos

Na aba Pontos (ou direto na ficha de um país), escolha um tipo e vá clicando no
mapa; `Esc` sai do modo. Arraste um marcador para reposicionar.

**O país de um ponto não é um campo que você preenche** — é lido da pintura, na
coordenada onde o ponto está. Então a ficha do país lista sozinha tudo que caiu
dentro das fronteiras dele, e repintar uma fronteira já troca o dono da cidade,
sem nada para sincronizar. Um ponto no mar aberto ou em terra sem dono
simplesmente não tem país.

Por isso não existe campo "capital": a capital é o ponto do tipo Capital que
estiver dentro do país — e um país pode ter várias sem nenhum arranjo especial.

O interruptor **Pontos** na barra superior esconde todos os marcadores de uma
vez, quando o mapa ficar poluído. Para esconder só alguns tipos, use os filtros
da aba Pontos.

## Salvando

O botão **Salvar** grava o mundo e as duas camadas em `public/data/` (só em
`npm run dev`, via um middleware do Vite), para o trabalho entrar no git. Fora
do dev, ele baixa os arquivos.

Enquanto você trabalha, um rascunho é guardado sozinho no navegador
(IndexedDB — as camadas são grandes demais para `localStorage`). Se o navegador
fechar sem salvar, o editor oferece o rascunho de volta na próxima abertura.

## Ajustes finos

Em `scripts/prepare.mjs`:

- `INK_VALUE` (105) — quão escuro um pixel precisa ser para contar como traço
  de costa em vez de terra ou mar. O critério é o valor (máximo do RGB) e não a
  luminância, porque cores saturadas podem ter luminância baixa sem serem
  pretas.

Se a sua imagem for JPEG, prefira reexportar em PNG: a compressão com perdas
espalha a cor da terra e do mar e deixa a separação menos limpa.

## Estrutura

```
scripts/prepare.mjs         separa terra de mar (roda no Node, com sharp)
src/lib/layers.ts           motor de pintura: balde, pincel, desfazer, textura
src/lib/store.ts            camadas em PNG, rascunho em IndexedDB, salvar
src/lib/biomes.ts           tipos de bioma e paletas sugeridas
src/hooks/useMapBase.ts     carrega a mascara de terra e a costa
src/components/MapView.tsx  canvas, zoom, pintura e repintura incremental
src/components/Sidebar.tsx  abas de paises, mares, biomas e pontos
src/components/Toolbar.tsx  ferramentas, visoes, salvar
```

### Por que a pintura não trava

Repintar os 7,7M de pixels a cada movimento do mouse seria inviável. Cada
pincelada devolve o retângulo que realmente mudou, e só esse pedaço da textura
é recalculado. O mapa inteiro só é repintado quando você troca a cor de um país
ou troca de visão.
