#!/usr/bin/env node
'use strict';

/**
 * Cria a base inicial com o catálogo de exemplo.
 * Idempotente: se já houver produto, não faz nada.
 *
 *   node seed.cjs
 */

const path = require('path');
const { abrir, criarProduto, listarProdutos } = require('./db.cjs');

const db = abrir(path.join(__dirname, 'dados', 'estoque.db'));

if (listarProdutos(db).length) {
  console.log('Base já tem produtos. Nada a fazer.');
  process.exit(0);
}

// [nome, categoria, unidade, custo, estoque mínimo, código interno?]
const PRODUTOS = [
  ['Arroz Branco 5kg', 'Mercearia', 'un', 18.90, 12, false],
  ['Feijão Carioca 1kg', 'Mercearia', 'un', 6.20, 20, false],
  ['Óleo de Soja 900ml', 'Mercearia', 'un', 5.80, 18, false],
  ['Açúcar Refinado 1kg', 'Mercearia', 'un', 3.40, 20, false],
  ['Café Torrado 500g', 'Mercearia', 'un', 14.50, 10, false],
  ['Macarrão Espaguete 500g', 'Mercearia', 'un', 3.10, 15, false],
  ['Farinha de Trigo 1kg', 'Mercearia', 'un', 4.20, 10, false],
  ['Sal Refinado 1kg', 'Mercearia', 'un', 1.80, 10, false],
  ['Molho de Tomate 340g', 'Mercearia', 'un', 2.90, 15, false],
  ['Leite Integral 1L', 'Mercearia', 'un', 4.10, 24, false],
  ['Achocolatado 400g', 'Mercearia', 'un', 6.80, 8, false],
  ['Biscoito Recheado', 'Mercearia', 'un', 2.20, 20, false],

  ['Refrigerante Cola 2L', 'Bebidas', 'un', 6.40, 12, false],
  ['Cerveja Lata 350ml', 'Bebidas', 'un', 2.30, 24, false],
  ['Água Mineral 1,5L', 'Bebidas', 'un', 1.10, 24, false],
  ['Suco de Uva 1L', 'Bebidas', 'un', 5.20, 8, false],
  ['Energético 250ml', 'Bebidas', 'un', 4.80, 6, false],
  ['Cerveja Long Neck', 'Bebidas', 'un', 3.10, 12, false],

  ['Detergente 500ml', 'Limpeza', 'un', 2.10, 12, false],
  ['Sabão em Pó 1kg', 'Limpeza', 'un', 8.40, 8, false],
  ['Água Sanitária 2L', 'Limpeza', 'un', 3.20, 10, false],
  ['Desinfetante 1L', 'Limpeza', 'un', 3.80, 10, false],
  ['Papel Higiênico 12un', 'Limpeza', 'un', 11.90, 6, false],
  ['Sabonete 90g', 'Limpeza', 'un', 1.40, 20, false],

  ['Queijo Mussarela kg', 'Frios', 'kg', 28.00, 4, false],
  ['Presunto Fatiado kg', 'Frios', 'kg', 24.00, 4, false],
  ['Mortadela kg', 'Frios', 'kg', 16.00, 4, false],
  ['Iogurte Natural 170g', 'Frios', 'un', 2.40, 12, false],
  ['Manteiga 200g', 'Frios', 'un', 7.80, 6, false],

  ['Banana Prata kg', 'Hortifruti', 'kg', 3.20, 8, true],
  ['Tomate kg', 'Hortifruti', 'kg', 4.10, 8, true],
  ['Cebola kg', 'Hortifruti', 'kg', 2.80, 8, true],
  ['Batata kg', 'Hortifruti', 'kg', 3.40, 10, true],
  ['Alface Unidade', 'Hortifruti', 'un', 1.60, 10, true],
  ['Laranja kg', 'Hortifruti', 'kg', 2.90, 8, true],

  ['Pão Francês kg', 'Padaria', 'kg', 7.50, 6, true],
  ['Pão de Forma 500g', 'Padaria', 'un', 5.40, 8, false],
  ['Bolacha Maria 400g', 'Padaria', 'un', 3.60, 10, false],
  ['Bolo de Cenoura', 'Padaria', 'un', 8.00, 4, true],

  ['Frango Inteiro kg', 'Carnes', 'kg', 9.80, 8, true],
  ['Carne Moída kg', 'Carnes', 'kg', 22.00, 6, true],
  ['Linguiça Toscana kg', 'Carnes', 'kg', 16.50, 6, true],
  ['Peito de Frango kg', 'Carnes', 'kg', 12.90, 8, true],
];

function ean13(base12) {
  const nums = String(base12).split('').map(Number);
  const soma = nums.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  const dv = (10 - (soma % 10)) % 10;
  return `${base12}${dv}`;
}

let criados = 0;
PRODUTOS.forEach(([nome, categoria, unidade, custo, minimo, interno], i) => {
  const base12 = interno
    ? `2${10000000000 + i}`
    : `789${100000000 + i}`;
  criarProduto(db, {
    ean: ean13(base12),
    nome,
    categoria,
    unidade,
    custo_medio: custo,
    estoque_minimo: minimo,
    ponto_pedido: Math.ceil(minimo * 1.5),
  });
  criados++;
});

console.log(`${criados} produtos criados em dados/estoque.db`);
console.log('Para abrir: node server.cjs');
