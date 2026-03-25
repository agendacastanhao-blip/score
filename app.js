const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1tVggtXFdi1OT2jxKB2th7uQenlX2zTO2jDfr-qexC8A/gviz/tq?tqx=out:csv&gid=0';

const state = {
  rows: [],
  filtered: [],
  page: 1,
  perPage: 10,
};

const el = {
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  tableBody: document.getElementById('tableBody'),
  searchInput: document.getElementById('searchInput'),
  resultCount: document.getElementById('resultCount'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  pageLabel: document.getElementById('pageLabel'),
  refreshBtn: document.getElementById('refreshBtn'),
  detailPanel: document.getElementById('detailPanel'),
  detailName: document.getElementById('detailName'),
  detailMeta: document.getElementById('detailMeta'),
  criteriaList: document.getElementById('criteriaList'),
  closeDetail: document.getElementById('closeDetail'),
  kpiTotal: document.getElementById('kpiTotal'),
  kpiDiamond: document.getElementById('kpiDiamond'),
  kpiRisk: document.getElementById('kpiRisk'),
  kpiRejected: document.getElementById('kpiRejected'),
};

const normalize = (v) => String(v || '').trim();

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
      if (row.some((item) => item.length > 0)) rows.push(row);
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

function yearsSince(dateString) {
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return 0;
  const now = new Date();
  return (now - parsed) / (1000 * 60 * 60 * 24 * 365.25);
}

function boolScore(value) {
  return normalize(value).toUpperCase() === 'SIM' ? 100 : 0;
}

function filledScore(value) {
  return normalize(value) ? 100 : 0;
}

function segmentScore(segment) {
  const normalized = normalize(segment).toLowerCase();
  if (['mercado', 'padaria', 'restaurante'].includes(normalized)) return 100;
  return normalized === 'outros' ? 50 : 50;
}

function cnpjTimeScore(dateString) {
  const years = yearsSince(dateString);
  if (years > 5) return 100;
  if (years >= 2) return 70;
  return 30;
}

function calculateCustomer(row) {
  const criteria = [
    {
      label: 'Contrato Social',
      score: boolScore(row.contratoSocial),
      weight: 0.05,
    },
    {
      label: 'RG/CPF do Dono',
      score: boolScore(row.rgCpfDono),
      weight: 0.05,
    },
    {
      label: 'Foto da Fachada',
      score: boolScore(row.fotoFachada),
      weight: 0.1,
    },
    {
      label: 'Referências Comerciais',
      score: filledScore(row.refComerciais),
      weight: 0.25,
    },
    {
      label: 'Referência Bancária',
      score: filledScore(row.refBancaria),
      weight: 0.2,
    },
    {
      label: 'Segmento',
      score: segmentScore(row.segmento),
      weight: 0.15,
    },
    {
      label: 'Tempo de CNPJ',
      score: cnpjTimeScore(row.dataAbertura),
      weight: 0.2,
    },
  ];

  const finalScore = Math.round(
    criteria.reduce((acc, item) => acc + item.score * item.weight, 0),
  );

  const isMEI = normalize(row.tipoEmpresa).toUpperCase() === 'MEI';
  const status = isMEI
    ? 'Reprovado'
    : finalScore > 85
      ? 'Diamante'
      : finalScore >= 60
        ? 'Potencial'
        : finalScore > 0
          ? 'Risco'
          : 'Reprovado';

  return {
    ...row,
    criteria,
    finalScore,
    status,
  };
}

function mapRow(headers, values) {
  const get = (aliases) => {
    const key = headers.find((h) => aliases.includes(h.toLowerCase().trim()));
    return key ? values[headers.indexOf(key)] : '';
  };

  return {
    nomeFantasia: get(['nome fantasia', 'nome_fantasia', 'cliente']),
    cnpj: get(['cnpj']),
    segmento: get(['segmento']),
    contratoSocial: get(['contrato social', 'contrato_social']),
    rgCpfDono: get(['rg/cpf do dono', 'rg cpf do dono', 'rg_cpf_dono']),
    fotoFachada: get(['foto da fachada', 'foto_fachada']),
    refComerciais: get(['ref. comerciais', 'referencias comerciais', 'ref_comerciais']),
    refBancaria: get(['ref. bancária', 'referencia bancaria', 'ref_bancaria']),
    dataAbertura: get(['tempo de cnpj', 'data abertura', 'data de abertura cnpj']),
    tipoEmpresa: get(['tipo empresa', 'tipo de empresa']),
  };
}

function updateKpis(rows) {
  el.kpiTotal.textContent = rows.length;
  el.kpiDiamond.textContent = rows.filter((r) => r.finalScore > 85 && r.status !== 'Reprovado').length;
  el.kpiRisk.textContent = rows.filter((r) => r.finalScore < 60 && r.status === 'Risco').length;
  el.kpiRejected.textContent = rows.filter((r) => r.status === 'Reprovado').length;
}

function getStatusBadge(status) {
  if (status === 'Diamante') return ['🟢 Diamante', 'status status-diamond'];
  if (status === 'Potencial') return ['🟡 Potencial', 'status status-potential'];
  if (status === 'Risco') return ['🟠 Risco', 'status status-risk'];
  return ['🔴 Reprovado', 'status status-rejected'];
}

function renderTable() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
  state.page = Math.min(state.page, totalPages);

  const start = (state.page - 1) * state.perPage;
  const pageRows = state.filtered.slice(start, start + state.perPage);

  el.tableBody.replaceChildren();
  const rowsFragment = document.createDocumentFragment();

  pageRows.forEach((row, idx) => {
    const [label, css] = getStatusBadge(row.status);
    const tr = document.createElement('tr');
    tr.dataset.index = String(start + idx);

    const nomeTd = document.createElement('td');
    nomeTd.textContent = row.nomeFantasia || '-';

    const cnpjTd = document.createElement('td');
    cnpjTd.textContent = row.cnpj || '-';

    const segmentoTd = document.createElement('td');
    segmentoTd.textContent = row.segmento || '-';

    const scoreTd = document.createElement('td');
    scoreTd.textContent = String(row.finalScore);

    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = css;
    badge.textContent = label;
    statusTd.appendChild(badge);

    tr.append(nomeTd, cnpjTd, segmentoTd, scoreTd, statusTd);
    rowsFragment.appendChild(tr);
  });

  el.tableBody.appendChild(rowsFragment);

  el.resultCount.textContent = `${state.filtered.length} resultados`;
  el.pageLabel.textContent = `Página ${state.page} de ${totalPages}`;
  el.prevPage.disabled = state.page === 1;
  el.nextPage.disabled = state.page === totalPages;
}

