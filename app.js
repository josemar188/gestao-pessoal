'use strict';

/* ───────────────────────── utilitários ───────────────────────── */

const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const CFG_KEY = 'gastos.cfg';
const LOCAL_KEY = 'gastos.local';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const fmt = (n) => eur.format(n || 0);
const sum = (list) => list.reduce((t, e) => t + Number(e.amount || 0), 0);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#6b7772');
const pad = (n) => String(n).padStart(2, '0');
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (m, n) => new Date(m.getFullYear(), m.getMonth() + n, 1);
const inMonth = (e, m) => { const d = new Date(e.spent_at); return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); };
const daysIn = (m) => new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
const monthName = (m, o = { month: 'long', year: 'numeric' }) => m.toLocaleDateString('pt-PT', o);
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseAmount = (s) => { const n = Number(String(s).replace(/\s|€/g, '').replace('−', '-').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

const CARD_COLORS = ['#1f47b8', '#0f766e', '#7c3aed', '#b4234a', '#b45309', '#1f2937', '#15803d'];
const isCash = (c) => c?.type === 'cash';
const PALETTE = ['#2f7d5b', '#c2603a', '#3a6ea5', '#8a6d3b', '#b0487a', '#7257b5', '#c99326', '#6b7772'];
const DEFAULT_CATEGORIES = [
  { name: 'Supermercado', emoji: '🛒', color: PALETTE[0], keywords: ['continente', 'pingo doce', 'lidl', 'aldi', 'auchan', 'mercadona', 'minipreço', 'minipreco', 'intermarché', 'intermarche'] },
  { name: 'Restaurantes', emoji: '🍽️', color: PALETTE[1], keywords: ['restaurante', 'café', 'cafe', 'pastelaria', 'mcdonald', 'burger', 'uber eats', 'glovo', 'bolt food', 'pizza'] },
  { name: 'Transportes', emoji: '🚇', color: PALETTE[2], keywords: ['uber', 'bolt', 'metro', 'carris', 'comboios', 'via verde', 'galp', 'repsol', 'prio'] },
  { name: 'Casa', emoji: '🏠', color: PALETTE[3], keywords: ['ikea', 'leroy merlin', 'edp', 'epal', 'meo', 'vodafone'] },
  { name: 'Saúde', emoji: '💊', color: PALETTE[4], keywords: ['farmácia', 'farmacia', 'wells', 'clínica', 'clinica'] },
  { name: 'Lazer', emoji: '🎬', color: PALETTE[5], keywords: ['cinema', 'netflix', 'spotify', 'fnac', 'steam'] },
  { name: 'Compras', emoji: '🛍️', color: PALETTE[6], keywords: ['zara', 'amazon', 'worten', 'primark', 'decathlon', 'el corte'] },
  { name: 'Outros', emoji: '📦', color: PALETTE[7], keywords: [] },
].map((c, i) => ({ ...c, position: i, budget: null }));

/* ───────────────────────── estado ───────────────────────── */

const S = { tab: 'gastos', month: firstOfMonth(new Date()), expenses: [], categories: [], balances: {}, balancesReady: true, cards: [], cardsReady: true, deckX: 0, deckCard: '', limit: 20, q: '', cat: '', user: null, token: null, loadedAt: 0 };
let cfg = null;
let store = null;

const catById = (id) => S.categories.find((c) => c.id === id);
const isIncome = (e) => e.kind === 'income';
const monthAll = (m = S.month) => S.expenses.filter((e) => inMonth(e, m));
const monthExpenses = (m = S.month) => monthAll(m).filter((e) => !isIncome(e));
const monthIncome = (m = S.month) => monthAll(m).filter(isIncome);
const cardById = (id) => S.cards.find((c) => c.id === id);
// Movimento líquido dos registos ligados a um cartão (entradas menos gastos), em todos os meses ou só num.
const cardNet = (id, m) => S.expenses.filter((e) => e.card_id === id && (!m || inMonth(e, m))).reduce((t, e) => t + (isIncome(e) ? 1 : -1) * Number(e.amount || 0), 0);
const cardBalance = (c) => Math.round((Number(c.initial_balance || 0) + cardNet(c.id)) * 100) / 100;
const monthId = (m = S.month) => `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
// Saldo do mês: o calculado pelos registos, o real (se foi acertado à mão) e a diferença sem registo.
function monthBalance(m = S.month) {
  const income = sum(monthIncome(m));
  const spent = sum(monthExpenses(m));
  const computed = Math.round((income - spent) * 100) / 100;
  const real = S.balances[monthId(m)];
  const set = real !== undefined && real !== null;
  const gap = set ? Math.round((computed - Number(real)) * 100) / 100 : 0; // > 0: gastos sem registo; < 0: entradas sem registo
  return { income, spent, computed, set, real: set ? Number(real) : computed, gap };
}
const gapLabel = (gap) => (gap > 0 ? 'Gastos sem registo' : 'Entradas sem registo');
const gapValue = (gap) => `${gap > 0 ? '−' : '+'}${fmt(Math.abs(gap))}`;
// Total a mostrar para um conjunto misto: gastos, ou entradas se só houver entradas.
const mixedTotal = (items) => {
  const out = sum(items.filter((e) => !isIncome(e)));
  const inc = sum(items.filter(isIncome));
  return out > 0 || !inc ? fmt(out) : `+${fmt(inc)}`;
};

function guessCategory(merchant) {
  const m = norm(merchant);
  if (!m) return '';
  const prev = S.expenses.find((e) => e.category_id && norm(e.merchant) === m);
  if (prev) return prev.category_id;
  const hit = S.categories.find((c) => (c.keywords || []).some((k) => norm(k) && m.includes(norm(k))));
  return hit ? hit.id : '';
}

/* ───────────────────────── armazenamento ───────────────────────── */

function localStore() {
  let db = { expenses: [], categories: [] };
  try { db = JSON.parse(localStorage.getItem(LOCAL_KEY)) || db; } catch { /* dados ilegíveis: começa vazio */ }
  const save = () => localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
  const upsert = (list, row) => {
    if (row.id) {
      const i = list.findIndex((x) => x.id === row.id);
      list[i] = { ...list[i], ...row };
      save();
      return list[i];
    }
    const created = { ...row, id: crypto.randomUUID() };
    list.push(created);
    save();
    return created;
  };
  return {
    kind: 'local',
    async session() { return { email: null }; },
    async expenses() { return [...db.expenses].sort((a, b) => new Date(b.spent_at) - new Date(a.spent_at)); },
    async categories() { return [...db.categories].sort((a, b) => a.position - b.position); },
    async saveExpense(row) { return upsert(db.expenses, row); },
    async deleteExpense(id) { db.expenses = db.expenses.filter((x) => x.id !== id); save(); },
    async saveCategory(row) { return upsert(db.categories, row); },
    async addCategories(rows) { rows.forEach((r) => db.categories.push({ ...r, id: crypto.randomUUID() })); save(); },
    async deleteCategory(id) {
      db.categories = db.categories.filter((x) => x.id !== id);
      db.expenses.forEach((e) => { if (e.category_id === id) e.category_id = null; });
      save();
    },
    async cards() { return [...(db.cards || [])].sort((a, b) => a.position - b.position); },
    async saveCard(row) { db.cards = db.cards || []; return upsert(db.cards, row); },
    async deleteCard(id) {
      db.cards = (db.cards || []).filter((x) => x.id !== id);
      db.expenses.forEach((e) => { if (e.card_id === id) e.card_id = null; });
      save();
    },
    async balances() { return { ...(db.balances || {}) }; },
    async saveBalance(month, amount) {
      db.balances = db.balances || {};
      if (amount === null) delete db.balances[month]; else db.balances[month] = amount;
      save();
    },
    clear() { localStorage.removeItem(LOCAL_KEY); },
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Sem ligação: não foi possível carregar a biblioteca do Supabase.'));
    document.head.appendChild(s);
  });
}

async function supabaseStore(c) {
  if (!window.supabase) await loadScript(SUPABASE_LIB);
  const sb = window.supabase.createClient(c.url, c.key);
  let uid = null;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const save = async (table, { id, ...row }) =>
    ok(id ? await sb.from(table).update(row).eq('id', id).select().single() : await sb.from(table).insert(row).select().single());
  return {
    kind: 'supabase',
    async session() {
      const { data } = await sb.auth.getSession();
      uid = data.session ? data.session.user.id : null;
      return data.session ? { email: data.session.user.email } : null;
    },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) { return !!ok(await sb.auth.signUp({ email, password })).session; },
    async signOut() { await sb.auth.signOut(); },
    async expenses() {
      const out = [];
      for (let i = 0; ; i += 1000) {
        const page = ok(await sb.from('gastos_expenses').select('*').order('spent_at', { ascending: false }).range(i, i + 999));
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    },
    async categories() { return ok(await sb.from('gastos_categories').select('*').order('position')); },
    async saveExpense(row) { return save('gastos_expenses', row); },
    async deleteExpense(id) { ok(await sb.from('gastos_expenses').delete().eq('id', id)); },
    async saveCategory(row) { return save('gastos_categories', row); },
    async addCategories(rows) { ok(await sb.from('gastos_categories').insert(rows)); },
    async deleteCategory(id) { ok(await sb.from('gastos_categories').delete().eq('id', id)); },
    // Devolve null se a tabela ainda não existir (falta correr supabase/migracao-cartoes.sql).
    async cards() {
      const { data, error } = await sb.from('gastos_cards').select('*').order('position');
      return error ? null : data;
    },
    async saveCard(row) {
      try { return await save('gastos_cards', row); } catch (err) {
        if (/'type'|\btype\b.*column|column.*\btype\b/i.test(err.message)) throw new Error('Falta correr o ficheiro migracao-dinheiro.sql no Supabase.');
        throw err;
      }
    },
    async deleteCard(id) { ok(await sb.from('gastos_cards').delete().eq('id', id)); },
    // Devolve null se a tabela ainda não existir (falta correr supabase/migracao-saldo.sql).
    async balances() {
      const { data, error } = await sb.from('gastos_balances').select('month, amount');
      if (error) return null;
      return Object.fromEntries(data.map((r) => [r.month, Number(r.amount)]));
    },
    async saveBalance(month, amount) {
      ok(amount === null
        ? await sb.from('gastos_balances').delete().eq('month', month)
        : await sb.from('gastos_balances').upsert({ user_id: uid, month, amount, updated_at: new Date().toISOString() }));
    },
    async token() {
      const row = ok(await sb.from('gastos_ingest_tokens').select('token').maybeSingle());
      return row ? row.token : this.newToken();
    },
    async newToken() {
      const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
      ok(await sb.from('gastos_ingest_tokens').upsert({ user_id: uid, token }));
      return token;
    },
  };
}

function demoData(categories) {
  const by = (name) => categories.find((c) => c.name === name).id;
  const pool = [
    ['Continente', 'Supermercado', 18, 85], ['Pingo Doce', 'Supermercado', 8, 45], ['Lidl', 'Supermercado', 12, 60],
    ['Pastelaria Versailles', 'Restaurantes', 3, 9], ['Restaurante O Velho Eurico', 'Restaurantes', 22, 48], ['Glovo', 'Restaurantes', 12, 28],
    ['Uber', 'Transportes', 5, 16], ['Metro de Lisboa', 'Transportes', 2, 12], ['Galp', 'Transportes', 30, 65],
    ['IKEA', 'Casa', 15, 120], ['Farmácia Estácio', 'Saúde', 6, 30], ['Cinema NOS', 'Lazer', 8, 16],
    ['Spotify', 'Lazer', 8, 8], ['Fnac', 'Compras', 15, 90], ['Zara', 'Compras', 20, 70],
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out = [];
  const now = new Date();
  for (let back = 0; back < 6; back++) {
    const m = addMonths(firstOfMonth(now), -back);
    const lastDay = back === 0 ? now.getDate() : daysIn(m);
    out.push({ kind: 'income', amount: 1650, merchant: 'Ordenado', category_id: null, card: null, note: null, spent_at: new Date(m.getFullYear(), m.getMonth(), 1, 9, 0).toISOString(), source: 'manual' });
    for (let d = 1; d <= lastDay; d++) {
      const count = Math.floor(rnd() * 3.2);
      for (let i = 0; i < count; i++) {
        const [merchant, cat, lo, hi] = pool[Math.floor(rnd() * pool.length)];
        const when = new Date(m.getFullYear(), m.getMonth(), d, 8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
        if (when > now) continue;
        const applePay = rnd() > 0.25;
        out.push({
          amount: Math.round((lo + rnd() * (hi - lo)) * 100) / 100, merchant, category_id: by(cat),
          card: applePay ? 'Visa •• 4821' : null, note: null, spent_at: when.toISOString(), source: applePay ? 'apple_pay' : 'manual',
        });
      }
    }
  }
  return out;
}

/* ───────────────────────── arranque ───────────────────────── */

async function boot() {
  try { cfg = JSON.parse(localStorage.getItem(CFG_KEY)); } catch { cfg = null; }
  if (!cfg) return renderSetup();
  try {
    store = cfg.mode === 'supabase' ? await supabaseStore(cfg) : localStore();
    S.user = await store.session();
    if (!S.user) return renderAuth();
    await loadAll();
    render();
  } catch (err) {
    renderSetup(err.message);
  }
}

async function loadAll() {
  let balances, cards;
  [S.categories, S.expenses, balances, cards] = await Promise.all([store.categories(), store.expenses(), store.balances(), store.cards()]);
  S.cardsReady = cards !== null;
  S.cards = cards || [];
  S.balancesReady = balances !== null;
  S.balances = balances || {};
  if (!S.categories.length) {
    await store.addCategories(DEFAULT_CATEGORIES);
    S.categories = await store.categories();
  }
  S.loadedAt = Date.now();
}

async function refresh(silent) {
  try {
    await loadAll();
    render();
    if (!silent) toast('Atualizado');
  } catch (err) {
    if (!silent) toast(err.message);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && store && S.user && !$('#sheet-root').innerHTML && Date.now() - S.loadedAt > 5000) refresh(true);
});

/* ───────────────────────── ecrãs de entrada ───────────────────────── */

function renderSetup(error) {
  $('#app').innerHTML = `
  <div class="gate">
    <div class="logo">€</div>
    <h1>Gastos</h1>
    <p class="lead">O teu registo de despesas, com os pagamentos Apple Pay a entrarem sozinhos.</p>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <form data-f="setup" class="card form">
      <h2>Ligar ao Supabase</h2>
      <label>URL do projeto<input name="url" type="url" required placeholder="https://xxxx.supabase.co" value="${esc(cfg?.url || '')}" autocapitalize="off" autocorrect="off"></label>
      <label>Chave pública (anon / publishable)<input name="key" required placeholder="eyJ… ou sb_publishable_…" value="${esc(cfg?.key || '')}" autocapitalize="off" autocorrect="off"></label>
      <button class="btn primary">Ligar</button>
      <p class="hint">Encontras ambos em Supabase → Project Settings → API. Ficam guardados só neste dispositivo.</p>
    </form>
    <button class="btn ghost" data-a="demo">Experimentar com dados de exemplo</button>
  </div>`;
}

function renderAuth(message, signup) {
  $('#app').innerHTML = `
  <div class="gate">
    <div class="logo">€</div>
    <h1>${signup ? 'Criar conta' : 'Entrar'}</h1>
    ${message ? `<p class="error">${esc(message)}</p>` : ''}
    <form data-f="auth" data-signup="${signup ? 1 : ''}" class="card form">
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Palavra-passe<input name="password" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary">${signup ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <button class="btn ghost" data-a="auth-toggle" data-signup="${signup ? '' : 1}">${signup ? 'Já tenho conta' : 'Criar conta nova'}</button>
    <button class="btn ghost" data-a="reset-cfg">Alterar ligação ao Supabase</button>
  </div>`;
}

/* ───────────────────────── vista principal ───────────────────────── */

const ICONS = {
  gastos: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  resumo: '<path d="M5 19V10M12 19V5M19 19v-6"/>',
  orcamentos: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3"/>',
  definicoes: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
};
const TABS = [['gastos', 'Gastos'], ['resumo', 'Resumo'], ['orcamentos', 'Orçamentos'], ['definicoes', 'Definições']];

function render() {
  const views = { gastos: viewGastos, resumo: viewResumo, orcamentos: viewOrcamentos, definicoes: viewDefinicoes };
  $('#app').innerHTML = `
    ${S.tab === 'definicoes' ? '<header class="top"><h1 class="title">Definições</h1></header>' : deck()}
    <main>${views[S.tab]()}</main>
    <button class="fab" data-a="add" aria-label="Adicionar registo">+</button>
    <nav class="tabs">${TABS.map(([id, label]) => `
      <button data-a="tab" data-tab="${id}" class="${S.tab === id ? 'on' : ''}" ${S.tab === id ? 'aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg><span>${label}</span>
      </button>`).join('')}
    </nav>`;
  const d = $('#deck');
  if (d) d.scrollLeft = S.deckX;
}

// Carrossel: o painel do mês à frente e os cartões atrás, a passar para o lado ao arrastar.
function deck() {
  if (!S.cardsReady) return header();
  const slides = S.cards.map((c) => {
    const net = cardNet(c.id, S.month);
    return `<button class="paycard ${isCash(c) ? 'cash' : ''}" data-a="card-edit" data-id="${c.id}" style="--c:${color(c.color)}">
      <span class="pc-top"><b>${esc(c.name)}</b><i aria-hidden="true"></i></span>
      <span class="pc-bal"><small>${isCash(c) ? 'Em dinheiro' : 'Saldo'}</small><strong>${fmt(cardBalance(c))}</strong></span>
      <span class="pc-foot">${net ? `${net > 0 ? '+' : '−'}${fmt(Math.abs(net))} em ${esc(monthName(S.month, { month: 'long' }))}` : `Sem movimentos em ${esc(monthName(S.month, { month: 'long' }))}`}</span>
    </button>`;
  }).join('');
  return `<div class="deck" id="deck">${header()}${slides}
    <button class="paycard add" data-a="card-add"><strong>+</strong><span>Adicionar cartão ou dinheiro</span></button>
  </div>`;
}

function header() {
  const list = monthExpenses();
  const total = sum(list);
  const income = sum(monthIncome());
  const bal = monthBalance();
  const prevMonth = addMonths(S.month, -1);
  const prev = sum(monthExpenses(prevMonth));
  const isCurrent = S.month.getTime() === firstOfMonth(new Date()).getTime();
  let delta = '';
  if (prev > 0 && !isCurrent) {
    const pct = Math.round(((total - prev) / prev) * 100);
    delta = `, ${pct > 0 ? '+' : ''}${pct}% face a ${monthName(prevMonth, { month: 'long' })}`;
  }
  return `
  <header class="top hero">
    <div class="month">
      <button data-a="month" data-n="-1" aria-label="Mês anterior">‹</button>
      <button data-a="month" data-n="0" class="name">${esc(monthName(S.month))}</button>
      <button data-a="month" data-n="1" aria-label="Mês seguinte" ${isCurrent ? 'disabled' : ''}>›</button>
      <button data-a="refresh" class="refresh" aria-label="Atualizar">↻</button>
    </div>
    <div class="total">${fmt(total)}</div>
    <div class="sub">${list.length} ${list.length === 1 ? 'gasto' : 'gastos'}${delta}</div>
    ${income > 0 || bal.set ? `<div class="flow">
      <span><small>Entradas</small><b>+${fmt(income)}</b></span>
      <button data-a="balance" aria-label="Acertar saldo"><small>${bal.set ? 'Saldo real' : 'Saldo'} ✎</small><b>${fmt(bal.real)}</b></button>
      ${bal.gap ? `<span><small>${gapLabel(bal.gap)}</small><b>${gapValue(bal.gap)}</b></span>` : ''}
    </div>` : ''}
  </header>`;
}

/* ── Gastos ── */

function budgetStatus(m = S.month) {
  const list = monthExpenses(m);
  return S.categories.filter((c) => Number(c.budget) > 0).map((c) => {
    const spent = sum(list.filter((e) => e.category_id === c.id));
    return { c, spent, budget: Number(c.budget), pct: spent / Number(c.budget) };
  });
}

function viewGastos() {
  const list = monthExpenses();
  const used = S.categories.filter((c) => list.some((e) => e.category_id === c.id));
  const hasIncome = monthIncome().length > 0;
  const alerts = budgetStatus().filter((b) => b.pct >= 0.8);
  return `
  ${alerts.map((b) => `
    <button class="alert ${b.pct > 1 ? 'bad' : 'warn'}" data-a="tab" data-tab="orcamentos">
      <strong>${b.pct > 1 ? 'Orçamento ultrapassado' : 'Perto do limite'}</strong>
      ${esc(b.c.emoji)} ${esc(b.c.name)}: ${fmt(b.spent)} de ${fmt(b.budget)} (${Math.round(b.pct * 100)}%)
    </button>`).join('')}
  <input id="q" type="search" placeholder="Procurar comerciante ou nota" value="${esc(S.q)}" aria-label="Procurar">
  ${used.length + (hasIncome ? 1 : 0) > 1 ? `<div class="chips">
    <button data-a="chip" data-cat="" class="${S.cat ? '' : 'on'}">Todas</button>
    ${used.map((c) => `<button data-a="chip" data-cat="${c.id}" class="${S.cat === c.id ? 'on' : ''}"><i style="--c:${color(c.color)}"></i>${esc(c.name)}</button>`).join('')}
    ${hasIncome ? `<button data-a="chip" data-cat="income" class="${S.cat === 'income' ? 'on' : ''}"><i style="--c:var(--good)"></i>Entradas</button>` : ''}
  </div>` : ''}
  <div id="list">${listHTML()}</div>`;
}

function listHTML() {
  const q = norm(S.q);
  const inCat = (e) => (S.cat === 'income' ? isIncome(e) : !S.cat || (!isIncome(e) && e.category_id === S.cat));
  const list = monthAll().filter((e) => inCat(e) && (!S.deckCard || e.card_id === S.deckCard) && (!q || norm(e.merchant).includes(q) || norm(e.note).includes(q)));
  if (!list.length) {
    return `<div class="empty"><p>${S.deckCard && !S.q && !S.cat ? `Sem registos com ${esc(cardById(S.deckCard)?.name || 'este cartão')} neste mês.` : S.q || S.cat ? 'Nenhum registo corresponde ao filtro.' : 'Ainda não há registos neste mês.'}</p>
      <button class="btn primary" data-a="add">Adicionar registo</button>
      ${S.deckCard ? '<button class="btn" data-a="link-open">Ligar registos já feitos</button>' : ''}</div>`;
  }
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 864e5));
  const groups = new Map();
  list.forEach((e) => { const k = dayKey(new Date(e.spent_at)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
  const c = S.cat && S.cat !== 'income' ? catById(S.cat) : null;
  const pc = S.deckCard ? cardById(S.deckCard) : null;
  const what = [c ? `${esc(c.emoji)} ${esc(c.name)}` : S.cat === 'income' ? 'Entradas' : '', pc ? esc(pc.name) : ''].filter(Boolean).join(', ') || 'Resultados da pesquisa';
  const filtered = S.cat || q || pc
    ? `<div class="card subtotal"><span><b>${what}</b><small>${list.length} ${list.length === 1 ? 'registo' : 'registos'} em ${esc(monthName(S.month, { month: 'long' }))}</small></span><strong>${mixedTotal(list)}</strong></div>`
    : '';
  // Mostra S.limit registos de cada vez; o total de cada dia conta sempre o dia inteiro.
  let room = S.limit;
  const shown = [...groups].filter(([, items]) => { const fits = room > 0; room -= items.length; return fits; });
  room = S.limit;
  const rest = list.length - Math.min(list.length, S.limit);
  const foot = `
    ${rest > 0 ? `<button class="btn more" data-a="more">Mostrar mais ${Math.min(rest, 20)} <small>de ${rest} por ver</small></button>` : ''}
    <div class="listfoot">
      <button data-a="add"><b>+</b>Adicionar registo</button>
      ${S.deckCard ? '<button data-a="link-open"><b>⇄</b>Ligar registos já feitos</button>' : ''}
    </div>`;
  return filtered + shown.map(([k, all]) => {
    const items = all.slice(0, Math.max(room, 0));
    room -= all.length;
    const d = new Date(items[0].spent_at);
    const label = k === today ? 'Hoje' : k === yesterday ? 'Ontem' : d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<section class="day">
      <h2><span>${esc(label)}</span><span>${mixedTotal(all)}</span></h2>
      <div class="card rows">${items.map(rowHTML).join('')}</div>
    </section>`;
  }).join('') + foot;
}

