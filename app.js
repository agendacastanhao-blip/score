const SHEET_ID = '1tVggtXFdi1OT2jxKB2th7uQenlX2zTO2jDfr-qexC8A';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=`;

const KPI_SHEET = 'KPI VENDEDOR';
const FINANCIAL_SHEET = 'Inadimplência';

const WEIGHT_STORAGE_KEY = 'seller_score_weights_v1';

const DEFAULT_WEIGHTS = {
  salesValue: 25,
  ordersCount: 15,
  clientsCoverage: 15,
  avgTicket: 10,
  productMix: 10,
  mubPerformance: 15,
  financialHealth: 10,
};

const WEIGHT_LABELS = {
  salesValue: 'Valor Total de Vendas',
  ordersCount: 'Qtde de Pedidos',
  clientsCoverage: 'Qtde de Clientes (Cobertura)',
  avgTicket: 'Ticket Médio',
  productMix: 'Mix de Produtos (Qtde Vendidos)',
  mubPerformance: 'Performance MUB (Novos/Ativos)',
  financialHealth: 'Saúde Financeira (Percentual de Notas Pagas)',
};

const state = {
  baseRows: [],
  ranking: [],
  selectedSeller: null,
  sellerFilter: '',
  clientFilter: '',
  scoreMin: 0,
  scoreMax: 100,
  weights: loadWeights(),
};

const el = {
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  refreshBtn: document.getElementById('refreshBtn'),
  rankingBody: document.getElementById('rankingBody'),
  detailsTitle: document.getElementById('detailsTitle'),
  detailsGrid: document.getElementById('detailsGrid'),
  sellerFilter: document.getElementById('sellerFilter'),
  clientFilter: document.getElementById('clientFilter'),
  scoreMin: document.getElementById('scoreMin'),
  scoreMax: document.getElementById('scoreMax'),
  scoreRangeLabel: document.getElementById('scoreRangeLabel'),
  avgScore: document.getElementById('avgScore'),
  sellerCount: document.getElementById('sellerCount'),
  attentionCount: document.getElementById('attentionCount'),
  riskCount: document.getElementById('riskCount'),
  navLinks: document.querySelectorAll('.nav-link'),
  dashboardPage: document.getElementById('dashboardPage'),
  settingsPage: document.getElementById('settingsPage'),
  pageTitle: document.getElementById('pageTitle'),
  pageSubtitle: document.getElementById('pageSubtitle'),
  weightsForm: document.getElementById('weightsForm'),
  weightsTotal: document.getElementById('weightsTotal'),
  saveWeightsBtn: document.getElementById('saveWeightsBtn'),
};

function normalize(value) {
  return String(value || '').trim();
}

function normalizeHeader(value) {
  return normalize(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseNumber(value) {
  const cleaned = normalize(value)
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function loadWeights() {
  try {
    const saved = JSON.parse(localStorage.getItem(WEIGHT_STORAGE_KEY) || '{}');
    return { ...DEFAULT_WEIGHTS, ...saved };
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

function getByAliases(row, aliases) {
  const keys = Object.keys(row);
  const match = keys.find((key) => aliases.includes(normalizeHeader(key)));
  return match ? row[match] : '';
}

function mapKpiRow(row) {
  const vendedor = getByAliases(row, ['vendedor']);
  const equipe = getByAliases(row, ['equipe']);
  const cliente = getByAliases(row, ['cliente', 'nome cliente', 'razao social']);

  const mubNovo = parseNumber(getByAliases(row, ['mub novo']));
  const mubAtivo = parseNumber(getByAliases(row, ['mub ativo']));

  return {
    vendedor,
    equipe,
    cliente,
    salesValue: parseNumber(getByAliases(row, ['valor total de vendas', 'valor total vendas'])),
    ordersCount: parseNumber(getByAliases(row, ['qtde de pedidos', 'quantidade de pedidos'])),
    clientsCoverage: parseNumber(getByAliases(row, ['qtde de clientes', 'quantidade de clientes'])),
    productMix: parseNumber(getByAliases(row, ['qtde de produtos vendidos', 'quantidade de produtos vendidos'])),
    avgTicket: parseNumber(getByAliases(row, ['ticket medio'])),
    mubNovo,
    mubAtivo,
    mubPerformance: mubNovo + mubAtivo,
    carteiraTotal: parseNumber(getByAliases(row, ['total de clientes na carteira'])),
  };
}

function mapFinancialRow(row) {
  return {
    vendedor: getByAliases(row, ['vendedor']),
    paidValue: parseNumber(getByAliases(row, ['valor pago'])),
    unpaidValue: parseNumber(getByAliases(row, ['valor nao pago'])),
  };
}

function toObjectRows(csvText) {
  const [headers = [], ...rows] = parseCsv(csvText);
  return rows.map((values) =>
    headers.reduce((acc, h, index) => {
      acc[h] = values[index] || '';
      return acc;
    }, {}),
  );
}

async function fetchSheet(sheetName) {
  const response = await fetch(`${SHEET_URL}${encodeURIComponent(sheetName)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao carregar ${sheetName}: ${response.status}`);
  return response.text();
}

function mergeBySeller(kpiRows, financialRows) {
  const financialMap = new Map();

  financialRows.forEach((row) => {
    const seller = normalize(row.vendedor);
    if (!seller) return;

    const current = financialMap.get(seller) || { paidValue: 0, unpaidValue: 0 };
    financialMap.set(seller, {
      paidValue: current.paidValue + row.paidValue,
      unpaidValue: current.unpaidValue + row.unpaidValue,
    });
  });

  return kpiRows
    .filter((row) => normalize(row.vendedor))
    .map((row) => {
      const fin = financialMap.get(normalize(row.vendedor)) || { paidValue: 0, unpaidValue: 0 };
      const total = fin.paidValue + fin.unpaidValue;
      return {
        ...row,
        paidValue: fin.paidValue,
        unpaidValue: fin.unpaidValue,
        financialHealth: total > 0 ? (fin.paidValue / total) * 100 : 0,
      };
    });
}

function aggregateSellers(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const seller = normalize(row.vendedor);
    if (!seller) return;
    const current = grouped.get(seller) || {
      vendedor: seller,
      equipe: row.equipe,
      clientes: new Set(),
      salesValue: 0,
      ordersCount: 0,
      clientsCoverage: 0,
      avgTicketSum: 0,
      avgTicketCount: 0,
      productMix: 0,
      mubPerformance: 0,
      paidValue: 0,
      unpaidValue: 0,
      carteiraTotal: 0,
    };

    current.equipe = current.equipe || row.equipe;
    if (normalize(row.cliente)) current.clientes.add(normalize(row.cliente));
    current.salesValue += row.salesValue;
    current.ordersCount += row.ordersCount;
    current.clientsCoverage += row.clientsCoverage;
    current.productMix += row.productMix;
    current.mubPerformance += row.mubPerformance;
    current.paidValue += row.paidValue;
    current.unpaidValue += row.unpaidValue;
    current.carteiraTotal += row.carteiraTotal;

    if (row.avgTicket > 0) {
      current.avgTicketSum += row.avgTicket;
      current.avgTicketCount += 1;
    }

    grouped.set(seller, current);
  });

  return Array.from(grouped.values()).map((row) => {
    const totalPaid = row.paidValue + row.unpaidValue;
    return {
      vendedor: row.vendedor,
      equipe: row.equipe,
      clients: Array.from(row.clientes),
      salesValue: row.salesValue,
      ordersCount: row.ordersCount,
      clientsCoverage: row.clientsCoverage,
      avgTicket: row.avgTicketCount > 0 ? row.avgTicketSum / row.avgTicketCount : 0,
      productMix: row.productMix,
      mubPerformance: row.mubPerformance,
      paidValue: row.paidValue,
      unpaidValue: row.unpaidValue,
      carteiraTotal: row.carteiraTotal,
      financialHealth: totalPaid > 0 ? (row.paidValue / totalPaid) * 100 : 0,
      carteiraPositivacao: row.carteiraTotal > 0 ? (row.clientsCoverage / row.carteiraTotal) * 100 : 0,
    };
  });
}

function scoreRows(rows) {
  const metrics = Object.keys(DEFAULT_WEIGHTS);
  const maxByMetric = metrics.reduce((acc, metric) => {
    acc[metric] = Math.max(...rows.map((row) => row[metric] || 0), 0);
    return acc;
  }, {});

  const totalWeight = Object.values(state.weights).reduce((sum, value) => sum + value, 0) || 1;

  return rows
    .map((row) => {
      const criteriaScores = metrics.reduce((acc, metric) => {
        const maxValue = maxByMetric[metric] || 0;
        acc[metric] = maxValue > 0 ? ((row[metric] || 0) / maxValue) * 100 : 0;
        return acc;
      }, {});

      const weighted = metrics.reduce((sum, metric) => {
        return sum + criteriaScores[metric] * (state.weights[metric] / totalWeight);
      }, 0);

      return {
        ...row,
        criteriaScores,
        finalScore: Math.round(weighted),
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

function buildFilters() {
  const sellers = [...new Set(state.baseRows.map((r) => r.vendedor))].filter(Boolean).sort();
  const clients = [...new Set(state.baseRows.flatMap((r) => r.clients || []))].filter(Boolean).sort();

  el.sellerFilter.innerHTML = '<option value="">Todos os vendedores</option>' + sellers.map((s) => `<option>${s}</option>`).join('');
  el.clientFilter.innerHTML = '<option value="">Todos os clientes</option>' + clients.map((c) => `<option>${c}</option>`).join('');
}

function getScoreClass(score) {
  if (score >= 80) return 'score-good';
  if (score >= 60) return 'score-attention';
  return 'score-risk';
}

function applyFiltersAndRender() {
  const filtered = state.baseRows.filter((row) => {
    const bySeller = !state.sellerFilter || row.vendedor === state.sellerFilter;
    const byClient = !state.clientFilter || row.clients.includes(state.clientFilter);
    return bySeller && byClient;
  });

  const scored = scoreRows(filtered).filter(
    (row) => row.finalScore >= state.scoreMin && row.finalScore <= state.scoreMax,
  );

  state.ranking = scored;

  const avg = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + row.finalScore, 0) / scored.length)
    : 0;
  el.avgScore.textContent = avg;
  el.sellerCount.textContent = scored.length;
  el.attentionCount.textContent = scored.filter((row) => row.finalScore >= 60 && row.finalScore < 80).length;
  el.riskCount.textContent = scored.filter((row) => row.finalScore < 60).length;

  el.rankingBody.innerHTML = scored
    .map(
      (row, idx) => `<tr data-seller="${row.vendedor}">
      <td>${idx + 1}</td>
      <td>${row.vendedor}</td>
      <td>${row.equipe || '-'}</td>
      <td><span class="pill ${getScoreClass(row.finalScore)}">${row.finalScore}</span></td>
      <td>R$ ${row.salesValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      <td>${row.financialHealth.toFixed(1)}%</td>
    </tr>`,
    )
    .join('');

  if (!scored.find((row) => row.vendedor === state.selectedSeller)) {
    state.selectedSeller = scored[0]?.vendedor || null;
  }
  renderDetails();
}

function renderDetails() {
  const seller = state.ranking.find((row) => row.vendedor === state.selectedSeller);
  if (!seller) {
    el.detailsTitle.textContent = 'Nenhum vendedor para exibir com os filtros atuais';
    el.detailsGrid.innerHTML = '';
    return;
  }

  el.detailsTitle.textContent = `Comparativo do vendedor: ${seller.vendedor}`;

  const cards = [
    ['Volume de vendas', `R$ ${seller.salesValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
    ['Positivação da carteira', `${seller.carteiraPositivacao.toFixed(1)}%`],
    ['Saúde financeira (Pago)', `${seller.financialHealth.toFixed(1)}%`],
    ['Valor não pago', `R$ ${seller.unpaidValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
  ];

  el.detailsGrid.innerHTML = cards
    .map(
      ([label, value]) => `<article class="mini-card"><span>${label}</span><strong>${value}</strong></article>`,
    )
    .join('');
}

function renderWeightsForm() {
  el.weightsForm.innerHTML = Object.entries(WEIGHT_LABELS)
    .map(
      ([key, label]) => `<label>${label}
      <input type="number" min="0" max="100" step="1" data-weight="${key}" value="${state.weights[key]}" />
    </label>`,
    )
    .join('');

  updateWeightTotal();
}

function updateWeightTotal() {
  const total = Object.values(state.weights).reduce((sum, val) => sum + Number(val || 0), 0);
  el.weightsTotal.textContent = total;
  el.weightsTotal.style.color = total === 100 ? '#027a48' : '#b42318';
}

async function loadData() {
  el.loading.classList.remove('hidden');
  el.error.classList.add('hidden');

  try {
    const [kpiCsv, financialCsv] = await Promise.all([fetchSheet(KPI_SHEET), fetchSheet(FINANCIAL_SHEET)]);

    const kpiRows = toObjectRows(kpiCsv).map(mapKpiRow);
    const financialRows = toObjectRows(financialCsv).map(mapFinancialRow);
    const merged = mergeBySeller(kpiRows, financialRows);

    state.baseRows = aggregateSellers(merged);
    buildFilters();
    applyFiltersAndRender();
  } catch (error) {
    el.error.textContent =
      'Falha ao carregar dados do Google Sheets. Confira o compartilhamento das abas KPI VENDEDOR e Inadimplência.';
    el.error.classList.remove('hidden');
    console.error(error);
  } finally {
    el.loading.classList.add('hidden');
  }
}

function switchPage(page) {
  const isDashboard = page === 'dashboard';
  el.dashboardPage.classList.toggle('active', isDashboard);
  el.settingsPage.classList.toggle('active', !isDashboard);

  el.pageTitle.textContent = isDashboard ? 'Dashboard de Performance' : 'Configurações de Pesos';
  el.pageSubtitle.textContent = isDashboard
    ? 'Ranking em tempo real de vendedores e saúde financeira.'
    : 'Defina os pesos dos indicadores para o cálculo do score final.';

  el.navLinks.forEach((btn) => btn.classList.toggle('active', btn.dataset.page === page));
}

el.refreshBtn.addEventListener('click', loadData);
el.sellerFilter.addEventListener('change', (event) => {
  state.sellerFilter = event.target.value;
  applyFiltersAndRender();
});

el.clientFilter.addEventListener('change', (event) => {
  state.clientFilter = event.target.value;
  applyFiltersAndRender();
});

el.scoreMin.addEventListener('input', (event) => {
  state.scoreMin = Math.min(Number(event.target.value), state.scoreMax);
  el.scoreMin.value = state.scoreMin;
  el.scoreRangeLabel.textContent = `${state.scoreMin} - ${state.scoreMax}`;
  applyFiltersAndRender();
});

el.scoreMax.addEventListener('input', (event) => {
  state.scoreMax = Math.max(Number(event.target.value), state.scoreMin);
  el.scoreMax.value = state.scoreMax;
  el.scoreRangeLabel.textContent = `${state.scoreMin} - ${state.scoreMax}`;
  applyFiltersAndRender();
});

el.rankingBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-seller]');
  if (!row) return;
  state.selectedSeller = row.dataset.seller;
  renderDetails();
});

el.navLinks.forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

el.weightsForm.addEventListener('input', (event) => {
  const input = event.target.closest('input[data-weight]');
  if (!input) return;
  state.weights[input.dataset.weight] = Number(input.value) || 0;
  updateWeightTotal();
});

el.saveWeightsBtn.addEventListener('click', () => {
  localStorage.setItem(WEIGHT_STORAGE_KEY, JSON.stringify(state.weights));
  applyFiltersAndRender();
});

renderWeightsForm();
loadData();
