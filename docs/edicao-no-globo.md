# Estudo: editar direto no globo

Hoje o globo só serve para ver. A pintura acontece no mapa plano, que é equirretangular: perto dos polos o desenho é espremido na horizontal (1/cos da latitude) quando vai para a esfera. Por isso é difícil desenhar uma calota polar ou uma ilha perto do polo e prever como ela vai ficar.

Este documento avalia se dá para pintar direto na esfera, o que já existe para isso e o que falta.

## Conclusão

**É viável, e reaproveita a maior parte do que já existe.** O tamanho é parecido com o da etapa de projeção Mercator.

A peça-chave é que a esfera pinta **nos mesmos arrays** do editor (`base.terrain`, `layers.territory`, `layers.biome`), anotando no mesmo `Journal`. Por isso tudo o que vem depois da pincelada funciona sem mudança:
- desfazer;
- estêncil por fase (país só no sólido, mar só no líquido…);
- `reconcileTerrain`;
- estatísticas de km²;
- rascunho;
- Salvar.

Só muda **onde** cada carimbo cai no mapa.

## O que já existe

| Peça | Onde |
|---|---|
| Tela → longitude e latitude | `unproject` em `apps/web/src/lib/globe.ts` |
| Longitude e latitude → pixel do mapa | `lonLatOf` (e o inverso) em `lib/globe.ts` |
| Projetar um ponto da esfera na tela, com inclinação | `projectPoint` em `lib/globe.ts`, `strokeOnSphere` em `lib/globeLines.ts` |
| Composição de cores num retângulo, direto num buffer RGBA | `composeInto` em `lib/layers.ts` |
| Estêncil, journal, desfazer, reconcile | `lib/layers.ts` e `pages/MapEditor.tsx` |
| Contornos vetoriais refeitos depois do traço | `staleRef` e `traceLayer` em `components/MapView.tsx` |

## O que falta

### 1. Pincel esférico

Função nova: `stampSphericalDisc(layer, W, H, lon0, lat0, ρ, value, stencil, journal)`.

- **Raio:** o disco tem raio **angular** ρ = raio do pincel na tela ÷ raio do globo na tela. Assim o pincel tem o mesmo tamanho aparente em qualquer zoom.
- **Linhas pintadas:** para cada linha do mapa entre `lat0 − ρ` e `lat0 + ρ`, a meia-largura em longitude é `Δλ = acos((cos ρ − sin φ · sin φ0) / (cos φ · cos φ0))`.
  - Se o argumento passa de 1 em módulo, o disco contém o polo naquela linha, e a linha inteira é pintada.
  - Se o trecho passa do antimeridiano (x < 0 ou x ≥ W), ele é partido em dois.
- **Traço:** entre dois pontos do mouse, o traço anda por **grande círculo** (interpolação esférica) e carimba a cada ρ/2.
- **Polo:** perto dele, o pincel pinta naturalmente uma faixa larga no mapa plano. É exatamente o que o mapa plano não consegue fazer bem.
- **Desempenho:** o custo é o mesmo do `stampDisc` de hoje, com uma conta de `acos` por linha.

### 2. Laço

- **Desenho:** o polígono é desenhado na tela, só no hemisfério visível.
- **Pixels candidatos:** são os da caixa do laço em latitude e longitude. Se o laço contém o polo, a caixa se estende até ele em todas as longitudes.
- **Teste:** para cada candidato, o centro do pixel é projetado com a rotação atual (a mesma conta do `strokeOnSphere`), e o ponto-em-polígono é feito na tela.
- **Horizonte:** perto da borda do globo a área é muito comprimida, e um pixel de laço cobre muito chão. Só são aceitos pontos com `nz > 0,15`, ou seja, um pouco para dentro do horizonte.

### 3. Balde

- É o `bucketFill` de hoje, mais uma opção de **dar a volta no antimeridiano**: x = 0 passa a ser vizinho de x = W − 1.
- A mesma opção corrige o balde do mapa plano, que hoje para na emenda lateral.
- Nos polos, a linha de cima inteira é um ponto só. Para o balde, vale tratar a primeira linha como toda conectada entre si (e a última também).

### 4. Prévia ao vivo

Refazer a textura vetorial do globo (até ~16 Mpx) a cada pincelada é inviável. No **modo edição**:
- a textura do globo passa a ser o composto **raster** no tamanho do mapa;
- cada carimbo recompõe **só o retângulo sujo**, direto no `Texture.data`, com o `composeInto`;
- o globo é redesenhado em meia resolução enquanto o mouse se move, como já acontece no giro;
- costa e fronteiras vetoriais somem durante o traço e voltam quando os contornos forem retraçados (o mesmo `staleRef` do mapa plano);
- ao sair do modo edição, a textura vetorial volta.

### 5. Interação e layout

- **Ferramentas:** a barra do globo ganha Girar, Pincel, Borracha, Laço e Balde, com os mesmos atalhos do plano: B, E, L, G…
- **Girar com uma ferramenta ativa:** com uma ferramenta de pintura armada, o arrasto pinta. **Espaço + arrasto** ou o **botão direito** giram o globo.
- **Painel lateral:** o que está armado (material, país ou bioma) precisa continuar visível ao lado do globo. Hoje o globo cobre a área toda do mapa, então o overlay passa a respeitar o painel.
- **Cursor:** o círculo do pincel é desenhado projetado na esfera, como uma elipse perto da borda. Assim se vê onde vai pegar.

## Riscos

| Risco | Mitigação |
|---|---|
| Recompor e redesenhar a cada carimbo pesa em mapas de 4096 px | meia resolução no traço; recompor só o retângulo sujo |
| O laço perto do horizonte cobre área demais com pouco movimento | aceitar só pontos com `nz > 0,15` |
| A textura do globo e o mapa plano ficam fora de sincronia | os dois leem os mesmos arrays; o plano é repintado ao fechar o globo, como depois de qualquer traço |
| Confusão entre girar e pintar | Girar como ferramenta padrão; cursor diferente por ferramenta |

## Ordem sugerida

1. **Pincel e borracha** esféricos, com desfazer e prévia ao vivo. Isso já resolve calotas e ilhas polares.
2. **Laço** esférico.
3. **Balde** com volta no antimeridiano e nos polos, valendo também no plano.
