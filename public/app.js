'use strict';

const $ = sel => document.querySelector(sel);
const brl = n => Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
const num = n => Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hojeLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

let carrinho = [];
let produtoEditando = null;
let adicionarAposSalvar = false;
let cacheProdutos = new Map();

async function api(caminho, opcoes = {}) {
  const res = await fetch(caminho, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.erro || `Erro ${res.status}`);
  return dados;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- navegação ----------
document.querySelectorAll('#tabs button').forEach(botao => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('ativo', b === botao));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('ativo', t.id === `tab-${botao.dataset.tab}`));
    const aba = botao.dataset.tab;
    if (aba === 'estoque') { carregarDashboard(); carregarEstoque(); }
    if (aba === 'receber') setTimeout(() => $('#ean').focus(), 60);
    if (aba === 'produtos') carregarProdutos();
    if (aba === 'movimentos') carregarMovimentos();
  });
});

// ---------- estoque ----------
async function carregarDashboard() {
  const d = await api('/api/dashboard');
  const kpis = [
    { label: 'Produtos ativos', value: d.produtos },
    { label: 'Valor em estoque', value: brl(d.valor_estoque) },
    { label: 'Para repor', value: d.abaixo_minimo, cls: d.abaixo_minimo ? 'warn' : '' },
    { label: 'Zerados', value: d.zerados, cls: d.zerados ? 'bad' : '' },
    { label: 'Vencendo em 7 dias', value: d.vencendo7, cls: d.vencendo7 ? 'warn' : '' },
  ];
  $('#kpis').innerHTML = kpis.map(k => `
    <div class="kpi ${k.cls || ''}"><span>${esc(k.label)}</span><strong>${esc(k.value)}</strong></div>
  `).join('');
}