function rowHTML(e) {
  if (isIncome(e)) {
    const t = new Date(e.spent_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    return `<button class="row" data-a="edit" data-id="${e.id}">
      <span class="dot" style="--c:var(--good)">💶</span>
      <span class="who"><b>${esc(e.merchant || 'Entrada')}</b><small><span>${esc(['Entrada', cardById(e.card_id)?.name].filter(Boolean).join(', '))}</span></small></span>
      <span class="amt in"><b>+${fmt(e.amount)}</b><small>${t}</small></span>
    </button>`;
  }
  const c = catById(e.category_id);
  const time = new Date(e.spent_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const pc = cardById(e.card_id);
  const meta = esc([c ? c.name : 'Sem categoria', pc?.name].filter(Boolean).join(', '));
  return `<button class="row" data-a="edit" data-id="${e.id}">
    <span class="dot" style="--c:${color(c?.color)}">${esc(c?.emoji || '❔')}</span>
    <span class="who"><b>${esc(e.merchant || 'Sem descrição')}</b><small><span>${meta}</span>${e.source === 'apple_pay' ? '<i class="tag">Apple Pay</i>' : ''}</small></span>
    <span class="amt"><b>${fmt(e.amount)}</b><small>${time}</small></span>
  </button>`;
}

/* ── Resumo ── */

function columns(items) {
  const max = Math.max(...items.map((i) => i.value), 0.01);
  return `<div class="cols">${items.map((i) => `
    <button class="col" data-a="tip" data-tip="${esc(i.tip)}" aria-label="${esc(i.tip)}">
      <span class="bar ${i.on ? 'on' : ''}" style="height:${i.value > 0 ? Math.max((i.value / max) * 100, 2).toFixed(1) : 0}%"></span>
      <span class="lbl">${esc(i.label)}</span>
    </button>`).join('')}</div><p class="tip">Toca numa barra para ver o valor.</p>`;
}

function viewResumo() {
  const list = monthExpenses();
  const total = sum(list);
  const income = sum(monthIncome());
  const usedPct = income > 0 ? total / income : 0;
  const bal = monthBalance();
  const balance = `
  <section class="card block">
    <h2>Balanço do mês</h2>
    <div class="hl"><span>Entradas</span><b class="good">+${fmt(income)}</b></div>
    <div class="hl"><span>Gastos</span><b>${fmt(total)}</b></div>
    ${income > 0 ? `<div class="track big ${usedPct > 1 ? 'bad' : usedPct >= 0.9 ? 'warn' : ''}"><i style="width:${Math.min(usedPct * 100, 100).toFixed(1)}%"></i></div>` : ''}
    <div class="hl"><span>${bal.set ? 'Saldo pelos registos' : 'Saldo'}</span><b class="${bal.computed < 0 ? 'neg' : ''}">${fmt(bal.computed)}</b></div>
    ${bal.set ? `<div class="hl"><span>Saldo real</span><b class="${bal.real < 0 ? 'neg' : ''}">${fmt(bal.real)}</b></div>` : ''}
    ${bal.gap ? `<div class="gap"><span><b>${gapLabel(bal.gap)}</b><small>${bal.gap > 0 ? 'Saiu dinheiro que não está na lista.' : 'Entrou dinheiro que não está na lista.'}</small></span><strong>${gapValue(bal.gap)}</strong></div>` : ''}
    ${bal.set && !bal.gap ? '<small>O saldo real bate certo com os registos.</small>' : ''}
    ${income > 0 && !bal.set ? `<small>${usedPct > 1 ? `Gastaste mais ${fmt(total - income)} do que entrou.` : `Gastaste ${Math.round(usedPct * 100)}% do que entrou.`}</small>` : ''}
    <button class="btn" data-a="balance">${bal.set ? 'Alterar saldo real' : 'Acertar saldo'}</button>
    ${S.cards.length ? `<div class="cardlist">
      ${S.cards.map((c) => `<button class="hl" data-a="card-edit" data-id="${c.id}"><span><i style="--c:${color(c.color)}"></i>${esc(c.name)}</span><b class="${cardBalance(c) < 0 ? 'neg' : ''}">${fmt(cardBalance(c))}</b></button>`).join('')}
      ${S.cards.length > 1 ? `<div class="hl sum"><span>Total disponível</span><b>${fmt(S.cards.reduce((t, c) => t + cardBalance(c), 0))}</b></div>` : ''}
    </div>` : ''}
  </section>`;
  if (!list.length) return balance;
  const now = new Date();
  const isCurrent = inMonth({ spent_at: now }, S.month);
  const days = isCurrent ? now.getDate() : daysIn(S.month);
  const biggest = list.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a));
  const applePay = list.filter((e) => e.source === 'apple_pay').length;

  const byCat = [...S.categories, { id: null, name: 'Sem categoria', emoji: '❔', color: '#6b7772' }]
    .map((c) => ({ c, v: sum(list.filter((e) => (e.category_id || null) === c.id)) }))
    .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);

  const perDay = Array.from({ length: daysIn(S.month) }, (_, i) => {
    const day = i + 1;
    const v = sum(list.filter((e) => new Date(e.spent_at).getDate() === day));
    return { value: v, label: day === 1 || day % 5 === 0 ? String(day) : '', tip: `${day} de ${monthName(S.month, { month: 'long' })}: ${fmt(v)}` };
  });

  const months = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(S.month, i - 5);
    const v = sum(monthExpenses(m));
    return { value: v, label: monthName(m, { month: 'short' }).replace('.', ''), tip: `${monthName(m)}: ${fmt(v)}`, on: i === 5 };
  });

  return `${balance}
  <div class="tiles">
    <div class="card tile"><small>Média por dia</small><b>${fmt(total / days)}</b></div>
    <div class="card tile"><small>Maior gasto</small><b>${fmt(biggest.amount)}</b><em>${esc(biggest.merchant || '—')}</em></div>
    <div class="card tile"><small>Via Apple Pay</small><b>${applePay}</b><em>de ${list.length} registos</em></div>
    <div class="card tile"><small>Categorias</small><b>${byCat.length}</b><em>com gastos</em></div>
  </div>
  <section class="card block">
    <h2>Por categoria</h2>
    ${byCat.map(({ c, v }) => `
      <div class="hbar">
        <div class="hl"><span>${esc(c.emoji)} ${esc(c.name)}</span><span><b>${fmt(v)}</b> <small>${Math.round((v / total) * 100)}%</small></span></div>
        <div class="track"><i style="width:${((v / byCat[0].v) * 100).toFixed(1)}%;background:${color(c.color)}"></i></div>
      </div>`).join('')}
  </section>
  <section class="card block"><h2>Por dia</h2>${columns(perDay)}</section>
  <section class="card block"><h2>Últimos 6 meses</h2>${columns(months)}</section>`;
}

