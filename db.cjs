'use strict';

/**
 * Núcleo de estoque — SQLite nativo do Node (sem dependência externa).
 *
 * O saldo NUNCA é um campo editável: é a soma dos movimentos.
 * Entrada soma, saída/perda subtrai, ajuste corrige. Isso dá auditoria e evita
 * perder atualização quando duas pessoas mexem no mesmo produto.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const hoje = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const agora = () => new Date().toISOString();

const round = (n, casas = 4) => {
  const f = 10 ** casas;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

function abrir(caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  criarSchema(db);
  return db;
}

function criarSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ean TEXT UNIQUE,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'un',
      categoria TEXT NOT NULL DEFAULT 'Geral',
      custo_medio REAL NOT NULL DEFAULT 0,
      estoque_minimo REAL NOT NULL DEFAULT 0,
      ponto_pedido REAL,
      validade TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fornecedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cnpj TEXT,
      criado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornecedor_id INTEGER REFERENCES fornecedores(id),
      data TEXT NOT NULL,
      documento TEXT,
      chave_nfe TEXT UNIQUE,
      total REAL NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compra_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      quantidade REAL NOT NULL,
      custo_unitario REAL NOT NULL,
      total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida','ajuste','perda')),
      quantidade REAL NOT NULL,
      custo_unitario REAL,
      origem TEXT NOT NULL DEFAULT 'manual',
      origem_id INTEGER,
      data TEXT NOT NULL,
      usuario TEXT NOT NULL DEFAULT 'operador',
      observacao TEXT,
      criado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornecedor_id INTEGER REFERENCES fornecedores(id),
      compra_id INTEGER REFERENCES compras(id),
      vencimento TEXT NOT NULL,
      valor REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'aberta',
      criado_em TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentos(produto_id);
    CREATE INDEX IF NOT EXISTS idx_prod_ean ON produtos(ean);
    CREATE INDEX IF NOT EXISTS idx_compra_chave ON compras(chave_nfe);
  `);
}

const saldoSql = `
  SELECT COALESCE(SUM(quantidade), 0) AS saldo
  FROM movimentos WHERE produto_id = ?
`;

function saldo(db, produtoId) {
  const r = db.prepare(saldoSql).get(produtoId);
  return round(r?.saldo || 0);
}

function statusDe(produto, saldoAtual) {
  const limite = produto.ponto_pedido != null ? produto.ponto_pedido : produto.estoque_minimo;
  if (saldoAtual <= 0) return 'zerado';
  if (limite > 0 && saldoAtual <= limite) return 'baixo';
  return 'ok';
}

function listarProdutos(db, { busca = '' } = {}) {
  const filtro = busca ? 'AND (p.nome LIKE ? OR p.ean LIKE ?)' : '';
  const params = busca ? [`%${busca}%`, `%${busca}%`] : [];
  const rows = db.prepare(`
    SELECT p.*, COALESCE(SUM(m.quantidade), 0) AS saldo
    FROM produtos p
    LEFT JOIN movimentos m ON m.produto_id = p.id
    WHERE p.ativo = 1 ${filtro}
    GROUP BY p.id
    ORDER BY p.nome COLLATE NOCASE
  `).all(...params);

  return rows.map(p => ({
    ...p,
    saldo: round(p.saldo),
    status: statusDe(p, round(p.saldo)),
    valor_estoque: round(Math.max(0, p.saldo) * p.custo_medio, 2),
  }));
}

function buscarPorEan(db, ean) {
  const p = db.prepare('SELECT * FROM produtos WHERE ean = ? AND ativo = 1').get(String(ean));
  if (!p) return null;
  const s = saldo(db, p.id);
  return { ...p, saldo: s, status: statusDe(p, s) };
}

function obterProduto(db, id) {
  const p = db.prepare('SELECT * FROM produtos WHERE id = ?').get(id);
  if (!p) return null;
  const s = saldo(db, p.id);
  return { ...p, saldo: s, status: statusDe(p, s) };
}

function criarProduto(db, dados) {
  const ean = dados.ean ? String(dados.ean).trim() : null;
  if (ean) {
    const existe = db.prepare('SELECT id FROM produtos WHERE ean = ?').get(ean);
    if (existe) {
      const erro = new Error(`EAN ${ean} já cadastrado no produto #${existe.id}`);
      erro.status = 409;
      throw erro;
    }
  }

  const info = db.prepare(`
    INSERT INTO produtos (ean, nome, unidade, categoria, custo_medio, estoque_minimo, ponto_pedido, validade, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ean,
    String(dados.nome || '').trim(),
    String(dados.unidade || 'un').trim(),
    String(dados.categoria || 'Geral').trim(),
    Number(dados.custo_medio) || 0,
    Number(dados.estoque_minimo) || 0,
    dados.ponto_pedido != null && dados.ponto_pedido !== '' ? Number(dados.ponto_pedido) : null,
    dados.validade || null,
    agora(), agora()
  );

  return obterProduto(db, Number(info.lastInsertRowid));
}

function atualizarProduto(db, id, dados) {
  const atual = obterProduto(db, id);
  if (!atual) {
    const erro = new Error('Produto não encontrado');
    erro.status = 404;
    throw erro;
  }

  const ean = dados.ean !== undefined ? (dados.ean ? String(dados.ean).trim() : null) : atual.ean;
  if (ean) {
    const outro = db.prepare('SELECT id FROM produtos WHERE ean = ? AND id <> ?').get(ean, id);
    if (outro) {
      const erro = new Error(`EAN ${ean} já cadastrado no produto #${outro.id}`);
      erro.status = 409;
      throw erro;
    }
  }

  db.prepare(`
    UPDATE produtos SET
      ean = ?, nome = ?, unidade = ?, categoria = ?, custo_medio = ?,
      estoque_minimo = ?, ponto_pedido = ?, validade = ?, ativo = ?, atualizado_em = ?
    WHERE id = ?
  `).run(
    ean,
    dados.nome !== undefined ? String(dados.nome).trim() : atual.nome,
    dados.unidade !== undefined ? String(dados.unidade).trim() : atual.unidade,
    dados.categoria !== undefined ? String(dados.categoria).trim() : atual.categoria,
    dados.custo_medio !== undefined ? Number(dados.custo_medio) || 0 : atual.custo_medio,
    dados.estoque_minimo !== undefined ? Number(dados.estoque_minimo) || 0 : atual.estoque_minimo,
    dados.ponto_pedido !== undefined ? (dados.ponto_pedido === '' || dados.ponto_pedido == null ? null : Number(dados.ponto_pedido)) : atual.ponto_pedido,
    dados.validade !== undefined ? (dados.validade || null) : atual.validade,
    dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
    agora(),
    id
  );

  return obterProduto(db, id);
}

function registrarMovimento(db, dados) {
  const produto = obterProduto(db, dados.produto_id);
  if (!produto) {
    const erro = new Error('Produto não encontrado');
    erro.status = 404;
    throw erro;
  }

  const tipo = String(dados.tipo || 'ajuste');
  if (!['entrada', 'saida', 'ajuste', 'perda'].includes(tipo)) {
    const erro = new Error('Tipo inválido');
    erro.status = 400;
    throw erro;
  }

  let qtd = Number(dados.quantidade);
  if (!Number.isFinite(qtd) || qtd === 0) {
    const erro = new Error('Quantidade inválida');
    erro.status = 400;
    throw erro;
  }
  // saída e perda sempre negativas; entrada sempre positiva
  if ((tipo === 'saida' || tipo === 'perda') && qtd > 0) qtd = -qtd;
  if (tipo === 'entrada' && qtd < 0) qtd = -qtd;

  const info = db.prepare(`
    INSERT INTO movimentos (produto_id, tipo, quantidade, custo_unitario, origem, origem_id, data, usuario, observacao, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dados.produto_id,
    tipo,
    qtd,
    dados.custo_unitario != null ? Number(dados.custo_unitario) : null,
    String(dados.origem || 'manual'),
    dados.origem_id ?? null,
    dados.data || hoje(),
    String(dados.usuario || 'operador'),
    dados.observacao || null,
    agora()
  );

  return db.prepare('SELECT * FROM movimentos WHERE id = ?').get(Number(info.lastInsertRowid));
}

function obterOuCriarFornecedor(db, { fornecedor_id, fornecedor_nome, cnpj } = {}) {
  if (fornecedor_id) {
    const f = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(fornecedor_id);
    if (!f) {
      const erro = new Error('Fornecedor não encontrado');
      erro.status = 404;
      throw erro;
    }
    return f;
  }
  const nome = String(fornecedor_nome || '').trim();
  if (!nome) return null;
  const existente = db.prepare('SELECT * FROM fornecedores WHERE nome = ? COLLATE NOCASE').get(nome);
  if (existente) return existente;
  const info = db.prepare('INSERT INTO fornecedores (nome, cnpj, criado_em) VALUES (?, ?, ?)')
    .run(nome, cnpj || null, agora());
  return db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(Number(info.lastInsertRowid));
}

/**
 * Registra uma compra inteira numa transação:
 * compra + itens + movimento de entrada + custo médio ponderado + conta a pagar.
 */
