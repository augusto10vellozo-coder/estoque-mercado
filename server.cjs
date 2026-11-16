#!/usr/bin/env node
'use strict';

/**
 * Servidor local do estoque.
 *
 *   node server.cjs            # porta 3000
 *   node server.cjs --port 8080
 *
 * Abra http://localhost:3000 no PC. No tablet/celular, use o IP da máquina
 * que aparece no console (mesma rede Wi-Fi).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dbmod = require('./db.cjs');

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf('--' + nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const PORTA = Number(arg('port', process.env.PORT || 3000));
const DB = path.resolve(arg('db', path.join(__dirname, 'dados', 'estoque.db')));
const PUBLIC = path.join(__dirname, 'public');

const db = dbmod.abrir(DB);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(corpo);
}

function csv(res, nome, texto) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nome}"`,
  });
  res.end('\ufeff' + texto);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    let tamanho = 0;
    req.on('data', chunk => {
      tamanho += chunk.length;
      if (tamanho > 2 * 1024 * 1024) {
        reject(Object.assign(new Error('Corpo grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      dados += chunk;
    });
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); }
      catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function servirArquivo(res, arquivo) {
  fs.readFile(arquivo, (erro, buffer) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
    res.end(buffer);
  });
}

async function api(req, res, url) {
  const partes = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const metodo = req.method;

  // GET /api/dashboard
  if (metodo === 'GET' && url.pathname === '/api/dashboard') {
    return json(res, 200, dbmod.dashboard(db));
  }

  // GET /api/health
  if (metodo === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, db: DB });
  }

  // GET /api/produtos?busca=&ean=
  if (metodo === 'GET' && url.pathname === '/api/produtos') {
    const ean = url.searchParams.get('ean');
    if (ean) {
      const p = dbmod.buscarPorEan(db, ean);
      return p ? json(res, 200, p) : json(res, 404, { erro: 'Produto não encontrado para este código' });
    }
    const busca = url.searchParams.get('busca') || '';
    return json(res, 200, { produtos: dbmod.listarProdutos(db, { busca }) });
  }

  // POST /api/produtos
  if (metodo === 'POST' && url.pathname === '/api/produtos') {
    const dados = await lerCorpo(req);
    return json(res, 201, dbmod.criarProduto(db, dados));
  }

  // /api/produtos/:id
  if (partes[1] === 'produtos' && partes[2]) {
    const id = Number(partes[2]);
    if (metodo === 'GET' && partes[3] === 'movimentos') {
      return json(res, 200, { movimentos: dbmod.listarMovimentos(db, { produto_id: id }) });
    }
    if (metodo === 'GET') {
      const p = dbmod.obterProduto(db, id);
      return p ? json(res, 200, p) : json(res, 404, { erro: 'Produto não encontrado' });
    }
    if (metodo === 'PUT') {
      const dados = await lerCorpo(req);
      return json(res, 200, dbmod.atualizarProduto(db, id, dados));
    }
  }

  // GET /api/movimentos?produto_id=&limite=
  if (metodo === 'GET' && url.pathname === '/api/movimentos') {
    const produto_id = url.searchParams.get('produto_id');
    const limite = Math.min(1000, Number(url.searchParams.get('limite')) || 200);
    return json(res, 200, { movimentos: dbmod.listarMovimentos(db, { produto_id: produto_id ? Number(produto_id) : undefined, limite }) });
  }

  // GET/POST /api/fornecedores
  if (url.pathname === '/api/fornecedores') {
    if (metodo === 'GET') return json(res, 200, { fornecedores: dbmod.listarFornecedores(db) });
    if (metodo === 'POST') {
      const dados = await lerCorpo(req);
      const f = dbmod.obterOuCriarFornecedor(db, { fornecedor_nome: dados.nome, cnpj: dados.cnpj });
      return json(res, 201, f);
    }
  }

  // POST /api/compras
  if (metodo === 'POST' && url.pathname === '/api/compras') {
    const dados = await lerCorpo(req);
    return json(res, 201, dbmod.registrarCompra(db, dados));
  }

  // POST /api/movimentos (ajuste/perda/entrada avulsa)
  if (metodo === 'POST' && url.pathname === '/api/movimentos') {
    const dados = await lerCorpo(req);
    return json(res, 201, dbmod.registrarMovimento(db, dados));
  }

  // exports para o painel
  if (metodo === 'GET' && url.pathname === '/api/export/estoque.csv') {
    return csv(res, 'estoque.csv', dbmod.exportarEstoqueCsv(db));
  }
  if (metodo === 'GET' && url.pathname === '/api/export/contas.csv') {
    return csv(res, 'contas.csv', dbmod.exportarContasCsv(db));
  }

  return json(res, 404, { erro: 'Rota não encontrada' });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await api(req, res, url);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return servirArquivo(res, path.join(PUBLIC, 'index.html'));
    }

    // arquivo estático dentro de public/ (sem traversal)
    const alvo = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (!alvo.startsWith(PUBLIC)) {
      res.writeHead(403); res.end('Proibido'); return;
    }
    return servirArquivo(res, alvo);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    json(res, status, { erro: e.message || 'Erro interno' });
  }
});

servidor.listen(PORTA, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  console.log('');
  console.log('Estoque do mercado');
  console.log(`  PC:     http://localhost:${PORTA}`);
  for (const ip of ips) console.log(`  Tablet: http://${ip}:${PORTA}`);
  console.log(`  Banco:  ${DB}`);
  console.log('');
  console.log('Ctrl+C para parar.');
});
