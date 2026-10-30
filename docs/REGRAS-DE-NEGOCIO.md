# Regras de negócio

Este documento descreve como cada número do sistema é calculado. A implementação está em `src/server/services/`
e os cenários estão cobertos por `tests/scenarios.test.ts` e `tests/rules.test.ts`.

## Princípios

1. **Fonte única de verdade.** O saldo de caixa vem do livro-caixa (`financial_transactions`); o estoque vem das
   movimentações (`stock_movements`); o valor pago de uma venda vem dos pagamentos (`payments`). Os campos de
   resumo (`products.current_stock`, `sales.amount_paid`) são atualizados na mesma transação e conferidos pela
   verificação de divergências (alerta no dashboard e no Financeiro).
2. **Nada confirmado é apagado.** Livro-caixa, pagamentos, movimentações de estoque e auditoria são imutáveis
   (triggers no banco bloqueiam `UPDATE`/`DELETE`). Correções geram lançamentos compensatórios.
3. **Operações atômicas.** Venda, pagamento, cancelamento, entrada de estoque e retirada rodam em uma única transação:
   ou tudo é gravado, ou nada.
4. **Sem duplicidade.** Cada formulário envia uma chave de idempotência; repetir o envio devolve o mesmo registro.
   Cada pagamento tem exatamente um lançamento no livro-caixa (restrição única).
5. **Valores exatos.** Dinheiro em `NUMERIC(14,2)` no banco, aritmética decimal no servidor e centavos inteiros no
   navegador. Custos unitários em `NUMERIC(14,4)`.
6. **Datas no fuso do negócio.** Tudo é gravado em UTC; "hoje", "mês atual" e os agrupamentos dos gráficos usam o fuso
   configurado (padrão `America/Sao_Paulo`). Lançamentos com data futura são recusados.

## Estoque

- Entradas, vendas, devoluções e ajustes geram uma movimentação com saldo após a operação.
- O estoque **nunca fica negativo**: a baixa é um `UPDATE` condicional (`estoque >= quantidade`), atômico mesmo com
  vendas simultâneas, e o banco tem `CHECK (current_stock >= 0)`.
- Ajustes manuais exigem justificativa.
- Editar uma venda **não** altera quantidades (o estoque não é baixado de novo). Para mudar produtos ou quantidades,
  cancele e registre outra venda.

### Custo médio ponderado

A cada entrada com custo conhecido:

```
novo custo médio = (saldo atual × custo médio atual + quantidade recebida × custo unitário) ÷ (saldo atual + quantidade recebida)
```

- Se o saldo atual é zero ou não tem custo conhecido, o custo da entrada passa a valer para todo o saldo.
- Entrada **sem custo**: mantém o custo médio vigente se houver saldo; com saldo zero o custo fica desconhecido.
- Ajustes de entrada não alteram o custo médio (unidades valorizadas ao custo vigente).
- Cada item vendido grava o custo médio do momento da venda (`sale_items.unit_cost`). Compras posteriores não mudam o
  lucro de vendas passadas.
- Se o custo não for conhecido, o lucro é marcado como **parcial**. Ao informar o custo depois (Estoque → Informar custo),
  é possível aplicá-lo às vendas que ficaram sem custo (operação auditada).

## Vendas

```
total dos produtos = Σ quantidade × preço unitário        (valor bruto)
total da venda     = total dos produtos − desconto + frete
```

- O preço vem do produto, mas pode ser alterado na venda (o formulário mostra o preço padrão).
- O desconto não pode ser maior que o total dos produtos.
- **Status operacional** (registrada, em preparação, enviada, entregue, cancelada) é independente do
  **status financeiro** (pendente, parcialmente pago, pago, estornado, sem cobrança).
- Vendas não pagas no ato recebem vencimento (padrão: hoje + prazo configurado). Vencidas aparecem como atrasadas.

### Pagamentos

- Uma venda pode ter vários recebimentos; cada um gera uma **entrada** no livro-caixa.
- O valor recebido não pode passar do saldo pendente.
- **Estorno** de recebimento (lançado errado ou devolvido): cria um pagamento do tipo estorno + **saída** compensatória;
  exige motivo; a venda volta a ter saldo pendente.

### Cancelamento

- A venda continua no histórico, marcada como cancelada, com motivo.
- Cada item pode devolver ao estoque todas, parte ou nenhuma das unidades (placas já personalizadas viram **perda**,
  e o custo delas entra no lucro estimado do período do cancelamento).
- Valores recebidos podem ser estornados na hora (saída de caixa) ou ficar como **valor a devolver** (alerta no
  dashboard e botão "Devolver valor ao cliente" na venda).
- Vendas canceladas não entram em faturamento, unidades vendidas nem custo das mercadorias.

## Indicadores