let timerEstoque;
async function carregarEstoque(busca = $('#busca-estoque')?.value || '') {
  const { produtos } = await api('/api/produtos?busca=' + encodeURIComponent(busca));
  cacheProdutos = new Map(produtos.map(p => [p.id, p]));

  if (!produtos.length) {
    $('#tabela-estoque').innerHTML = '<p class="vazio">Nenhum produto encontrado.</p>';
    return;
  }

  $('#tabela-estoque').innerHTML = `
    <table>
      <thead><tr>
        <th>Produto</th><th class="ocultar-mobile">EAN</th><th class="ocultar-mobile">Categoria</th>
        <th class="num">Saldo</th><th class="num">Ponto</th><th>Status</th>
        <th class="num ocultar-mobile">Custo</th><th class="num">Valor</th>
      </tr></thead>
      <tbody>${produtos.map(p => `
        <tr>
          <td>${esc(p.nome)}</td>
          <td class="ocultar-mobile">${esc(p.ean || '—')}</td>
          <td class="ocultar-mobile">${esc(p.categoria)}</td>
          <td class="num">${num(p.saldo)} ${esc(p.unidade)}</td>
          <td class="num">${num(p.ponto_pedido ?? p.estoque_minimo)}</td>
          <td><span class="tag ${esc(p.status)}">${esc(p.status)}</span></td>
          <td class="num ocultar-mobile">${brl(p.custo_medio)}</td>
          <td class="num">${brl(p.valor_estoque)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

$('#busca-estoque')?.addEventListener('input', e => {
  clearTimeout(timerEstoque);
  timerEstoque = setTimeout(() => carregarEstoque(e.target.value.trim()), 250);
});

// ---------- produtos ----------
let timerProdutos;
async function carregarProdutos(busca = $('#busca-produtos')?.value || '') {
  const { produtos } = await api('/api/produtos?busca=' + encodeURIComponent(busca));
  cacheProdutos = new Map(produtos.map(p => [p.id, p]));

  if (!produtos.length) {
    $('#tabela-produtos').innerHTML = '<p class="vazio">Nenhum produto. Use "Novo produto".</p>';
    return;
  }

  $('#tabela-produtos').innerHTML = `
    <table>
      <thead><tr>
        <th>Produto</th><th class="ocultar-mobile">EAN</th><th>Un.</th><th class="ocultar-mobile">Categoria</th>
        <th class="num">Mínimo</th><th class="num ocultar-mobile">Ponto</th>
        <th class="num">Custo</th><th class="num">Saldo</th><th></th>
      </tr></thead>
      <tbody>${produtos.map(p => `
        <tr>
          <td>${esc(p.nome)}</td>
          <td class="ocultar-mobile">${esc(p.ean || '—')}</td>
          <td>${esc(p.unidade)}</td>
          <td class="ocultar-mobile">${esc(p.categoria)}</td>
          <td class="num">${num(p.estoque_minimo)}</td>
          <td class="num ocultar-mobile">${num(p.ponto_pedido ?? p.estoque_minimo)}</td>
          <td class="num">${brl(p.custo_medio)}</td>
          <td class="num">${num(p.saldo)}</td>
          <td><button class="ghost" data-editar="${p.id}">Editar</button></td>
        </tr>`).join('')}</tbody>
    </table>`;
}

$('#busca-produtos')?.addEventListener('input', e => {
  clearTimeout(timerProdutos);
  timerProdutos = setTimeout(() => carregarProdutos(e.target.value.trim()), 250);
});

$('#tabela-produtos')?.addEventListener('click', async e => {
  const botao = e.target.closest('[data-editar]');
  if (!botao) return;
  try {
    const p = await api('/api/produtos/' + Number(botao.dataset.editar));
    abrirModal(p);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- movimentos ----------
let movimentosCache = [];
async function carregarMovimentos(busca = $('#busca-mov')?.value || '') {
  const { movimentos } = await api('/api/movimentos?limite=500');
  movimentosCache = movimentos;
  const filtro = busca.toLowerCase();
  const lista = filtro
    ? movimentos.filter(m => (m.produto || '').toLowerCase().includes(filtro) || (m.ean || '').includes(filtro))
    : movimentos;

  if (!lista.length) {
    $('#tabela-movimentos').innerHTML = '<p class="vazio">Nenhum movimento.</p>';
    return;
  }

  $('#tabela-movimentos').innerHTML = `
    <table>
      <thead><tr>
        <th>Data</th><th>Produto</th><th>Tipo</th><th class="num">Qtd</th>
        <th class="num ocultar-mobile">Custo</th><th class="ocultar-mobile">Origem</th><th class="ocultar-mobile">Obs.</th>
      </tr></thead>
      <tbody>${lista.map(m => `
        <tr>
          <td>${esc(m.data)}</td>
          <td>${esc(m.produto)}</td>
          <td><span class="tag ${esc(m.tipo)}">${esc(m.tipo)}</span></td>
          <td class="num">${num(m.quantidade)}</td>
          <td class="num ocultar-mobile">${m.custo_unitario != null ? brl(m.custo_unitario) : '—'}</td>
          <td class="ocultar-mobile">${esc(m.origem)}</td>
          <td class="ocultar-mobile">${esc(m.observacao || '—')}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

$('#busca-mov')?.addEventListener('input', e => {
  carregarMovimentos(e.target.value.trim());
});

// ---------- fornecedores ----------
async function carregarFornecedores() {
  const { fornecedores } = await api('/api/fornecedores');
  const select = $('#fornecedor');
  const atual = select.value;
  select.innerHTML = '<option value="">— selecionar —</option>' +
    fornecedores.map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('');
  if (atual) select.value = atual;
}

// ---------- recebimento ----------
function adicionarAoCarrinho(produto, quantidade = 1, custo = null) {
  const existente = carrinho.find(i => i.produto_id === produto.id);
  if (existente) {
    existente.quantidade += quantidade;
  } else {
    carrinho.push({
      produto_id: produto.id,
      nome: produto.nome,
      ean: produto.ean,
      unidade: produto.unidade,
      quantidade,
      custo_unitario: custo != null ? custo : (produto.custo_medio || 0),
    });
  }
  renderCarrinho();
}

function renderCarrinho() {
  const el = $('#carrinho');
  if (!carrinho.length) {
    el.innerHTML = '<p class="vazio">Nenhum item. Bipe um produto ou busque pelo nome.</p>';
    atualizarTotal();
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Produto</th><th class="num">Qtd</th><th class="num">Custo unit.</th>
        <th class="num">Total</th><th></th>
      </tr></thead>
      <tbody>${carrinho.map((i, idx) => `
        <tr>
          <td>${esc(i.nome)}<br><small style="color:#6b7280">${esc(i.ean || '')} · ${esc(i.unidade)}</small></td>
          <td class="num"><input class="qtd-input" type="number" min="0.001" step="0.001" value="${i.quantidade}" data-idx="${idx}" data-campo="quantidade"></td>
          <td class="num"><input class="custo-input" type="number" min="0" step="0.01" value="${i.custo_unitario}" data-idx="${idx}" data-campo="custo_unitario"></td>
          <td class="num">${brl(i.quantidade * i.custo_unitario)}</td>
          <td><button class="ghost" data-remover="${idx}">×</button></td>
        </tr>`).join('')}</tbody>
    </table>`;
  atualizarTotal();
}

function atualizarTotal() {
  const total = carrinho.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0);
  $('#total-compra').textContent = brl(total);
  $('#btn-confirmar').disabled = !carrinho.length;
}

$('#carrinho')?.addEventListener('input', e => {
  const campo = e.target.dataset.campo;
  if (!campo) return;
  const idx = Number(e.target.dataset.idx);
  const valor = Number(e.target.value);
  if (!Number.isFinite(valor)) return;
  carrinho[idx][campo] = valor;
  const linha = e.target.closest('tr');
  if (linha) linha.children[3].textContent = brl(carrinho[idx].quantidade * carrinho[idx].custo_unitario);
  atualizarTotal();
});

$('#carrinho')?.addEventListener('click', e => {
  const botao = e.target.closest('[data-remover]');
  if (!botao) return;
  carrinho.splice(Number(botao.dataset.remover), 1);
  renderCarrinho();
});

// leitor de código de barras (USB digita + Enter)
$('#ean')?.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const ean = $('#ean').value.trim();
  if (!ean) return;
  $('#ean').value = '';

  try {
    const produto = await api('/api/produtos?ean=' + encodeURIComponent(ean));
    adicionarAoCarrinho(produto);
    toast(`${produto.nome} adicionado`);
  } catch (err) {
    adicionarAposSalvar = true;
    abrirModal({ ean }, { adicionarDepois: true });
    toast('Código não cadastrado. Informe o nome do produto.');
  }
});

// busca por nome no recebimento
let timerReceber;
$('#busca-receber')?.addEventListener('input', e => {
  clearTimeout(timerReceber);
  const termo = e.target.value.trim();
  if (termo.length < 2) { $('#resultado-busca').innerHTML = ''; return; }

  timerReceber = setTimeout(async () => {
    const { produtos } = await api('/api/produtos?busca=' + encodeURIComponent(termo));
    cacheProdutos = new Map(produtos.map(p => [p.id, p]));
    $('#resultado-busca').innerHTML = produtos.slice(0, 8).map(p => `
      <button data-id="${p.id}">
        <strong>${esc(p.nome)}</strong>
        <small>${esc(p.ean || 'sem código')} · saldo ${num(p.saldo)} ${esc(p.unidade)}</small>
      </button>`).join('') || '<button disabled>Nenhum produto</button>';
  }, 220);
});

$('#resultado-busca')?.addEventListener('click', e => {
  const botao = e.target.closest('button[data-id]');
  if (!botao) return;
  const p = cacheProdutos.get(Number(botao.dataset.id));
  if (p) adicionarAoCarrinho(p);
  $('#resultado-busca').innerHTML = '';
  $('#busca-receber').value = '';
});

// confirmar recebimento
$('#btn-confirmar')?.addEventListener('click', async () => {
  const fornecedor_id = $('#fornecedor').value ? Number($('#fornecedor').value) : null;
  const fornecedor_nome = $('#novo-fornecedor').value.trim();
  const dados = {
    fornecedor_id,
    fornecedor_nome,
    data: $('#data-compra').value || hojeLocal(),
    documento: $('#documento').value.trim(),
    vencimento: $('#vencimento').value || null,
    itens: carrinho.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, custo_unitario: i.custo_unitario })),
  };

  $('#btn-confirmar').disabled = true;
  try {
    const r = await api('/api/compras', { method: 'POST', body: JSON.stringify(dados) });
    toast(`Recebimento registrado · ${brl(r.total)}`);
    carrinho = [];
    renderCarrinho();
    $('#documento').value = '';
    $('#vencimento').value = '';
    $('#novo-fornecedor').value = '';
    await Promise.all([carregarEstoque(), carregarDashboard(), carregarFornecedores()]);
    $('#ean').focus();
  } catch (err) {
    toast(err.message);
  } finally {
    $('#btn-confirmar').disabled = !carrinho.length;
  }
});

$('#btn-limpar')?.addEventListener('click', () => {
  carrinho = [];
  renderCarrinho();
});

// ---------- modal de produto ----------
function abrirModal(p = {}, { adicionarDepois = false } = {}) {
  produtoEditando = p.id || null;
  adicionarAposSalvar = adicionarDepois;
  $('#modal-titulo').textContent = p.id ? 'Editar produto' : 'Novo produto';
  $('#f-id').value = p.id || '';
  $('#f-ean').value = p.ean || '';
  $('#f-nome').value = p.nome || '';
  $('#f-unidade').value = p.unidade || 'un';
  $('#f-categoria').value = p.categoria || '';
  $('#f-minimo').value = p.estoque_minimo ?? 0;
  $('#f-ponto').value = p.ponto_pedido ?? '';
  $('#f-custo').value = p.custo_medio ?? 0;
  $('#modal').classList.remove('escondido');
  setTimeout(() => (p.id ? $('#f-nome') : (p.ean ? $('#f-nome') : $('#f-ean'))).focus(), 60);
}

function fecharModal() {
  $('#modal').classList.add('escondido');
  produtoEditando = null;
  adicionarAposSalvar = false;
}

$('#modal-cancelar')?.addEventListener('click', fecharModal);
$('#modal')?.addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });

$('#form-produto')?.addEventListener('submit', async e => {
  e.preventDefault();
  const editando = !!produtoEditando;
  const dados = {
    ean: $('#f-ean').value.trim() || null,
    nome: $('#f-nome').value.trim(),
    unidade: $('#f-unidade').value.trim() || 'un',
    categoria: $('#f-categoria').value.trim() || 'Geral',
    estoque_minimo: Number($('#f-minimo').value) || 0,
    ponto_pedido: $('#f-ponto').value === '' ? null : Number($('#f-ponto').value),
    custo_medio: Number($('#f-custo').value) || 0,
  };

  try {
    const salvo = editando
      ? await api('/api/produtos/' + produtoEditando, { method: 'PUT', body: JSON.stringify(dados) })
      : await api('/api/produtos', { method: 'POST', body: JSON.stringify(dados) });

    const adicionar = adicionarAposSalvar;
    fecharModal();
    toast(editando ? 'Produto atualizado' : 'Produto criado');
    await Promise.all([carregarProdutos(), carregarEstoque(), carregarDashboard()]);
    if (adicionar) {
      adicionarAoCarrinho(salvo);
      document.querySelector('#tabs button[data-tab="receber"]').click();
    }
  } catch (err) {
    toast(err.message);
  }
});

$('#btn-novo')?.addEventListener('click', () => abrirModal({}));

// ---------- exportar ----------
$('#btn-exportar')?.addEventListener('click', () => {
  window.location.href = '/api/export/estoque.csv';
});

// ---------- início ----------
(async function iniciar() {
  $('#data-compra').value = hojeLocal();
  await Promise.all([carregarDashboard(), carregarEstoque(), carregarFornecedores()]);
  renderCarrinho();
})();