/* ── Orçamentos ── */

function viewOrcamentos() {
  const status = budgetStatus();
  const without = S.categories.filter((c) => !(Number(c.budget) > 0));
  const bar = (b) => {
    const state = b.pct > 1 ? 'bad' : b.pct >= 0.8 ? 'warn' : 'ok';
    const text = b.pct > 1 ? `Ultrapassado em ${fmt(b.spent - b.budget)}` : `Restam ${fmt(b.budget - b.spent)}${state === 'warn' ? ' · perto do limite' : ''}`;
    return `<div class="track big ${state}"><i style="width:${Math.min(b.pct * 100, 100).toFixed(1)}%"></i></div>
      <div class="hl"><small class="${state}">${text}</small><small>${Math.round(b.pct * 100)}%</small></div>`;
  };
  if (!status.length) {
    return `<div class="empty"><p>Define um limite mensal por categoria e a app avisa-te quando chegares aos 80%.</p></div>
      <section class="card rows">${without.map(noBudgetRow).join('')}</section>`;
  }
  const all = { spent: sum(status.map((b) => ({ amount: b.spent }))), budget: sum(status.map((b) => ({ amount: b.budget }))) };
  all.pct = all.spent / all.budget;
  return `
  <section class="card block">
    <div class="hl"><h2>Total orçamentado</h2><span><b>${fmt(all.spent)}</b> <small>de ${fmt(all.budget)}</small></span></div>
    ${bar(all)}
  </section>
  ${status.map((b) => `
    <button class="card block budget" data-a="cat-edit" data-id="${b.c.id}">
      <div class="hl"><span>${esc(b.c.emoji)} ${esc(b.c.name)}</span><span><b>${fmt(b.spent)}</b> <small>de ${fmt(b.budget)}</small></span></div>
      ${bar(b)}
    </button>`).join('')}
  ${without.length ? `<h2 class="sec">Sem orçamento</h2><section class="card rows">${without.map(noBudgetRow).join('')}</section>` : ''}`;
}

