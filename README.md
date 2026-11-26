# Valenzia

Caderno de mundo de RPG. Hoje o app tem um setor pronto, o **Atlas**: um
editor de mapas onde cada mapa é um **corpo celeste** (planeta ou lua). Os
outros setores (campanhas, personagens, bestiário) já têm lugar no menu
lateral e entram depois.

No Atlas você cria um planeta a partir de uma imagem ou desenha do zero,
divide a superfície em países, mares e zonas, pinta biomas e marca cidades e
pontos de interesse.

## Stack

| Parte | Tecnologia |
| --- | --- |
| `apps/web` | React 19 + TypeScript + Vite, react-router. Mapa em `<canvas>` |
| `apps/api` | Node 24 + Fastify 5 + Drizzle ORM + sharp |
| `packages/shared` | tipos, schemas zod, modelos de planeta, cálculo de área |
| Banco | PostgreSQL 17 |
| Deploy | Docker Compose: `db`, `api` e `web` (nginx servindo o build e fazendo proxy de `/api`) |

## Como rodar

### Tudo no Docker

```bash
docker compose up -d --build
```

Abra **http://localhost:8080**. A API aplica as migrações sozinha ao subir.

### Desenvolvimento (com recarga automática)

```bash
npm install
docker compose up -d db      # só o Postgres, na porta 5442
npm run db:migrate
npm run dev                  # API em :3100 e Vite em :5173
```

Abra **http://localhost:5173**. O Vite faz proxy de `/api` para a API.