| Indicador           | Definição                                                                                                | Data usada          |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------------- |
| Placas disponíveis  | Σ estoque atual dos produtos ativos                                                                      | posição atual       |
| Placas vendidas     | Σ quantidades das vendas não canceladas                                                                  | data da venda       |
| Valor bruto vendido | Σ quantidade × preço (antes de descontos)                                                                | data da venda       |
| Receita líquida     | Valor bruto − descontos                                                                                  | data da venda       |
| Valores recebidos   | Recebimentos de vendas − estornos (dinheiro que efetivamente entrou)                                     | data do recebimento |
| Saldo disponível    | Saldo inicial + entradas confirmadas − saídas confirmadas                                                | posição atual       |
| Contas a receber    | Σ (total − recebido) das vendas não canceladas                                                           | posição atual       |
| Lucro estimado      | Receita líquida + frete cobrado − custo das placas vendidas − despesas diretas − perdas em cancelamentos | data da venda       |

- **Despesas diretas** são as despesas de categorias marcadas como "custo diretamente atribuído às vendas" (padrão:
  Frete, Embalagens, Taxas de pagamento).
- **Compras de estoque reduzem o caixa, mas não são custo das vendas**: o custo só entra no lucro quando a placa é
  vendida (via custo médio). Isso evita dupla contagem.
- **Retiradas reduzem o caixa, mas não são despesa nem afetam faturamento ou lucro.**
- **Aportes de capital aumentam o caixa, mas não são receita.**
- Estornos de lançamentos reduzem o grupo do lançamento original (uma despesa estornada deixa de contar como despesa).
- Comparação com o período anterior: mesmo número de dias imediatamente antes; para "Mês atual" e "Ano atual", o
  mesmo trecho do mês/ano anterior.

## Retiradas

- Mostram saldo atual, valor e saldo restante antes da confirmação.
- **Não podem deixar o saldo negativo.** Exceção opcional (Configurações): permitir saldo negativo mediante justificativa
  registrada.
- A conta de caixa é bloqueada durante a retirada: duas retiradas simultâneas não ultrapassam o saldo.
- Categorias separam **retirada pessoal**, **distribuição de lucros**, **reembolso** e outras (configuráveis).
- Retirada registrada por engano é **estornada** (entrada compensatória + motivo), nunca apagada.
- O "saldo após" exibido é o saldo no momento do registro.

## Saldo inicial

- Definido na configuração inicial. Alterações posteriores exigem motivo e ficam no histórico (Configurações → Caixa),
  com valor anterior e novo.

## Clientes

- Duplicidades evidentes são bloqueadas: mesmo CNPJ, e-mail ou telefone de outro cliente.
- Cliente com vendas não pode ser excluído, apenas desativado (o histórico é preservado). Desativados não aparecem no
  formulário de venda.

## QR codes dinâmicos

O QR impresso na placa guarda só um endereço fixo, `{domínio}/q/{código}`. O destino fica no banco e pode ser
cadastrado ou trocado a qualquer momento, sem reimprimir (serviço em `src/server/services/qr-codes.ts`, testes em
`tests/qr-codes.test.ts`).

- **Lotes.** QR codes são gerados em lotes de até 500, já sem link. Cada código tem 6 caracteres aleatórios de um
  alfabeto sem ambiguidades (sem 0/O e 1/I/L), é único no sistema e tem uma posição no lote (ordem de impressão).
- **Endereço impresso.** Configurado em QR codes → "Endereço dos QR codes" (só o domínio, ex.:
  `https://suaplaca.com.br`). Sem configuração, vale o endereço atual do painel. Trocar o domínio depois de imprimir
  faz as placas antigas pararem de funcionar, a menos que o domínio antigo continue apontando para o sistema.
- **Link.** Só endereços `http(s)` (validado no servidor e por CHECK no banco). Link em branco desativa o QR code.
  Cliente e identificação ("Balcão", "Mesa 3") são opcionais; ao escolher um cliente com link de avaliações, ele é
  sugerido como destino. Excluir o cliente mantém o link e só desfaz o vínculo.
- **Leitura.** `/q/{código}` é público. Com link, responde `302` (sem cache, para que a troca valha na próxima leitura) e
  soma uma leitura. Sem link, abre a página de ativação: o público vê "ainda não foi ativado"; quem está logado com
  permissão cadastra o link ali mesmo (útil para ativar escaneando a placa com o celular).
- **Impressão.** Folha A4 por lote ou por código avulso, em tamanho real (2 a 6 cm), com guias de corte e o código
  escrito embaixo. Também é possível baixar cada QR code em SVG para usar na arte da placa. Os QR codes são desenhados
  no navegador, nunca no servidor (veja o limite de CPU em [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)).
- Geração de lote, cadastro, troca e remoção de link e mudança do domínio são auditados.

## Link de avaliação do Google