function registrarCompra(db, dados) {
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) {
    const erro = new Error('Compra sem itens');
    erro.status = 400;
    throw erro;
  }

  db.exec('BEGIN');
  try {
    const fornecedor = obterOuCriarFornecedor(db, dados);

    const compraInfo = db.prepare(`
      INSERT INTO compras (fornecedor_id, data, documento, chave_nfe, total, criado_em)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      fornecedor ? fornecedor.id : null,
      dados.data || hoje(),
      dados.documento || null,
      dados.chave_nfe || null,
      agora()
    );
    const compraId = Number(compraInfo.lastInsertRowid);

    let total = 0;
    const movimentos = [];

    for (const item of itens) {
      const produto = obterProduto(db, item.produto_id);
      if (!produto) {
        const erro = new Error(`Produto #${item.produto_id} não encontrado`);
        erro.status = 400;
        throw erro;
      }

      const qtd = Number(item.quantidade);
      const custo = Number(item.custo_unitario);
      if (!Number.isFinite(qtd) || qtd <= 0 || !Number.isFinite(custo) || custo < 0) {
        const erro = new Error(`Item inválido para ${produto.nome}`);
        erro.status = 400;
        throw erro;
      }

      const subtotal = round(qtd * custo, 2);
      total = round(total + subtotal, 2);

      db.prepare(`
        INSERT INTO compra_itens (compra_id, produto_id, quantidade, custo_unitario, total)
        VALUES (?, ?, ?, ?, ?)
      `).run(compraId, produto.id, qtd, custo, subtotal);

      // custo médio ponderado (usa o saldo ANTES do movimento)
      const saldoAtual = saldo(db, produto.id);
      const novoCusto = saldoAtual > 0
        ? round(((saldoAtual * produto.custo_medio) + (qtd * custo)) / (saldoAtual + qtd), 4)
        : round(custo, 4);

      const validade = item.validade
        ? (produto.validade && produto.validade < item.validade ? produto.validade : item.validade)
        : produto.validade;

      db.prepare('UPDATE produtos SET custo_medio = ?, validade = ?, atualizado_em = ? WHERE id = ?')
        .run(novoCusto, validade || null, agora(), produto.id);

      const mov = registrarMovimento(db, {
        produto_id: produto.id,
        tipo: 'entrada',
        quantidade: qtd,
        custo_unitario: custo,
        origem: 'compra',
        origem_id: compraId,
        data: dados.data || hoje(),
        usuario: dados.usuario || 'operador',
        observacao: dados.documento ? `Compra ${dados.documento}` : 'Compra',
      });
      movimentos.push(mov);
    }

    db.prepare('UPDATE compras SET total = ? WHERE id = ?').run(total, compraId);

    if (dados.vencimento) {
      db.prepare(`
        INSERT INTO contas_pagar (fornecedor_id, compra_id, vencimento, valor, status, criado_em)
        VALUES (?, ?, ?, ?, 'aberta', ?)
      `).run(fornecedor ? fornecedor.id : null, compraId, dados.vencimento, total, agora());
    }

    db.exec('COMMIT');
    return { compra_id: compraId, total, itens: itens.length, movimentos };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function listarMovimentos(db, { produto_id, limite = 200 } = {}) {
  const filtro = produto_id ? 'WHERE m.produto_id = ?' : '';
  const params = produto_id ? [produto_id, limite] : [limite];
  return db.prepare(`
    SELECT m.*, p.nome AS produto, p.ean
    FROM movimentos m
    JOIN produtos p ON p.id = m.produto_id
    ${filtro}
    ORDER BY m.id DESC
    LIMIT ?
  `).all(...params);
}

