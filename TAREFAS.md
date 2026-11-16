# Tarefas — Estoque do Mercado

## Feito (v0.1)

- [x] Banco SQLite nativo (sem dependência externa), com WAL e chaves estrangeiras.
- [x] Livro de movimentos: entrada, saída, ajuste e perda.
- [x] Saldo calculado por soma de movimentos, nunca campo editável.
- [x] Custo médio ponderado na entrada.
- [x] Cadastro de produto com EAN, unidade, categoria, mínimo e ponto de pedido.
- [x] Recebimento por código de barras (leitor USB) e por busca de nome.
- [x] Recebimento com fornecedor, documento, vencimento e conta a pagar.
- [x] Alerta de reposição (zerado / baixo / ok).
- [x] Painel de estoque, produtos e movimentos.
- [x] Exportação CSV para o `painel-mercado`.
- [x] Servidor local acessível na rede (tablet/celular).
- [x] Teste do núcleo em `test/run.cjs`.

## Próximo (ordem sugerida)

1. **Importador de NF-e XML** — entrada automática, de-para de produto e idempotência por chave de acesso.
2. **Integração com o PDV** — saber qual é o PDV e se tem API, CSV ou banco local; baixa automática na venda.
3. **Controle por lote (FIFO)** — validade por entrada, não por produto.
4. **Etiqueta interna** — EAN-13 prefixo 2 para hortifruti/padaria e impressão.
5. **Sugestão de compra** — ponto de pedido com giro e lead time.
6. **Usuários e permissões** — operador, gerente, auditoria.
7. **Backup automático** — cópia diária do `estoque.db`.
8. **Conciliação de contagem** — tela de inventário e ajuste em massa.

## Decisões tomadas

- **Saldo é soma de movimentos**, não campo. Auditoria e concorrência.
- **SQLite local**, não nuvem: mercado não pode parar quando a internet cai.
- **Leitor USB como teclado**, sem driver nem integração.
- **Ponto de pedido manda no alerta**, não o mínimo: o mínimo é o limite de segurança, o ponto é quando comprar.
- **Custo médio ponderado** na entrada; o custo da nota é a base.
- **Sem dado pessoal**: o sistema não tem tabela de cliente.
- **Fase 1 não depende de NF-e nem de PDV.** O que dá para usar hoje já está pronto.
