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