Menu "Gerar link": a partir do nome do negócio e do link dele no Google Maps, gera o link que abre direto a tela de
avaliar, `https://search.google.com/local/writereview?placeid={Place ID}` (serviço em
`src/server/services/review-links.ts`, conversão em `src/lib/google-review.ts`, testes em `tests/review-links.test.ts`).

- **Sem API paga.** O endereço de um lugar no Google Maps traz o _feature id_ do negócio (`!1s0x…:0x…` ou
  `ftid=0x…:0x…`); o Place ID "ChIJ…" é esse mesmo par em protobuf/base64url. Também são aceitos endereços com
  `placeid`, `place_id` ou `query_place_id`, links de avaliação prontos e o link `g.page/r/…/review` do Perfil da
  Empresa. O formato não é documentado pelo Google: se mudar, o gerador avisa que não encontrou o negócio.
- **Links curtos** (`maps.app.goo.gl`, `goo.gl`, `g.co`, `g.page`, `share.google`): o servidor segue os
  redirecionamentos (até 6, com tempo limite) e só abre endereços desses domínios do Google. Links de busca ou de área
  do mapa, sem um negócio selecionado, são recusados com instruções.
- **Links da Busca do Google** (`share.google/…`, compartilhados pela pesquisa): levam a uma página de resultados que
  só traz a identificação da Busca (`kgmid`), não o lugar do Maps, e essa página só abre num navegador. Sem a API paga
  do Google não há como converter: a tela reconhece o caso, mostra o nome pesquisado e oferece abrir o negócio no
  Google Maps (`maps/search/?api=1&query=…`) para copiar o link certo. Nada é gravado no histórico.
- **Histórico.** Cada link gerado fica guardado com o nome do negócio; gerar de novo o mesmo lugar atualiza o registro
  em vez de duplicar. Excluir do histórico não afeta placas e QR codes que já usam o link. Geração, atualização e
  exclusão são auditadas.

## Agenda de retornos

Menu "Agenda de Retornos": quando voltar a falar com um cliente ou potencial cliente (visita, ligação, WhatsApp,
proposta…). Serviço em `src/server/services/follow-ups.ts`, testes em `tests/follow-ups.test.ts`.

- **Cliente.** Cada retorno é de um cliente cadastrado ou de um potencial cliente novo, cadastrado pela própria agenda
  no cadastro de clientes, sem exigir venda. Nome do estabelecimento igual (sem diferenciar maiúsculas) ou telefone,
  e-mail ou CNPJ já cadastrados são recusados com o nome do cliente existente. Assim nada é duplicado. Responsável e
  telefone são copiados para o retorno e podem ser editados sem alterar o cadastro do cliente. Um cliente pode ter
  quantos retornos forem necessários.
- **Data e horário** no fuso do negócio (padrão `America/Sao_Paulo`), gravados em UTC. O horário é opcional.
- **Status.** "Agendado" é o único pendente. Resultado (realizado, não conseguiu contato, sem interesse, venda
  realizada), reagendamento e cancelamento encerram o retorno e preenchem a data de conclusão. O banco garante essa
  coerência por CHECK: um retorno concluído nunca volta a aparecer como pendente.
- **Atrasado** é o retorno pendente com data anterior a hoje. Continua visível (lista, Hoje, dashboard) até ser
  resolvido.
- **Reagendar** não apaga nada: o retorno atual fica como "Reagendado", com a data antiga, e um novo retorno é criado
  na nova data, ligado ao anterior (`previous_id`). Em um retorno já resolvido, "Agendar próximo retorno" cria o
  próximo sem mexer no resultado. Ao registrar o resultado também dá para já agendar o próximo contato.
- **Venda realizada** não cria venda: a tela oferece um atalho para abrir o formulário de venda.
- **Histórico.** Criação, edições (com os campos alterados), resultados, reagendamentos e cancelamentos ficam em
  `follow_up_events`, imutável (trigger). Retornos não podem ser apagados (trigger). Tudo também vai para a
  auditoria.
- **Indicadores.** Hoje = pendentes com data de hoje. Próximos = pendentes a partir de amanhã. Atrasados = pendentes
  com data passada. Concluídos = resolvidos (realizado, sem contato, sem interesse, venda) no período escolhido.
- **Precisam de novo contato.** O último retorno do cliente terminou como "realizado" ou "não conseguiu contato", não
  há retorno pendente e não houve venda depois. Aparece na agenda e na ficha do cliente.
- **Integrações.** A ficha do cliente tem "Próximo contato" e a aba "Histórico de contatos", com "Agendar novo
  retorno" já preenchido. A lista de clientes mostra o próximo retorno e filtra por "com / sem retorno agendado". O
  dashboard tem um resumo compacto dos próximos retornos. O menu "Lançar" tem "Agendar retorno".
- **WhatsApp e ligação** usam o telefone cadastrado, com código do país (55) para números brasileiros. Sem telefone,
  nenhum botão aparece.