As portas fogem das padrão de propósito (5442 em vez de 5432, 3100 em vez de
3000), para não brigar com um Postgres instalado na máquina nem com outros
projetos. Para mudar, copie `.env.example` para `.env`.

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API + front com recarga automática |
| `npm run build` | checa os tipos dos três pacotes e gera o build do front |
| `npm test` | testes (vitest). Os de API usam o banco `valenzia_test` no Postgres do compose |
| `npm run db:generate` | gera migração nova depois de mexer em `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | aplica as migrações pendentes |
| `npm run import:legacy` | importa um mundo do formato antigo (arquivos em `public/`). Veja o topo de `apps/api/src/scripts/import-legacy.ts` |

Para os testes de API, crie o banco uma vez:
`docker compose exec db psql -U valenzia -c "CREATE DATABASE valenzia_test"`.

## Modelo de dados

Cada mapa é uma linha em `bodies`. **Planeta ou lua não é uma coluna**:
quem tem `parent_id` é lua. Vincular um planeta a outro já faz dele uma lua.
A API garante que o vínculo tenha um nível só: lua não tem lua, e um planeta
que já tem luas não pode virar lua.

| Tabela | O que guarda |
| --- | --- |
| `bodies` | nome, descrição, **raio em km**, largura e altura do mapa, `parent_id`, anéis (`rings`, jsonb), inclinação do eixo (`axial_tilt`, graus), sentido da rotação (`retrograde`), miniatura, `revision` |
| `materials` | os materiais de terreno do corpo: nome, fase (`solid`, `liquid` ou `gas`), cor, textura |
| `layers` | as três camadas raster, em PNG (`terrain`, `territory`, `biome`) |
| `territories` | países, mares e zonas: nome, cor, ficha (governo, população...) |
| `biome_areas` | áreas de bioma |
| `pois` | pontos de interesse: tipo, posição, descrição |

Todas as entidades têm `uuid` estável, para que as features futuras
(personagens, campanhas) possam apontar para um planeta, um país ou uma
cidade. `bodies.owner_id` já existe, nulo, para quando houver login.

### As três camadas

Cada camada guarda um número por pixel:

| Camada | O número é |
| --- | --- |
| **Terreno** | o código de um material (mar, rocha, gás...) |
| **Território** | o `slot` do país, mar ou zona dono do pixel |
| **Bioma** | o `slot` da área de bioma |

Território e bioma são separados porque uma floresta vive *dentro* de um
país. Renomear um país, trocar uma cor ou uma textura é mudar uma linha no
banco, sem repintar nenhum pixel.

As camadas são grandes demais para JSON (até 4096 × 2048 posições), então
viajam e são gravadas como PNG, com o número em `R + G*256`. Como são poucos
valores em áreas chapadas, o PNG comprime muito bem (centenas de KB). Ao ler
de volta, o editor desliga a conversão de cor do navegador, porque um bit
trocado inventaria um país. Mesmo assim, ao abrir, uma faxina (`cleanLayer`)
remove pixels soltos e avisa se houver tinta sem ficha correspondente.

### Fases e estêncil

Cada material tem uma fase, e cada tipo de território só pega na sua:

| Tinta | Pega em |
| --- | --- |
| País | sólido |
| Mar | líquido |
| Zona | gás (para gigantes gasosos) |
| Bioma | sólido |
| Material de terreno | qualquer lugar |

É por isso que dá para passar o laço por cima do oceano à vontade: a tinta
do país **para sozinha na costa**. E fronteira entre dois países nunca tem
buraco nem sobreposição: pintar o país B reescreve o pixel que era do A.

Mexer no terreno (abrir um canal, aterrar o mar, mudar a fase de um
material) tira a tinta que ficou do lado errado, no mesmo passo do desfazer.

## Usando

### Criar um corpo celeste

**Atlas → Novo corpo celeste**, por um destes dois caminhos:

- **A partir de uma imagem.** Envie um mapa com terra de uma cor e mar de
  outra (a costa pode estar riscada em preto). A API mostra uma prévia da
  separação terra/mar e as cores detectadas, que dá para trocar. Ao
  confirmar, a imagem vira a camada de terreno e é descartada: nada vai para
  o repositório. O canto superior esquerdo da imagem precisa ser mar, porque
  é a referência.
- **Em branco.** Escolha um modelo (oceânico, rochoso, gigante gasoso ou lua
  cinzenta) e a resolução, e desenhe os continentes com o pincel e o laço na
  aba **Terreno**.

O botão **+ Lua** ao lado de um planeta cria uma lua já vinculada a ele.

### Tamanho

O raio em km é a medida física do corpo. É com ele que o editor calcula a
**área real** de cada país, mar e bioma em km². O mapa é equirretangular, e a
área de cada linha de pixels encolhe rumo aos polos. A resolução do mapa é
outra coisa: só o nível de detalhe do desenho.

O nome, a descrição, o raio e a órbita se editam no botão de engrenagem ao
lado do nome, no editor. Essas mudanças são gravadas na hora.

### Ferramentas

No botão flutuante do canto inferior esquerdo (atalhos entre parênteses):

- **Mover** (`M`): o padrão. Só arrasta o mapa.
- **Selecionar** (`V`): o clique abre a ficha do que estiver embaixo.
- **Balde** (`G`): preenche a região contígua inteira num clique. É assim
  que uma ilha vira um país de uma vez.
- **Laço** (`L`): desenhe uma volta e solte. O miolo é pintado.
- **Pincel** (`B`): pinta à mão livre. `[` e `]` mudam o tamanho, e o
  controle também aparece acima do botão.

**Apagar** (`E`, na barra de cima) faz o laço, o pincel e o balde devolverem
a área para "sem dono". No terreno não há apagar, porque todo pixel é de
algum material.

`Ctrl+Z` desfaz (pinturas, exclusões, edições de terreno) e `Ctrl+S` salva.
Os botões do meio e direito do mouse arrastam o mapa com qualquer ferramenta.

### Como o laço decide o que é "dentro"

Não por paridade de cruzamentos: essa regra abre buracos quando o traço se
cruza, e traço à mão livre se cruza o tempo todo. O caminho é rasterizado
como uma cerca e a inundação começa **de fora** da moldura: o que a água de
fora não alcança é o miolo. A cerca é desenhada em 8-vizinhos e a inundação
anda em 4-vizinhos, o que garante que uma diagonal da cerca vede de verdade.
O traço pode sair do mapa (para contornar uma ilha na borda, por exemplo) sem
problema.

### Painel da direita

As abas aparecem conforme o corpo:

- **Países**, **Mares** e **Zonas** só aparecem se houver material daquela
  fase.
- **Biomas** só aparece se houver material sólido.
- **Pontos** e **Terreno** sempre aparecem.

O painel tem dois níveis, a lista ou a ficha do item escolhido, e a seta no
topo da ficha volta para a lista.

Na aba **Terreno**, escolher um material arma a ferramenta com ele e abre o
editor de nome, cor, fase e **textura**: liso, ruído, faixas (para gás) ou
crateras, com segunda cor, intensidade e escala. Excluir um material pede
outro para ficar com os pixels dele.

No fim da aba, **Limpar manchas** some com ilhotas, lagoinhas e pingos de
material menores que um limite (de 16 a 1024 px): cada mancha vira o
material que mais a cerca. A contagem aparece antes de limpar, e dá para
desfazer. Mapas extraídos de imagem costumam trazer dezenas delas, que na
esfera, com a costa ligada, viram pontinhos escuros.

### Guias de latitude

No menu ⋮, **Guias de latitude** marca o equador e as latitudes 30°, 60° e
75°, e escurece as faixas polares. O mapa é equirretangular: cada linha vira
um círculo de latitude, e perto dos polos o desenho é espremido na
horizontal por 1/cos(lat) quando vai para a esfera (2× a 60°, 3,9× a 75°).
Cada linha mostra esse fator. É ali que terra desenhada "plana" vira cunha
no globo.

### Visões

`1` Política, `2` Biomas, `3` Mista (o bioma em hachura sobre a cor do país).
Na ficha de um território, o botão de olho abre o **recorte isolado**, com
exportação em PNG e SVG.

### Globo e sistema

O botão de globo mostra o corpo como esfera, e em volta dele o **sistema**:
num planeta, as luas dele; numa lua, o planeta-mãe e as luas irmãs. As luas
orbitam no plano do equador do planeta, e os vizinhos ficam sempre ao fundo:
nunca tampam o corpo em foco. Clicar num vizinho abre o globo dele, e assim
dá para passear pelo sistema. O botão **Sistema** esconde os vizinhos, e
**Fronteiras** liga as fronteiras e a costa na esfera (desligadas por padrão).

A pele da esfera sai do desenho vetorial do mapa, ampliado até ~16 Mpx e
lido com interpolação bilinear. Costa e fronteiras não são pintadas nela:
os contornos vetoriais são levados para a esfera e riscados direto na tela a
cada quadro, com espessura fixa. Por isso continuam finos e lisos em
qualquer zoom.

O sistema tem **uma disposição só**, medida em raios do planeta. Trocar de
foco só muda o centro da câmera e o zoom. Por isso, se a lua aparece com um
quinto do tamanho do planeta na vista do planeta, na vista da lua o planeta
aparece cinco vezes maior que ela, e na mesma proporção de distância: grande
e no fundo do céu. A roda do mouse afasta a câmera para ver o sistema
inteiro. Vista de uma lua, a órbita anda mais devagar.

A escala real não cabe na tela (a Lua vista da Terra ficaria a 60 raios de
distância). Por isso as distâncias são artísticas e os tamanhos aparentes
são comprimidos: um corpo maior continua maior, e um satélite minúsculo ainda
aparece como um ponto. A textura de cada vizinho é a miniatura do atlas.

### Inclinação do eixo

Na engrenagem do corpo, **Inclinação do eixo** vai de 0° a 180° (há atalhos
para Terra, Saturno e Urano). No globo, a esfera tomba, o giro passa a ser
em volta do eixo inclinado, os anéis tombam junto com o equador, e as órbitas
das luas seguem a inclinação do planeta. O arrasto é lido no referencial do
corpo, para a superfície continuar seguindo o mouse.

### Sentido da rotação

Logo abaixo, **Rotação** escolhe entre **Normal** (anti-horária vista do polo
norte, como a Terra: a superfície anda da esquerda para a direita) e
**Retrógrada** (ao contrário, como Vênus). A prévia mostra o sentido com uma
seta em volta do polo, e o giro automático do globo segue a escolha.

### Anéis

Na engrenagem do corpo, ligue **Anéis** e ajuste onde começam e terminam (em
múltiplos do raio), a opacidade e as duas cores. **Sortear faixas** troca o
desenho das faixas e falhas sem mudar as cores. O gigante gasoso já nasce
com anéis. No globo, a metade de trás do anel passa atrás do planeta, e o
anel inclina junto quando você arrasta para cima ou para baixo.

### Pontos

O país de um ponto **não é um campo**: ele é lido da pintura na coordenada
do ponto. Repintar uma fronteira já troca o dono da cidade. A capital é o
ponto do tipo Capital que estiver dentro do país, e um país pode ter várias.

## Salvar

Enquanto você trabalha, tudo vive em memória no navegador. Há dois lugares de
gravação:

| Onde | Quando | O que vai |
| --- | --- | --- |
| **Rascunho** (IndexedDB do navegador, um por mapa) | sozinho, 4 s depois de cada alteração | fichas e as três camadas |
| **Banco** (Postgres, via API) | **Salvar** (menu ou `Ctrl+S`) | tudo numa transação só, mais a miniatura do atlas |

Cada Salvar envia a `revision` que o editor leu. Se alguém salvou o mesmo
mapa em outro lugar nesse meio-tempo, a API recusa com 409, e o editor
oferece **sobrescrever** ou **descartar e recarregar**. O rascunho guarda a
revisão de origem: se estiver atrasado em relação ao banco, o editor
pergunta antes de restaurá-lo, em vez de atropelar a versão salva.

**Exportar** baixa `world.json` e as três camadas em PNG. **Importar** lê um
`world.json` e troca as fichas, mas não as camadas.

## Estrutura

```
apps/api/src/
  app.ts                  Fastify: multipart, erros, rotas
  bodies/routes.ts        as rotas /api/bodies e /api/terrain/preview
  bodies/repo.ts          leitura, criacao, Salvar transacional, regras de lua
  db/schema.ts            o schema do Drizzle (migracoes em apps/api/drizzle/)
  terrain/extract.ts      imagem -> terra e mar (o antigo prepare:map)
  terrain/codec.ts        camadas <-> PNG (R + G*256)
  terrain/thumbnail.ts    miniatura de um corpo recem-criado
  scripts/                migrate e import-legacy

