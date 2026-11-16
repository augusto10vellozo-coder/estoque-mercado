# Estoque do Mercado

Núcleo operacional de estoque para mercado pequeno. Roda no PC da loja, abre no navegador e funciona na rede local (PC, tablet, celular). Sem internet, sem nuvem, sem mensalidade.

O `painel-mercado` continua sendo a camada de relatório; este projeto é o **sistema que escreve** os dados.

## Como rodar

```bash
node seed.cjs      # cria o catálogo de exemplo (43 produtos)
node server.cjs    # sobe em http://localhost:3000
```

Ou dê duplo clique em `iniciar.cmd`.

O console mostra o IP para abrir no tablet/celular da loja:

```
PC:     http://localhost:3000
Tablet: http://192.168.0.10:3000
```

## O que já funciona

| Tela | O que faz |
|---|---|
| **Estoque** | saldo por produto, valor em estoque, status (ok / baixo / zerado), alerta de reposição |
| **Receber** | entrada por código de barras (leitor USB), busca por nome, fornecedor, documento, vencimento e conta a pagar |
| **Produtos** | cadastro e edição (EAN, unidade, categoria, mínimo, ponto de pedido, custo) |
| **Movimentos** | livro de entradas, saídas, ajustes e perdas, com origem e observação |

### Recebimento por código de barras

1. Abra a aba **Receber**.
2. Bipe o produto. O leitor USB funciona como teclado: digita o código e dá Enter.
3. O produto entra no carrinho com quantidade 1 e o último custo.
4. Ajuste quantidade e custo, informe o fornecedor e confirme.

Se o código não existir, o sistema abre o cadastro com o EAN preenchido. Ao salvar, o produto volta para o carrinho.

### Estoque mínimo e ponto de pedido

O status usa o **ponto de pedido** quando ele existe; senão, o estoque mínimo:

```
saldo <= 0            → zerado
saldo <= ponto_pedido → baixo (hora de repor)
saldo > ponto_pedido  → ok
```

O ponto de pedido é sugerido como `mínimo × 1,5`, mas pode ser editado por produto.

## Como o saldo é calculado

O saldo **não é um campo editável**. É a soma dos movimentos:

```
saldo = SUM(movimentos.quantidade)
```

- entrada soma
- saída e perda subtraem
- ajuste corrige

Isso dá auditoria (dá para ver quem mexeu, quando e por quê) e evita perder atualização quando duas pessoas usam ao mesmo tempo.

O **custo médio** é ponderado na entrada:

```
novo_custo = (saldo_atual × custo_atual + qtd_entrada × custo_entrada) / (saldo_atual + qtd_entrada)
```

## Exportar para o painel

O botão **Exportar** baixa `estoque.csv` no formato que o `painel-mercado` lê. Também há:

- `GET /api/export/estoque.csv`
- `GET /api/export/contas.csv`

## API (para a próxima fase)

| Método | Rota | Para quê |
|---|---|---|
| GET | `/api/dashboard` | KPIs e alertas |
| GET | `/api/produtos?busca=&ean=` | listar ou buscar por código |
| POST | `/api/produtos` | criar produto |
| PUT | `/api/produtos/:id` | editar produto |
| GET | `/api/movimentos?produto_id=` | livro de movimentos |
| POST | `/api/movimentos` | ajuste, perda ou saída avulsa |
| POST | `/api/compras` | recebimento completo |
| GET | `/api/fornecedores` | listar fornecedores |
| GET | `/api/export/estoque.csv` | exportar para o painel |

A rota `POST /api/movimentos` já aceita `tipo: "saida"` com quantidade negativa — é por ela que o PDV vai dar baixa quando a integração existir.

## Limites conhecidos (fase 1)

- **Ainda não lê NF-e.** O próximo passo é o importador de XML; por enquanto a entrada é manual ou por código de barras.
- **Ainda não integra com o PDV.** A baixa automática depende de saber qual é o PDV e se ele tem API, exportação ou banco local.
- **Validade é por produto, não por lote.** O alerta usa a validade mais próxima cadastrada na entrada. Controle por lote (FIFO) entra com a integração de venda.
- **Um usuário por vez no caixa.** O SQLite aguenta leitura concorrente, mas a escrita é serializada. Para várias lojas, o caminho é nuvem.
- **Backup é manual.** Copie `dados/estoque.db` com o sistema parado. Automatizar o backup é a próxima tarefa de infraestrutura.

## Teste

```bash
node test/run.cjs
```

Cobre saldo, custo médio ponderado, status, dashboard, EAN duplicado e exportação.