function listarFornecedores(db) {
  return db.prepare('SELECT * FROM fornecedores ORDER BY nome COLLATE NOCASE').all();
}

function dashboard(db) {
  const produtos = listarProdutos(db);
  const ativos = produtos.length;
  const valor = round(produtos.reduce((s, p) => s + Math.max(0, p.saldo) * p.custo_medio, 0), 2);
  const abaixo = produtos.filter(p => p.status !== 'ok');
  const zerados = produtos.filter(p => p.saldo <= 0);
  const vencendo = produtos.filter(p => p.validade && p.saldo > 0 && diffDias(p.validade, hoje()) <= 7);
  const semMinimo = produtos.filter(p => !(p.estoque_minimo > 0) && !(p.ponto_pedido > 0));

  return {
    produtos: ativos,
    valor_estoque: valor,
    abaixo_minimo: abaixo.length,
    zerados: zerados.length,
    vencendo7: vencendo.length,
    sem_minimo: semMinimo.length,
    alertas: abaixo
      .sort((a, b) => (a.saldo - (a.ponto_pedido ?? a.estoque_minimo)) - (b.saldo - (b.ponto_pedido ?? b.estoque_minimo)))
      .slice(0, 12),
    validade: vencendo.sort((a, b) => a.validade.localeCompare(b.validade)).slice(0, 12),
    hoje: hoje(),
  };
}