apps/web/src/
  AppShell.tsx, nav.tsx   menu lateral dos setores (adicione os novos em nav.tsx)
  pages/                  inicio, atlas, novo corpo, editor de mapa
  hooks/useBody.ts        carrega um corpo e as camadas da API
  lib/layers.ts           motor de pintura: estencil por fase, pincel, balde, laco, desfazer
  lib/rings.ts            aneis: faixas sorteadas e as duas metades
  lib/trace.ts            camadas -> contornos vetoriais
  lib/vectorPaint.ts      desenho vetorial (canvas e SVG)
  lib/globe.ts            projecao na esfera
  lib/store.ts            codec PNG no navegador, rascunho, miniatura
  lib/api.ts              cliente da API
  components/             MapView, Sidebar, Toolbar, ToolDock, dialogos...

packages/shared/src/
  domain.ts               tipos do mundo e constantes de fase
  schemas.ts              validacao zod (so a API importa: @valenzia/shared/schemas)
  templates.ts            os modelos de planeta em branco
  area.ts                 area real por pixel, formatacao de km2
  texture.ts              texturas procedurais (ruido, faixas, crateras), usadas no editor e nas miniaturas
```

### Por que a pintura não trava

Repintar milhões de pixels a cada movimento do mouse seria inviável. Cada
traço devolve o retângulo que realmente mudou, e só esse pedaço da textura é
recalculado. Quando a mão para, as camadas viram contornos (`trace.ts`) e o
mapa passa a ser desenhado em vetor, com fronteira e costa afiadas em
qualquer zoom, sobre o chão já pintado com as texturas. Durante o traço,
vale a textura raster, que acompanha a mão em tempo real.