const noBudgetRow = (c) => `<button class="row" data-a="cat-edit" data-id="${c.id}">
  <span class="dot" style="--c:${color(c.color)}">${esc(c.emoji)}</span>
  <span class="who"><b>${esc(c.name)}</b></span><span class="link">Definir</span></button>`;

/* ── Definições ── */

function viewDefinicoes() {
  const supa = store.kind === 'supabase';
  const endpoint = supa ? `${cfg.url}/rest/v1/rpc/gastos_ingest_expense` : '';
  const copyRow = (label, value) => `<div class="copy"><div><small>${label}</small><code>${esc(value)}</code></div><button class="btn small" data-a="copy" data-text="${esc(value)}">Copiar</button></div>`;
  return `
  ${S.cardsReady ? `<h2 class="sec">Cartões e dinheiro</h2>
  <section class="card rows">
    ${S.cards.map((c) => `<button class="row" data-a="card-edit" data-id="${c.id}">
      <span class="dot" style="--c:${color(c.color)}">${isCash(c) ? '🪙' : '💳'}</span>
      <span class="who"><b>${esc(c.name)}</b><small><span>Saldo ${fmt(cardBalance(c))}</span></small></span><span class="link">Editar</span></button>`).join('')}
    <button class="row add" data-a="card-add">+ Novo cartão ou dinheiro</button>
  </section>` : ''}

  <h2 class="sec">Categorias</h2>
  <section class="card rows">
    ${S.categories.map((c) => `<button class="row" data-a="cat-edit" data-id="${c.id}">
      <span class="dot" style="--c:${color(c.color)}">${esc(c.emoji)}</span>
      <span class="who"><b>${esc(c.name)}</b><small><span>${Number(c.budget) > 0 ? `Orçamento ${fmt(c.budget)}/mês` : 'Sem orçamento'}</span></small></span><span class="link">Editar</span></button>`).join('')}
    <button class="row add" data-a="cat-add">+ Nova categoria</button>
  </section>

  <h2 class="sec">Apple Pay automático</h2>
  <section class="card block">
    ${supa ? `
    <p>Na app <b>Atalhos</b> do iPhone: Automação → Nova → <b>Transação</b> → escolhe os cartões → <b>Executar imediatamente</b>. Adiciona a ação <b>Obter conteúdo do URL</b> com estes dados:</p>
    ${copyRow('URL (método POST)', endpoint)}
    ${copyRow('Cabeçalho "apikey"', cfg.key)}
    ${S.token ? copyRow('Campo "p_token"', S.token) : '<button class="btn" data-a="token">Mostrar o meu token</button>'}
    <p class="hint">Corpo do pedido em JSON, com os campos <code>p_token</code>, <code>p_amount</code> (Montante), <code>p_merchant</code> (Comerciante) e <code>p_card</code> (Cartão ou passe), os três últimos tirados da variável "Entrada do atalho". O passo a passo completo está no README.</p>
    ${S.token ? '<button class="btn" data-a="token-new">Gerar token novo</button>' : ''}` : `
    <p>O registo automático dos pagamentos Apple Pay precisa da ligação ao Supabase, para o iPhone ter para onde enviar cada transação.</p>`}
  </section>

  <h2 class="sec">Conta</h2>
  <section class="card block">
    ${supa ? `<p>Sessão iniciada como <b>${esc(S.user.email)}</b>.</p><button class="btn" data-a="signout">Terminar sessão</button>`
      : `<p>Modo local: os dados estão guardados só neste dispositivo.</p>
         <button class="btn primary" data-a="reset-cfg">Ligar ao Supabase</button>
         <button class="btn danger" data-a="clear-local">Apagar dados locais</button>`}
  </section>`;
}