function diffDias(a, b) {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 9999;
  return Math.round((da - db) / 86400000);
}

function exportarEstoqueCsv(db) {
  const produtos = listarProdutos(db);
  const linhas = ['Codigo;Produto;Categoria;Quantidade;CustoUnitario;Validade'];
  for (const p of produtos) {
    linhas.push([
      p.ean || p.id,
      p.nome,
      p.categoria,
      String(p.saldo).replace('.', ','),
      String(p.custo_medio).replace('.', ','),
      p.validade || '',
    ].join(';'));
  }
  return linhas.join('\r\n');
}

function exportarContasCsv(db) {
  const rows = db.prepare(`
    SELECT c.vencimento, c.valor, c.status, f.nome AS fornecedor, f.cnpj
    FROM contas_pagar c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    WHERE c.status = 'aberta'
    ORDER BY c.vencimento
  `).all();
  const linhas = ['Fornecedor;Cnpj;Vencimento;Valor;Categoria'];
  for (const r of rows) {
    linhas.push([r.fornecedor || '', r.cnpj || '', r.vencimento, String(r.valor).replace('.', ','), 'Mercadoria'].join(';'));
  }
  return linhas.join('\r\n');
}

module.exports = {
  abrir, criarSchema, hoje, round,
  saldo, statusDe,
  listarProdutos, buscarPorEan, obterProduto, criarProduto, atualizarProduto,
  registrarMovimento, registrarCompra,
  listarMovimentos, listarFornecedores,
  dashboard, exportarEstoqueCsv, exportarContasCsv,
};