function openDetails(customer) {
  el.detailName.textContent = customer.nomeFantasia || 'Cliente sem nome';
  el.detailMeta.textContent = `${customer.cnpj || 'CNPJ não informado'} · Score ${customer.finalScore} · ${customer.status}`;
  el.criteriaList.innerHTML = customer.criteria
    .map(
      (c) =>
        `<li><strong>${c.label}</strong><br/>Pontuação: ${c.score} · Peso: ${(c.weight * 100).toFixed(0)}% · Contribuição: ${(c.score * c.weight).toFixed(1)}</li>`,
    )
    .join('');

  el.detailPanel.classList.add('open');
  el.detailPanel.setAttribute('aria-hidden', 'false');
}

function filterRows(query) {
  const q = normalize(query).toLowerCase();
  state.filtered = !q
    ? [...state.rows]
    : state.rows.filter((r) =>
        [r.nomeFantasia, r.cnpj, r.segmento].some((value) =>
          normalize(value).toLowerCase().includes(q),
        ),
      );
  state.page = 1;
  renderTable();
}

async function loadData() {
  el.loading.classList.remove('hidden');
  el.error.classList.add('hidden');

  try {
    const response = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
    const csvText = await response.text();
    const [headerRow, ...dataRows] = parseCsv(csvText);
    const headers = headerRow.map((h) => h.trim());

    state.rows = dataRows
      .map((values) => mapRow(headers, values))
      .filter((row) => normalize(row.nomeFantasia) || normalize(row.cnpj))
      .map((row) => calculateCustomer(row));

    state.filtered = [...state.rows];
    updateKpis(state.rows);
    renderTable();
  } catch (err) {
    el.error.textContent =
      'Não foi possível carregar a planilha. Verifique permissões de compartilhamento e nomes das colunas.';
    el.error.classList.remove('hidden');
    console.error(err);
  } finally {
    el.loading.classList.add('hidden');
  }
}

el.tableBody.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-index]');
  if (!row) return;
  const item = state.filtered[Number(row.dataset.index)];
  if (item) openDetails(item);
});

el.closeDetail.addEventListener('click', () => {
  el.detailPanel.classList.remove('open');
  el.detailPanel.setAttribute('aria-hidden', 'true');
});

el.prevPage.addEventListener('click', () => {
  state.page -= 1;
  renderTable();
});

el.nextPage.addEventListener('click', () => {
  state.page += 1;
  renderTable();
});

el.searchInput.addEventListener('input', (e) => filterRows(e.target.value));
el.refreshBtn.addEventListener('click', loadData);

loadData();