/* ───────────────────────── folhas (formulários) ───────────────────────── */

function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="backdrop" data-a="close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.classList.add('locked');
}
function closeSheet() {
  $('#sheet-root').innerHTML = '';
  document.body.classList.remove('locked');
}

function expenseSheet(e) {
  const isNew = !e;
  e = e || { amount: '', merchant: '', category_id: '', card: '', note: '', spent_at: new Date().toISOString(), kind: S.cat === 'income' ? 'income' : 'expense', card_id: S.deckCard || null };
  const inc = isIncome(e);
  openSheet(`
  <form data-f="expense" class="form" data-id="${e.id || ''}">
    <h2>${isNew ? 'Novo registo' : 'Editar registo'}</h2>
    <fieldset class="seg"><legend class="sr">Tipo</legend>
      <label><input type="radio" name="kind" value="expense" ${inc ? '' : 'checked'}><span>Gasto</span></label>
      <label><input type="radio" name="kind" value="income" ${inc ? 'checked' : ''}><span>Entrada</span></label>
    </fieldset>
    <label class="amount">Montante (€)<input name="amount" inputmode="decimal" required placeholder="0,00" value="${isNew ? '' : esc(String(Number(e.amount).toFixed(2)).replace('.', ','))}" autocomplete="off"></label>
    <label><span class="only-expense">Comerciante ou descrição</span><span class="only-income">Origem (por exemplo, Ordenado)</span><input name="merchant" required value="${esc(e.merchant)}" autocomplete="off"></label>
    <label class="only-expense">Categoria<select name="category_id" ${isNew ? 'data-auto="1"' : ''}>
      <option value="">Sem categoria</option>
      ${S.categories.map((c) => `<option value="${c.id}" ${c.id === e.category_id ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}
    </select></label>
    <label>Data e hora<input name="spent_at" type="datetime-local" required value="${toLocalInput(new Date(e.spent_at))}"></label>
    ${S.cards.length ? `<label>Pago com<select name="card_id">
      <option value="">Sem cartão nem dinheiro</option>
      ${S.cards.map((c) => `<option value="${c.id}" ${c.id === e.card_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select></label>` : ''}
    ${e.card ? `<p class="hint only-expense">Pago com: ${esc(e.card)}</p>` : ''}
    <label>Nota (opcional)<input name="note" value="${esc(e.note || '')}" autocomplete="off"></label>
    <div class="actions">
      <button type="button" class="btn" data-a="close">Cancelar</button>
      <button class="btn primary">Guardar</button>
    </div>
    ${isNew ? '' : `<button type="button" class="btn danger" data-a="del-expense" data-id="${e.id}">Eliminar registo</button>`}
  </form>`);
  if (isNew) $('.sheet input[name=amount]').focus();
}

function cardSheet(c) {
  const isNew = !c;
  c = c || { name: '', wallet_match: '', color: CARD_COLORS[S.cards.length % CARD_COLORS.length] };
  const linked = isNew ? 0 : S.expenses.filter((e) => e.card_id === c.id).length;
  openSheet(`
  <form data-f="card" class="form" data-id="${c.id || ''}">
    <h2>${isNew ? 'Novo' : 'Editar'} <span class="only-card">cartão</span><span class="only-cash">dinheiro</span></h2>
    <fieldset class="seg"><legend class="sr">Tipo</legend>
      <label><input type="radio" name="type" value="card" ${isCash(c) ? '' : 'checked'}><span>Cartão</span></label>
      <label><input type="radio" name="type" value="cash" ${isCash(c) ? 'checked' : ''}><span>Dinheiro</span></label>
    </fieldset>
    <label>Nome<input name="name" required value="${esc(c.name)}" placeholder="Santander, Carteira, Mealheiro…" autocomplete="off"></label>
    <label class="amount"><span class="only-card">Saldo atual (€)</span><span class="only-cash">Dinheiro que tens agora (€)</span><input name="balance" inputmode="decimal" required placeholder="0,00" value="${isNew ? '' : esc(String(cardBalance(c).toFixed(2)).replace('.', ','))}" autocomplete="off"></label>
    <p class="hint">${isNew ? 'Daqui em diante, cada gasto pago com ele desconta deste valor e cada entrada soma.' : `${linked} ${linked === 1 ? 'registo ligado' : 'registos ligados'}. Se alterares o saldo aqui, ele passa a contar a partir do novo valor.`}</p>
    <fieldset><legend>Cor</legend><div class="swatches">
      ${CARD_COLORS.map((p) => `<label><input type="radio" name="color" value="${p}" ${p === c.color ? 'checked' : ''}><span style="background:${p}"></span></label>`).join('')}
    </div></fieldset>
    <label class="only-card">Nome na Carteira do iPhone (opcional)<input name="wallet_match" value="${esc(c.wallet_match || '')}" placeholder="Igual ao nome, se ficar vazio" autocomplete="off"></label>
    <p class="hint only-card">Os pagamentos Apple Pay cujo cartão contenha este texto ficam ligados aqui sozinhos.</p>
    <div class="actions">
      <button type="button" class="btn" data-a="close">Cancelar</button>
      <button class="btn primary">Guardar</button>
    </div>
    ${isNew ? '' : `<button type="button" class="btn danger" data-a="del-card" data-id="${c.id}">Eliminar</button>`}
  </form>`);
}

// Ligar a um cartão (ou ao dinheiro) registos que já existem, escolhendo-os numa lista.
function linkSheet(card) {
  if (!card) return;
  const items = monthAll().filter((e) => e.card_id !== card.id);
  const month = monthName(S.month, { month: 'long' });
  openSheet(`
  <form data-f="link" class="form" data-id="${card.id}">
    <h2>Ligar registos a ${esc(card.name)}</h2>
    ${items.length ? `
    <p class="hint">Registos de ${esc(month)} que ainda não estão em ${esc(card.name)}.</p>
    <button type="button" class="btn small" data-a="link-all">Selecionar todos</button>
    <div class="pick">${items.map((e) => {
      const other = cardById(e.card_id);
      const d = new Date(e.spent_at);
      return `<label><input type="checkbox" name="ids" value="${e.id}"><span class="box" aria-hidden="true"></span>
        <span class="who"><b>${esc(e.merchant || 'Sem descrição')}</b><small><span>${d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}${other ? `, agora em ${esc(other.name)}` : ''}</span></small></span>
        <span class="amt ${isIncome(e) ? 'in' : ''}"><b>${isIncome(e) ? '+' : ''}${fmt(e.amount)}</b></span></label>`;
    }).join('')}</div>
    <label class="check"><input type="checkbox" name="discount"><span class="box" aria-hidden="true"></span><span>Descontar estes registos do saldo<small>Deixa desligado se o saldo de ${esc(card.name)} já os inclui.</small></span></label>
    <div class="actions">
      <button type="button" class="btn" data-a="close">Cancelar</button>
      <button class="btn primary" id="link-go" disabled>Ligar</button>
    </div>` : `
    <p class="hint">Não há registos de ${esc(month)} por ligar a ${esc(card.name)}.</p>
    <button type="button" class="btn" data-a="close">Fechar</button>`}
  </form>`);
}
function linkCount(form) {
  const n = form.querySelectorAll('input[name=ids]:checked').length;
  const go = $('#link-go');
  go.disabled = !n;
  go.textContent = n ? `Ligar ${n} ${n === 1 ? 'registo' : 'registos'}` : 'Ligar';
}

function balanceSheet() {
  const bal = monthBalance();
  const month = monthName(S.month, { month: 'long' });
  openSheet(`
  <form data-f="balance" class="form">
    <h2>Saldo real de ${esc(month)}</h2>
    <p class="hint">Escreve o saldo que tens de facto. Se for diferente do que os registos dão (${fmt(bal.computed)}), a diferença fica declarada como "sem registo".</p>
    <label class="amount">Saldo real (€)<input name="amount" inputmode="decimal" required placeholder="0,00" value="${esc(String(bal.real.toFixed(2)).replace('.', ','))}" autocomplete="off"></label>
    <div class="actions">
      <button type="button" class="btn" data-a="close">Cancelar</button>
      <button class="btn primary">Guardar</button>
    </div>
    ${bal.set ? '<button type="button" class="btn" data-a="balance-clear">Voltar ao saldo calculado</button>' : ''}
  </form>`);
  const input = $('.sheet input[name=amount]');
  input.focus(); input.select();
}

function categorySheet(c) {
  const isNew = !c;
  c = c || { name: '', emoji: '📦', color: PALETTE[S.categories.length % PALETTE.length], budget: '', keywords: [] };
  openSheet(`
  <form data-f="category" class="form" data-id="${c.id || ''}">
    <h2>${isNew ? 'Nova categoria' : 'Editar categoria'}</h2>
    <div class="two">
      <label class="narrow">Ícone<input name="emoji" value="${esc(c.emoji)}" maxlength="4"></label>
      <label>Nome<input name="name" required value="${esc(c.name)}" autocomplete="off"></label>
    </div>
    <fieldset><legend>Cor</legend><div class="swatches">
      ${PALETTE.map((p) => `<label><input type="radio" name="color" value="${p}" ${p === c.color ? 'checked' : ''}><span style="background:${p}"></span></label>`).join('')}
    </div></fieldset>
    <label>Orçamento mensal (€)<input name="budget" inputmode="decimal" placeholder="Sem limite" value="${Number(c.budget) > 0 ? esc(String(c.budget).replace('.', ',')) : ''}" autocomplete="off"></label>
    <label>Comerciantes desta categoria<input name="keywords" value="${esc((c.keywords || []).join(', '))}" placeholder="continente, lidl, …" autocomplete="off" autocapitalize="off"></label>
    <p class="hint">Separados por vírgulas. Um pagamento cujo comerciante contenha uma destas palavras entra logo nesta categoria.</p>
    <div class="actions">
      <button type="button" class="btn" data-a="close">Cancelar</button>
      <button class="btn primary">Guardar</button>
    </div>
    ${isNew ? '' : `<button type="button" class="btn danger" data-a="del-category" data-id="${c.id}">Eliminar categoria</button>`}
  </form>`);
}

/* ───────────────────────── ações ───────────────────────── */

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Pede um segundo toque antes de eliminar.
function armed(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.textContent = 'Tocar de novo para confirmar';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.a === 'del-expense' ? 'Eliminar registo' : btn.dataset.a === 'del-card' ? 'Eliminar' : btn.dataset.a === 'del-category' ? 'Eliminar categoria' : 'Apagar dados locais'; } }, 4000);
  return false;
}

