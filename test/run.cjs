'use strict';

/** Teste do núcleo: saldo, custo médio, status e validações. */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dbmod = require('../db.cjs');

const arquivo = path.join(os.tmpdir(), `estoque-test-${process.pid}.db`);
try { fs.unlinkSync(arquivo); } catch {}

const db = dbmod.abrir(arquivo);

// cadastro
const a = dbmod.criarProduto(db, { ean: '111', nome: 'Produto A', unidade: 'un', estoque_minimo: 10, custo_medio: 10 });
const b = dbmod.criarProduto(db, { ean: '222', nome: 'Produto B', unidade: 'kg', estoque_minimo: 5, custo_medio: 5 });

assert.strictEqual(a.saldo, 0, 'produto novo começa zerado');
assert.strictEqual(a.status, 'zerado');

// compra: A 20 @ 12, B 10 @ 6
const compra = dbmod.registrarCompra(db, {
  fornecedor_nome: 'Fornecedor Teste',
  data: '2026-11-05',
  documento: 'NF 1',
  vencimento: '2026-11-20',
  itens: [
    { produto_id: a.id, quantidade: 20, custo_unitario: 12 },
    { produto_id: b.id, quantidade: 10, custo_unitario: 6 },
  ],
});

assert.strictEqual(compra.total, 300, 'total da compra deve ser 300');
assert.strictEqual(dbmod.obterProduto(db, a.id).saldo, 20, 'A deve ter saldo 20');
assert.strictEqual(dbmod.obterProduto(db, a.id).custo_medio, 12, 'custo médio de A deve ser 12');
assert.strictEqual(dbmod.obterProduto(db, b.id).saldo, 10, 'B deve ter saldo 10');
assert.strictEqual(dbmod.obterProduto(db, a.id).status, 'ok', 'A acima do ponto');

// segunda compra de A a 18: custo médio ponderado
dbmod.registrarCompra(db, {
  data: '2026-11-06',
  itens: [{ produto_id: a.id, quantidade: 10, custo_unitario: 18 }],
});
// (20*12 + 10*18) / 30 = 14
assert.strictEqual(dbmod.obterProduto(db, a.id).saldo, 30);
assert.strictEqual(dbmod.obterProduto(db, a.id).custo_medio, 14, 'custo ponderado deve ser 14');

// saída de 20: saldo 10, no ponto de pedido (min 10 * 1.5 = 15) => baixo
dbmod.registrarMovimento(db, { produto_id: a.id, tipo: 'saida', quantidade: 20, origem: 'pdv' });
const apos = dbmod.obterProduto(db, a.id);
assert.strictEqual(apos.saldo, 10);
assert.strictEqual(apos.status, 'baixo', 'saldo 10 está no ponto de pedido');

// perda total de B: saldo 0 => zerado
dbmod.registrarMovimento(db, { produto_id: b.id, tipo: 'perda', quantidade: 10, observacao: 'quebra' });
assert.strictEqual(dbmod.obterProduto(db, b.id).saldo, 0);
assert.strictEqual(dbmod.obterProduto(db, b.id).status, 'zerado');

// dashboard
const d = dbmod.dashboard(db);
assert.strictEqual(d.produtos, 2);
assert.strictEqual(d.zerados, 1);
assert.strictEqual(d.abaixo_minimo, 2, 'A baixo e B zerado');
assert.strictEqual(d.valor_estoque, 140, '10 unidades de A a 14');

// EAN duplicado
assert.throws(() => dbmod.criarProduto(db, { ean: '111', nome: 'Duplicado' }), /já cadastrado/);

// busca por EAN
assert.strictEqual(dbmod.buscarPorEan(db, '111').nome, 'Produto A');
assert.strictEqual(dbmod.buscarPorEan(db, '999'), null);

// movimentos
const movs = dbmod.listarMovimentos(db, { produto_id: a.id });
assert.strictEqual(movs.length, 3, 'A tem 3 movimentos');

// exportação
const csv = dbmod.exportarEstoqueCsv(db);
assert(csv.startsWith('Codigo;Produto;Categoria;Quantidade;CustoUnitario;Validade'));
assert(csv.includes('Produto A'));

db.close();
try { fs.unlinkSync(arquivo); } catch {}
try { fs.unlinkSync(arquivo + '-wal'); } catch {}
try { fs.unlinkSync(arquivo + '-shm'); } catch {}

console.log('OK — saldo, custo médio, status, dashboard e exportação');