const actions = {
  tab(t) { S.tab = t.dataset.tab; S.limit = 20; render(); scrollTo(0, 0); },
  month(t) {
    const n = Number(t.dataset.n);
    const next = n === 0 ? firstOfMonth(new Date()) : addMonths(S.month, n);
    if (next > firstOfMonth(new Date())) return;
    S.limit = 20;
    S.month = next; S.cat = ''; render();
  },
  refresh() { return refresh(); },
  chip(t) { S.cat = t.dataset.cat; S.limit = 20; render(); },
  more() { S.limit += 20; $('#list').innerHTML = listHTML(); },
  'link-open'() { linkSheet(cardById(S.deckCard)); },
  'link-all'(t) { const boxes = [...t.form.querySelectorAll('input[name=ids]')]; const on = boxes.some((b) => !b.checked); boxes.forEach((b) => { b.checked = on; }); linkCount(t.form); },
  add() { expenseSheet(); },
  edit(t) { expenseSheet(S.expenses.find((e) => e.id === t.dataset.id)); },
  close() { closeSheet(); },
  'cat-add'() { categorySheet(); },
  'card-add'() { cardSheet(); },
  'card-edit'(t) { cardSheet(cardById(t.dataset.id)); },
  async 'del-card'(t) {
    if (!armed(t)) return;
    await store.deleteCard(t.dataset.id);
    S.deckCard = ''; S.deckX = 0;
    await loadAll();
    closeSheet(); render(); toast('Eliminado');
  },
  balance() {
    if (!S.balancesReady) throw new Error('Falta correr o ficheiro migracao-saldo.sql no Supabase.');
    balanceSheet();
  },
  async 'balance-clear'() {
    await store.saveBalance(monthId(), null);
    delete S.balances[monthId()];
    closeSheet(); render(); toast('Saldo calculado reposto');
  },
  'cat-edit'(t) { categorySheet(catById(t.dataset.id)); },
  tip(t) { const p = t.closest('.cols').nextElementSibling; p.textContent = t.dataset.tip; p.classList.add('on'); },
  async copy(t) {
    try { await navigator.clipboard.writeText(t.dataset.text); toast('Copiado'); } catch { toast('Não foi possível copiar'); }
  },
  async 'del-expense'(t) {
    if (!armed(t)) return;
    await store.deleteExpense(t.dataset.id);
    S.expenses = S.expenses.filter((e) => e.id !== t.dataset.id);
    closeSheet(); render(); toast('Registo eliminado');
  },
  async 'del-category'(t) {
    if (!armed(t)) return;
    await store.deleteCategory(t.dataset.id);
    await loadAll();
    closeSheet(); render(); toast('Categoria eliminada');
  },
  async token() { S.token = await store.token(); render(); },
  async 'token-new'(t) {
    if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = 'Confirmar (o atalho antigo deixa de funcionar)'; return; }
    S.token = await store.newToken(); render(); toast('Token novo gerado');
  },
  async signout() { await store.signOut(); S.user = null; S.token = null; renderAuth(); },
  'auth-toggle'(t) { renderAuth('', !!t.dataset.signup); },
  'reset-cfg'() { const old = cfg; localStorage.removeItem(CFG_KEY); cfg = old?.mode === 'supabase' ? old : null; renderSetup(); },
  'clear-local'(t) { if (!armed(t)) return; store.clear(); localStorage.removeItem(CFG_KEY); cfg = null; renderSetup(); },
  async demo() {
    localStorage.setItem(CFG_KEY, JSON.stringify({ mode: 'local' }));
    const s = localStore();
    if (!(await s.categories()).length) {
      await s.addCategories(DEFAULT_CATEGORIES.map((c) => ({ ...c, budget: { Supermercado: 350, Restaurantes: 150, Transportes: 120 }[c.name] || null })));
      const main = await s.saveCard({ name: 'Santander', color: CARD_COLORS[3], initial_balance: 0, position: 0, wallet_match: null });
      await s.saveCard({ name: 'Revolut', color: CARD_COLORS[5], initial_balance: 240, position: 1, wallet_match: null });
      await s.saveCard({ name: 'Dinheiro', type: 'cash', color: CARD_COLORS[6], initial_balance: 85, position: 2, wallet_match: null });
      for (const e of demoData(await s.categories())) await s.saveExpense({ ...e, card_id: e.kind === 'income' || e.source === 'apple_pay' ? main.id : null });
    }
    await boot();
  },
};

const forms = {
  async setup(data) {
    const url = String(data.get('url')).trim().replace(/\/+$/, '');
    const key = String(data.get('key')).trim();
    if (!/^https:\/\//.test(url)) throw new Error('O URL tem de começar por https://');
    localStorage.setItem(CFG_KEY, JSON.stringify({ mode: 'supabase', url, key }));
    await boot();
  },
  async auth(data, form) {
    const email = String(data.get('email')).trim();
    const password = String(data.get('password'));
    try {
      if (form.dataset.signup) {
        const loggedIn = await store.signUp(email, password);
        if (!loggedIn) return renderAuth('Conta criada. Confirma o email que recebeste e depois entra.');
      } else {
        await store.signIn(email, password);
      }
    } catch (err) {
      return renderAuth(err.message, !!form.dataset.signup);
    }
    await boot();
  },
  async expense(data, form) {
    const amount = parseAmount(data.get('amount'));
    if (!(amount >= 0)) throw new Error('Montante inválido');
    const when = new Date(data.get('spent_at'));
    if (Number.isNaN(when.getTime())) throw new Error('Data inválida');
    const kind = data.get('kind') === 'income' ? 'income' : 'expense';
    const row = {
      kind,
      amount,
      merchant: String(data.get('merchant')).trim(),
      category_id: kind === 'income' ? null : data.get('category_id') || null,
      note: String(data.get('note')).trim() || null,
      spent_at: when.toISOString(),
    };
    if (S.cardsReady) row.card_id = data.get('card_id') || null;
    if (form.dataset.id) row.id = form.dataset.id; else row.source = 'manual';
    const saved = await store.saveExpense(row);
    S.expenses = [saved, ...S.expenses.filter((e) => e.id !== saved.id)].sort((a, b) => new Date(b.spent_at) - new Date(a.spent_at));
    if (!inMonth(saved, S.month) && when <= new Date()) S.month = firstOfMonth(when);
    closeSheet(); render(); toast('Registo guardado');
  },
  async card(data, form) {
    const balance = parseAmount(data.get('balance'));
    if (!Number.isFinite(balance)) throw new Error('Saldo inválido');
    const id = form.dataset.id;
    const row = {
      name: String(data.get('name')).trim(),
      type: data.get('type') === 'cash' ? 'cash' : 'card',
      wallet_match: data.get('type') === 'cash' ? null : String(data.get('wallet_match')).trim() || null,
      color: color(data.get('color')),
      // o saldo é sempre: saldo inicial + movimentos ligados; por isso guarda-se o inicial que dá o saldo pedido
      initial_balance: Math.round((balance - (id ? cardNet(id) : 0)) * 100) / 100,
    };
    if (id) row.id = id; else row.position = S.cards.length;
    await store.saveCard(row);
    S.cards = await store.cards();
    closeSheet(); render(); toast('Guardado');
  },
  async link(data, form) {
    const card = cardById(form.dataset.id);
    const ids = data.getAll('ids');
    if (!card || !ids.length) return;
    const picked = S.expenses.filter((e) => ids.includes(e.id));
    await Promise.all(picked.map((e) => store.saveExpense({ id: e.id, card_id: card.id })));
    if (!data.get('discount')) {
      // o saldo escrito à mão já incluía estes registos: compensa-se para ele não mexer
      const net = picked.reduce((t, e) => t + (isIncome(e) ? 1 : -1) * Number(e.amount || 0), 0);
      await store.saveCard({ id: card.id, initial_balance: Math.round((Number(card.initial_balance || 0) - net) * 100) / 100 });
    }
    await loadAll();
    closeSheet(); render(); toast(`${picked.length} ${picked.length === 1 ? 'registo ligado' : 'registos ligados'}`);
  },
  async balance(data) {
    const amount = parseAmount(data.get('amount'));
    if (!Number.isFinite(amount)) throw new Error('Saldo inválido');
    await store.saveBalance(monthId(), amount);
    S.balances[monthId()] = amount;
    closeSheet(); render(); toast('Saldo guardado');
  },
  async category(data, form) {
    const budgetText = String(data.get('budget')).trim();
    const budget = budgetText ? parseAmount(budgetText) : null;
    if (budgetText && !(budget >= 0)) throw new Error('Orçamento inválido');
    const row = {
      name: String(data.get('name')).trim(),
      emoji: String(data.get('emoji')).trim() || '📦',
      color: color(data.get('color')),
      budget: budget || null,
      keywords: String(data.get('keywords')).split(',').map((k) => k.trim()).filter(Boolean),
    };
    if (form.dataset.id) row.id = form.dataset.id; else row.position = S.categories.length;
    await store.saveCategory(row);
    S.categories = await store.categories();
    closeSheet(); render(); toast('Categoria guardada');
  },
};

async function run(fn, ...args) {
  try { await fn(...args); } catch (err) { console.error(err); toast(err.message || 'Algo correu mal'); }
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-a]');
  if (t && actions[t.dataset.a]) run(actions[t.dataset.a], t);
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (forms[f.dataset.f]) run(forms[f.dataset.f], new FormData(f), f);
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { S.q = ev.target.value; S.limit = 20; $('#list').innerHTML = listHTML(); }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'ids') linkCount(t.form);
  if (t.name === 'type' && t.form?.dataset.f === 'card') {
    const name = t.form.elements.name;
    if (t.value === 'cash' && !name.value.trim()) name.value = 'Dinheiro';
    if (t.value === 'card' && name.value === 'Dinheiro') name.value = '';
  }
  if (t.name === 'category_id') delete t.dataset.auto; // escolhida à mão: não voltar a adivinhar
  if (t.name === 'merchant' && t.form?.dataset.f === 'expense') {
    const select = t.form.elements.category_id;
    if (select.dataset.auto && t.form.elements.kind.value !== 'income') select.value = guessCategory(t.value);
  }
});

// A posição do carrossel sobrevive a cada redesenho do ecrã.
// Ao parar num cartão, a lista passa a mostrar só os registos feitos com ele; no painel do mês mostra todos.
document.addEventListener('scroll', (ev) => {
  const d = ev.target;
  if (d.id !== 'deck') return;
  S.deckX = d.scrollLeft;
  const step = d.firstElementChild.offsetWidth + 10;
  const card = S.cards[Math.round(d.scrollLeft / step) - 1];
  const id = card ? card.id : '';
  if (id === S.deckCard) return;
  S.deckCard = id;
  S.limit = 20;
  const list = $('#list');
  if (list) list.innerHTML = listHTML();
}, true);

document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
