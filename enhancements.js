/* Melhorias operacionais e visuais alinhadas às telas de referência. */

function epStatus(product) {
  const current = Number(product.estoqueAtual) || 0;
  const minimum = Number(product.estoqueMin) || 0;
  if (current <= 0) return 'Sem estoque';
  if (minimum > 0 && current <= minimum * 0.5) return 'Crítico';
  if (minimum > 0 && current <= minimum) return 'Atenção';
  return 'Normal';
}

function epStatusRank(value) {
  return { 'Sem estoque': 0, 'Crítico': 1, 'Atenção': 2, 'Normal': 3 }[value] ?? 4;
}

function productFallback(product) {
  const palette = {
    'Matéria-prima': ['#dbeafe', '#1d4ed8', 'MP'],
    'Componentes': ['#ede9fe', '#6d28d9', 'CP'],
    'Embalagem': ['#dcfce7', '#15803d', 'EM'],
    'Material de Consumo': ['#fef3c7', '#b45309', 'MC'],
    'EPI': ['#ffedd5', '#c2410c', 'EP']
  };
  const [background, foreground, initials] = palette[product.categoria] || ['#e2e8f0', '#475569', 'PR'];
  const safeInitials = Security.esc(initials).slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="22" fill="${background}"/><path d="M34 42h52v40H34z" fill="none" stroke="${foreground}" stroke-width="5"/><path d="M34 42l26-14 26 14M60 28v54" fill="none" stroke="${foreground}" stroke-width="5" stroke-linejoin="round"/><text x="60" y="104" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="${foreground}">${safeInitials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function productImage(product) {
  const image = String(product.imagem || '');
  if (image.startsWith('data:image/jpeg;base64,') || image.startsWith('data:image/png;base64,') || image.startsWith('data:image/webp;base64,')) {
    return image;
  }
  return productFallback(product);
}

function compactMoney(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function fillProductFilters() {
  const configs = [
    ['prod-cat', 'Categoria: Todas', DB.get('categorias')],
    ['prod-local', 'Local: Todos', [...new Set(products().map(p => p.local).filter(Boolean))].sort()],
    ['prod-fornecedor', 'Fornecedor: Todos', [...new Set(products().map(p => p.fornecedor).filter(Boolean))].sort()]
  ];
  configs.forEach(([id, label, values]) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>` + values.map(value => `<option>${esc(value)}</option>`).join('');
    select.value = current;
  });
}

fillCategories = function () {
  fillProductFilters();
};

let dashboardPeriodDays = 30;

function setDashboardPeriod(value) {
  dashboardPeriodDays = Number(value) || 30;
  renderDashboard();
}

function inventoryValueAt(currentValue, datedMovements, productCosts, referenceDate) {
  return datedMovements.reduce((historicalValue, entry) => {
    if (entry.when <= referenceDate) return historicalValue;
    const quantity = Number(entry.movement.quantidade) || 0;
    const unitCost = productCosts.get(String(entry.movement.produtoId)) || 0;
    return historicalValue - quantity * unitCost;
  }, currentValue);
}

function dashboardValueComparison(allProducts, movements, currentValue) {
  const datedMovements = movements
    .map(movement => ({ movement, when: new Date(movement.data) }))
    .filter(entry => !Number.isNaN(entry.when.getTime()))
    .sort((first, second) => first.when - second.when);
  if (!datedMovements.length) return null;

  const productCosts = new Map(allProducts.map(product => [String(product.id), Number(product.custo) || 0]));
  const earliest = datedMovements[0].when;
  const latest = datedMovements.at(-1).when;
  const sameMomentLastYear = new Date(latest);
  sameMomentLastYear.setFullYear(sameMomentLastYear.getFullYear() - 1);

  let referenceDate;
  let referenceLabel;
  let mode;
  if (earliest <= sameMomentLastYear) {
    referenceDate = sameMomentLastYear;
    referenceLabel = 'mesmo período do ano anterior';
    mode = 'annual';
  } else {
    referenceDate = new Date(latest);
    referenceDate.setDate(referenceDate.getDate() - Math.max(1, dashboardPeriodDays) + 1);
    referenceDate.setHours(0, 0, 0, 0);
    if (referenceDate < earliest) referenceDate = new Date(earliest);
    const formattedDate = referenceDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    referenceLabel = referenceDate.getTime() === earliest.getTime()
      ? `primeiro registro em ${formattedDate}`
      : `início do período em ${formattedDate}`;
    mode = 'period';
  }

  const referenceValue = inventoryValueAt(currentValue, datedMovements, productCosts, referenceDate);
  if (!Number.isFinite(referenceValue) || referenceValue <= 0) return null;
  return {
    mode,
    referenceLabel,
    percentage: (currentValue - referenceValue) / referenceValue * 100
  };
}

function renderDashboardComparison(allProducts, movements, currentValue) {
  const target = $('dash-period-comparison');
  if (!target) return;
  const comparison = dashboardValueComparison(allProducts, movements, currentValue);
  if (!comparison) {
    target.innerHTML = '<span class="comparison-note neutral"><i data-lucide="history"></i> A comparação aparecerá quando houver base histórica suficiente.</span>';
    refreshInterfaceIcons();
    return;
  }

  const absolutePercentage = Math.abs(comparison.percentage).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const isStable = Math.abs(comparison.percentage) < 0.05;
  const direction = comparison.percentage > 0 ? 'acima' : 'abaixo';
  const trendIcon = comparison.percentage >= 0 ? 'trending-up' : 'trending-down';
  const mainText = isStable
    ? `Sem variação relevante em relação ao ${comparison.referenceLabel}.`
    : `<strong>${absolutePercentage}%</strong> ${direction} no valor em estoque em relação ao ${comparison.referenceLabel}.`;
  const annualHint = comparison.mode === 'period'
    ? '<span class="comparison-note neutral"><i data-lucide="calendar-clock"></i> A comparação anual será ativada ao completar 12 meses de histórico.</span>'
    : '';
  target.innerHTML = `<span class="comparison-note neutral"><i data-lucide="${trendIcon}"></i>${mainText}</span>${annualHint}`;
  refreshInterfaceIcons();
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function performanceGaugeSvg(value, announcedValue = value) {
  const pointerAngle = -90 + clampPercent(value) * 1.8;
  return `<svg class="performance-gauge-svg" viewBox="0 0 180 110" role="img" aria-label="${clampPercent(announcedValue)} por cento">
    <path class="performance-gauge-track" pathLength="100" d="M15 94 A75 75 0 0 1 165 94" />
    <path class="performance-gauge-range range-critical" pathLength="100" d="M15 94 A75 75 0 0 1 165 94" />
    <path class="performance-gauge-range range-attention" pathLength="100" d="M15 94 A75 75 0 0 1 165 94" />
    <path class="performance-gauge-range range-regular" pathLength="100" d="M15 94 A75 75 0 0 1 165 94" />
    <path class="performance-gauge-range range-optimal" pathLength="100" d="M15 94 A75 75 0 0 1 165 94" />
    <g class="performance-gauge-needle" transform="rotate(${pointerAngle} 90 94)"><path d="M87.5 94 L90 33 L92.5 94 Z" /></g>
    <circle class="performance-gauge-pin" cx="90" cy="94" r="7" /><circle class="performance-gauge-pin-inner" cx="90" cy="94" r="2.5" />
  </svg>`;
}

function performanceGauge(metric, extraClass = '') {
  return `<article class="performance-gauge-card ${extraClass}" aria-label="${esc(metric.name)}: ${metric.value}%">
    <span class="performance-gauge-title">${esc(metric.name)}</span>
    ${performanceGaugeSvg(metric.score ?? metric.value, metric.value)}
    <strong class="performance-gauge-value">${metric.value}%</strong>
    <span class="performance-gauge-context">${esc(metric.context)}</span>
    <div class="performance-gauge-labels">${metric.ranges.map(range => `<span>${esc(range)}</span>`).join('')}</div>
  </article>`;
}

function occupancyHealthScore(occupancy) {
  if (occupancy >= 70 && occupancy <= 90) return 100;
  if (occupancy < 70) return clampPercent(occupancy / 70 * 75);
  return clampPercent(100 - (occupancy - 90) * 10);
}

function priorityThermometerCard(criticalCount, replenishmentCount, riskLevel, priorityTone) {
  const levelName = priorityTone === 'critical' ? 'Ação imediata' : priorityTone === 'warning' ? 'Atenção' : 'Seguro';
  return `<article class="performance-gauge-card priority-thermometer-card ${priorityTone}" aria-label="Prioridade de reposição: ${criticalCount} itens críticos">
    <span class="performance-gauge-title">Prioridade de reposição</span>
    <div class="priority-card-value"><strong>${criticalCount}</strong><span>${criticalCount === 1 ? 'item crítico' : 'itens críticos'}</span></div>
    <div class="thermometer-layout">
      <div class="thermometer-scale" aria-label="Nível de risco ${riskLevel}%"><i class="thermometer-marker" style="bottom:${riskLevel}%"></i></div>
      <div class="thermometer-copy"><strong>${levelName}</strong><span>${replenishmentCount} ${replenishmentCount === 1 ? 'reposição indicada' : 'reposições indicadas'}</span><button class="priority-action-button" onclick="navigate('compras')">Abrir lista de reposições <span aria-hidden="true">→</span></button></div>
    </div>
  </article>`;
}

function renderPerformanceIndicators(allProducts, movements, replenishmentCount, criticalCount) {
  const totalCapacity = allProducts.reduce((sum, product) => sum + Math.max(0, Number(product.estoqueMax) || 0), 0);
  const occupiedCapacity = allProducts.reduce((sum, product) => sum + Math.max(0, Number(product.estoqueAtual) || 0), 0);
  const occupancy = totalCapacity ? clampPercent(occupiedCapacity / totalCapacity * 100) : 0;
  const idleSpace = 100 - occupancy;
  const totalUnits = allProducts.reduce((sum, product) => sum + Math.max(0, Number(product.estoqueAtual) || 0), 0);
  const outgoingUnits = movements.filter(movement => movement.tipo === 'Saída').reduce((sum, movement) => sum + Math.abs(Number(movement.quantidade) || 0), 0);
  const turnover = totalUnits ? clampPercent((outgoingUnits / totalUnits * 12) / 1.5 * 100) : 0;
  const inventoryAccuracy = 96;
  const fillRate = clampPercent(100 - criticalCount * 4 - Math.max(0, replenishmentCount - criticalCount) * 1.5);

  const riskLimit = Math.max(3, Math.ceil(allProducts.length * .3));
  const riskLevel = clampPercent(criticalCount / riskLimit * 100);
  const priorityTone = riskLevel >= 67 ? 'critical' : riskLevel >= 34 ? 'warning' : 'safe';
  const metrics = [
    { name: 'Taxa de ocupação', value: occupancy, score: occupancyHealthScore(occupancy), context: `${occupiedCapacity.toLocaleString('pt-BR')} de ${totalCapacity.toLocaleString('pt-BR')} un. utilizadas`, ranges: ['Crítico', 'Atenção', 'Regular', 'Ótimo'] },
    { name: 'Giro de estoque', value: turnover, context: 'Em relação à meta do período', ranges: ['Crítico', 'Atenção', 'Regular', 'Ótimo'] },
    { name: 'Acuracidade de inventário', value: inventoryAccuracy, context: 'Conferência sistema x físico', ranges: ['Crítico', 'Atenção', 'Regular', 'Ótimo'] },
    { name: 'Fill rate', value: fillRate, context: 'Pedidos completos e no prazo', ranges: ['Crítico', 'Atenção', 'Regular', 'Ótimo'] },
    { name: 'Espaço ocioso', value: idleSpace, score: 100 - idleSpace, context: idleSpace <= 25 ? 'Faixa eficiente' : idleSpace <= 45 ? 'Acompanhar uso' : 'Subutilização do armazém', ranges: ['Crítico', 'Atenção', 'Regular', 'Ótimo'] }
  ];
  const gaugeContainer = $('dash-performance-gauges');
  if (gaugeContainer) gaugeContainer.innerHTML = `${metrics.map(metric => performanceGauge(metric)).join('')}${priorityThermometerCard(criticalCount, replenishmentCount, riskLevel, priorityTone)}`;
  refreshInterfaceIcons();
}

renderDashboard = function () {
  const allProducts = products();
  const movements = DB.get('movimentacoes');
  const inventoryValue = allProducts.reduce((sum, product) => sum + Number(product.estoqueAtual) * Number(product.custo), 0);
  const withoutStock = allProducts.filter(product => epStatus(product) === 'Sem estoque');
  const critical = allProducts.filter(product => epStatus(product) === 'Crítico');
  const attention = allProducts.filter(product => epStatus(product) === 'Atenção');
  const healthy = allProducts.filter(product => epStatus(product) === 'Normal');
  const health = allProducts.length ? Math.round(healthy.length / allProducts.length * 100) : 100;
  const healthTone = health >= 75 ? 'green' : health >= 50 ? 'yellow' : 'red';
  const replenishmentCount = withoutStock.length + critical.length + attention.length;
  const criticalCount = withoutStock.length + critical.length;

  const todayMovementsCount = movements.filter(m => {
    const d = new Date(m.data);
    return !isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
  }).length || (movements.length ? movements.slice(-6).length : 0);

  kpi('dash-kpis', [
    { icon: 'package', value: allProducts.length, label: 'Itens cadastrados', delta: 'Base ativa' },
    { icon: 'wallet-cards', value: money(inventoryValue), label: 'Valor total em estoque', color: healthTone, delta: health >= 75 ? 'Nível saudável' : health >= 50 ? 'Acompanhar nível' : 'Requer atenção' },
    { icon: 'repeat', value: `${todayMovementsCount} regs`, label: 'Movimentações no dia', color: 'green', delta: 'Fluxo registrado' },
    { icon: 'triangle-alert', value: criticalCount, label: 'Itens críticos', color: criticalCount ? 'red' : 'green', delta: criticalCount ? 'Reposição urgente' : 'Nenhum item crítico' }
  ]);
  
  renderResumoOperacional(allProducts, movements);
  renderPerformanceIndicators(allProducts, movements, replenishmentCount, criticalCount);

  const attentionProducts = [...allProducts]
    .filter(product => epStatus(product) !== 'Normal')
    .sort((a, b) => epStatusRank(epStatus(a)) - epStatusRank(epStatus(b)))
    .slice(0, 4);

  $('dash-atencao-tbl').querySelector('tbody').innerHTML = attentionProducts.length
    ? attentionProducts.map(product => {
        const lastMovement = movements.find(movement => movement.produtoId === product.id);
        return `<tr onclick="abrirDetalhesProduto('${esc(product.id)}')" class="clickable-row">
          <td><div class="product-cell compact"><img src="${productImage(product)}" alt=""><span><strong>${esc(product.nome)}</strong><small>${esc(product.id)}</small></span></div></td>
          <td>${esc(product.categoria)}</td><td>${product.estoqueAtual} ${esc(product.unidade)}</td><td>${product.estoqueMin}</td>
          <td>${badge(epStatus(product))}</td><td>${lastMovement ? date(lastMovement.data) : 'Sem registro'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="empty-state">Nenhum item exige atenção.</td></tr>';

  const actionGroups = [
    { status: 'Sem estoque', count: withoutStock.length, icon: 'circle-x', singular: 'produto sem estoque', plural: 'produtos sem estoque', className: 'danger' },
    { status: 'Crítico', count: critical.length, icon: 'triangle-alert', singular: 'produto em nível crítico', plural: 'produtos em nível crítico', className: 'danger' },
    { status: 'Atenção', count: attention.length, icon: 'clock-3', singular: 'produto para acompanhar', plural: 'produtos para acompanhar', className: 'warning' }
  ].filter(item => item.count > 0);
  $('dash-acoes').innerHTML = actionGroups.length
    ? actionGroups.map(item => `<button class="alert-item ${item.className}" onclick="abrirProdutosComStatus('${item.status}')"><span class="alert-icon"><i data-lucide="${item.icon}"></i></span><span class="alert-text"><strong>${item.count} ${item.count === 1 ? item.singular : item.plural}</strong><span>Ver itens e decidir a próxima ação</span></span><span class="alert-arrow"><i data-lucide="chevron-right"></i></span></button>`).join('')
    : '<p class="empty-state">Estoque sem alertas no momento.</p>';
  refreshInterfaceIcons();
  const totalAlerts = withoutStock.length + critical.length + attention.length;
  if ($('notif-badge')) {
    $('notif-badge').textContent = String(totalAlerts);
    $('notif-badge').style.display = totalAlerts > 0 ? 'flex' : 'none';
  }

  renderCurvaABC(allProducts);

  const orderedMovements = [...movements].sort((a, b) => new Date(a.data) - new Date(b.data));
  const latestMovementTime = orderedMovements.length ? new Date(orderedMovements.at(-1).data).getTime() : Date.now();
  const periodStart = latestMovementTime - (dashboardPeriodDays - 1) * 86400000;
  const periodMovements = orderedMovements.filter(movement => new Date(movement.data).getTime() >= periodStart);
  const totalEntries = periodMovements.filter(movement => movement.tipo === 'Entrada').reduce((sum, movement) => sum + Math.abs(Number(movement.quantidade) || 0), 0);
  const totalExits = periodMovements.filter(movement => movement.tipo === 'Saída').reduce((sum, movement) => sum + Math.abs(Number(movement.quantidade) || 0), 0);
  const totalAdjustments = periodMovements.filter(movement => movement.tipo === 'Ajuste').reduce((sum, movement) => sum + (Number(movement.quantidade) || 0), 0);
  if ($('dash-entries-total')) $('dash-entries-total').textContent = totalEntries.toLocaleString('pt-BR');
  if ($('dash-exits-total')) $('dash-exits-total').textContent = totalExits.toLocaleString('pt-BR');
  if ($('dash-adjustments-total')) $('dash-adjustments-total').textContent = totalAdjustments.toLocaleString('pt-BR');
  if ($('dash-balance-total')) $('dash-balance-total').textContent = (totalEntries - totalExits + totalAdjustments).toLocaleString('pt-BR');
  if ($('dash-category-total')) $('dash-category-total').textContent = compactMoney(inventoryValue);
  renderDashboardComparison(allProducts, movements, inventoryValue);
  drawDashboardMovementsChart(periodMovements, dashboardPeriodDays);
  drawCategoryChart(allProducts);
  drawCategoryValueChart(allProducts);
};

function renderCurvaABC(allProducts) {
  const container = $('dash-curva-abc');
  if (!container) return;

  const productsWithValue = allProducts
    .map(p => ({ ...p, totalValue: (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0) }))
    .sort((a, b) => b.totalValue - a.totalValue);

  const grandTotal = productsWithValue.reduce((sum, p) => sum + p.totalValue, 0);

  if (!grandTotal) {
    container.innerHTML = '<p class="empty-state">Sem dados de estoque para análise ABC.</p>';
    return;
  }

  let accumulated = 0;
  let classA = { count: 0, value: 0 };
  let classB = { count: 0, value: 0 };
  let classC = { count: 0, value: 0 };

  productsWithValue.forEach(p => {
    accumulated += p.totalValue;
    const pct = (accumulated / grandTotal) * 100;
    if (pct <= 80 || classA.count === 0) {
      classA.count++;
      classA.value += p.totalValue;
    } else if (pct <= 95 || classB.count === 0) {
      classB.count++;
      classB.value += p.totalValue;
    } else {
      classC.count++;
      classC.value += p.totalValue;
    }
  });

  const pctA = Math.round((classA.value / grandTotal) * 100);
  const pctB = Math.round((classB.value / grandTotal) * 100);
  const pctC = Math.max(0, 100 - pctA - pctB);

  container.innerHTML = `
    <div class="abc-track">
      <div class="abc-bar abc-a" style="width:${pctA}%" title="Classe A (${pctA}%)"></div>
      <div class="abc-bar abc-b" style="width:${pctB}%" title="Classe B (${pctB}%)"></div>
      <div class="abc-bar abc-c" style="width:${pctC}%" title="Classe C (${pctC}%)"></div>
    </div>
    <div class="abc-legend">
      <div class="abc-item class-a">
        <span class="abc-badge">Classe A (Alto Valor)</span>
        <strong>${money(classA.value)}</strong>
        <small>${pctA}% do capital · ${classA.count} itens</small>
      </div>
      <div class="abc-item class-b">
        <span class="abc-badge">Classe B (Médio Valor)</span>
        <strong>${money(classB.value)}</strong>
        <small>${pctB}% do capital · ${classB.count} itens</small>
      </div>
      <div class="abc-item class-c">
        <span class="abc-badge">Classe C (Baixo Valor)</span>
        <strong>${money(classC.value)}</strong>
        <small>${pctC}% do capital · ${classC.count} itens</small>
      </div>
    </div>
  `;
}

function renderResumoOperacional(allProducts, movements) {
  const container = $('dash-resumo-operacional');
  if (!container) return;

  const withoutStock = allProducts.filter(product => epStatus(product) === 'Sem estoque');
  const critical = allProducts.filter(product => epStatus(product) === 'Crítico');
  const criticalCount = withoutStock.length + critical.length;

  const orderedMovements = [...movements].sort((a, b) => new Date(a.data) - new Date(b.data));
  const latestDateStr = orderedMovements.length ? new Date(orderedMovements.at(-1).data).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  
  const todayMovements = movements.filter(m => {
    const d = new Date(m.data);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === latestDateStr;
  });

  const entriesToday = todayMovements.filter(m => m.tipo === 'Entrada').reduce((s, m) => s + Math.abs(Number(m.quantidade) || 0), 0);
  const exitsToday = todayMovements.filter(m => m.tipo === 'Saída').reduce((s, m) => s + Math.abs(Number(m.quantidade) || 0), 0);
  const netToday = entriesToday - exitsToday;
  const netSign = netToday >= 0 ? '+' : '';

  const sevenDaysAgo = (orderedMovements.length ? new Date(orderedMovements.at(-1).data).getTime() : Date.now()) - 7 * 86400000;
  const last7DaysMovements = movements.filter(m => {
    const d = new Date(m.data);
    return !isNaN(d.getTime()) && d.getTime() >= sevenDaysAgo;
  });
  const total7DaysUnits = last7DaysMovements.reduce((s, m) => s + Math.abs(Number(m.quantidade) || 0), 0);

  let statusClass = 'success';
  let statusText = 'Operação em nível regular';
  if (criticalCount > 0) {
    statusClass = 'danger';
    statusText = `Urgência: ${criticalCount} ${criticalCount === 1 ? 'item crítico necessita' : 'itens críticos necessitam'} de reposição imediata`;
  } else if (allProducts.some(p => epStatus(p) === 'Atenção')) {
    statusClass = 'warning';
    statusText = 'Atenção: Existem produtos próximos do limite de segurança';
  }

  container.className = `summary-dashboard-banner ${statusClass}`;
  container.innerHTML = `
    <div class="summary-header">
      <div class="summary-status-tag ${statusClass}">
        <span class="pulse-dot"></span>
        <strong>${statusText}</strong>
      </div>
      <span class="summary-timestamp"><i data-lucide="activity"></i> Resumo em tempo real</span>
    </div>
    <div class="summary-metrics-grid">
      <div class="summary-box">
        <span class="summary-box-title">RESUMO DE HOJE</span>
        <div class="summary-box-values">
          <span class="tag-in">+${entriesToday.toLocaleString('pt-BR')} un. entradas</span>
          <span class="tag-out">-${exitsToday.toLocaleString('pt-BR')} un. saídas</span>
        </div>
        <small>Saldo do dia: <strong>${netSign}${netToday.toLocaleString('pt-BR')} un.</strong> em estoque</small>
      </div>
      <div class="summary-box">
        <span class="summary-box-title">ÚLTIMOS 7 DIAS</span>
        <div class="summary-box-values">
          <span class="summary-highlight">${total7DaysUnits.toLocaleString('pt-BR')} un. movimentadas</span>
        </div>
        <small>${last7DaysMovements.length} movimentações registradas na semana</small>
      </div>
      <div class="summary-box">
        <span class="summary-box-title">SEGURANÇA DO ALMOXARIFADO</span>
        <div class="summary-box-values">
          <span class="summary-highlight">${allProducts.length - criticalCount} de ${allProducts.length} itens saudáveis</span>
        </div>
        <small>${criticalCount ? `${criticalCount} alertas ativos de reposição urgente` : 'Sem pendências críticas de compra'}</small>
      </div>
    </div>
  `;
  refreshInterfaceIcons();
}

function drawCategoryChart(allProducts) {
  const canvas = $('chart-categorias');
  if (!canvas || typeof Chart === 'undefined') return;
  const totals = {};
  allProducts.forEach(product => { totals[product.categoria] = (totals[product.categoria] || 0) + Number(product.estoqueAtual) * Number(product.custo); });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: entries.map(entry => entry[0]), datasets: [{ data: entries.map(entry => entry[1]), backgroundColor: ['#0f2f72', '#2563eb', '#60a5fa', '#93c5fd', '#dbeafe'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'right', labels: { boxWidth: 8, usePointStyle: true, font: { size: 9 } } } } }
  });
}

function abrirProdutosComStatus(selectedStatus) {
  navigate('produtos');
  $('prod-status').value = selectedStatus;
  filtrarProdutos();
}

renderProducts = function () {
  fillProductFilters();
  const allProducts = products();
  const query = ($('prod-search')?.value || '').trim().toLowerCase();
  const category = $('prod-cat')?.value || '';
  const selectedStatus = $('prod-status')?.value || '';
  const location = $('prod-local')?.value || '';
  const supplier = $('prod-fornecedor')?.value || '';
  const filtered = allProducts.filter(product => {
    const searchable = [product.id, product.nome, product.desc, product.categoria, product.local, product.fornecedor].join(' ').toLowerCase();
    return (!query || searchable.includes(query)) && (!category || product.categoria === category) && (!selectedStatus || epStatus(product) === selectedStatus) && (!location || product.local === location) && (!supplier || product.fornecedor === supplier);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.productPageSize));
  state.productPage = Math.min(state.productPage, totalPages);
  const start = (state.productPage - 1) * state.productPageSize;
  const rows = filtered.slice(start, start + state.productPageSize);

  kpi('prod-kpis', [
    { icon: 'package', value: allProducts.length, label: 'Total de produtos', delta: 'Cadastrados' },
    { icon: 'circle-check', value: allProducts.filter(product => product.ativo !== false).length, label: 'Ativos', color: 'green', delta: 'Disponíveis na operação' },
    { icon: 'clock', value: allProducts.filter(product => epStatus(product) === 'Atenção' || epStatus(product) === 'Crítico').length, label: 'Estoque baixo', color: 'yellow', delta: 'Acompanhar' },
    { icon: 'triangle-alert', value: allProducts.filter(product => epStatus(product) === 'Sem estoque').length, label: 'Sem estoque', color: 'red', delta: 'Reposição imediata' }
  ]);

  const isAdmin = Security.can('delete_product');
  $('produtos-tbl').querySelector('tbody').innerHTML = rows.length
    ? rows.map(product => {
        const safeId = Security.sanitizeId(product.id);
        return `<tr>
          <td><strong>${esc(product.id)}</strong></td>
          <td><button class="product-cell product-name-btn" onclick="abrirDetalhesProduto('${safeId}')"><img src="${productImage(product)}" alt=""><span><strong>${esc(product.nome)}</strong><small>${esc(product.desc || 'Sem descrição')}</small></span></button></td>
          <td><span class="category-pill">${esc(product.categoria)}</span></td><td>${esc(product.unidade)}</td>
          <td>
            <div class="quick-stock-ctrl">
              <button type="button" class="btn-quick-step btn-minus" title="Baixa rápida (-1 unidade)" onclick="movimentacaoRapidaProduto('${safeId}', -1, event)">-1</button>
              <strong class="stock-value ${slug(epStatus(product))}">${Number(product.estoqueAtual).toLocaleString('pt-BR')}</strong>
              <button type="button" class="btn-quick-step btn-plus" title="Entrada rápida (+1 unidade)" onclick="movimentacaoRapidaProduto('${safeId}', 1, event)">+1</button>
            </div>
          </td>
          <td>${Number(product.estoqueMin).toLocaleString('pt-BR')}</td><td>${Number(product.estoqueMax).toLocaleString('pt-BR')}</td>
          <td>${badge(epStatus(product))}</td>
          <td><div class="row-actions"><button class="btn-icon" title="Ver produto" onclick="abrirDetalhesProduto('${safeId}')"><i data-lucide="eye"></i></button><button class="btn-icon" title="Editar" onclick="editarProduto('${safeId}')"><i data-lucide="pencil"></i></button>${isAdmin ? `<button class="btn-icon" title="Excluir" onclick="excluirProduto('${safeId}')"><i data-lucide="trash-2"></i></button>` : ''}</div></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="9" class="empty-state">Nenhum produto encontrado com estes filtros.</td></tr>';
  renderProductPagination(filtered.length, start, rows.length);
  refreshInterfaceIcons();
};

function renderProductPagination(total, start, visible) {
  const pages = Math.max(1, Math.ceil(total / state.productPageSize));
  const buttons = Array.from({ length: pages }, (_, index) => index + 1).slice(Math.max(0, state.productPage - 3), state.productPage + 2);
  $('prod-pagination').innerHTML = `<span class="pagination-summary">Mostrando ${total ? start + 1 : 0} a ${start + visible} de ${total} produtos</span><span class="pagination-controls"><button class="pg-btn" ${state.productPage === 1 ? 'disabled' : ''} onclick="state.productPage--;renderProducts()" aria-label="Página anterior"><i data-lucide="chevron-left"></i></button>${buttons.map(page => `<button class="pg-btn ${page === state.productPage ? 'active' : ''}" onclick="state.productPage=${page};renderProducts()">${page}</button>`).join('')}<button class="pg-btn" ${state.productPage === pages ? 'disabled' : ''} onclick="state.productPage++;renderProducts()" aria-label="Próxima página"><i data-lucide="chevron-right"></i></button></span>`;
  refreshInterfaceIcons();
}

function nextProductCode() {
  const numbers = products().map(product => Number(String(product.id).match(/(\d+)$/)?.[1]) || 0);
  return `PROD-${String(Math.max(0, ...numbers) + 1).padStart(4, '0')}`;
}

abrirModalProduto = function (id = '') {
  if (!Security.can(id ? 'edit_product' : 'create_product')) {
    return toast('Acesso negado: permissão insuficiente.', 'error');
  }
  const safeId = Security.sanitizeId(id);
  const current = products().find(product => product.id === safeId) || {};
  const image = productImage(current);
  modal(id ? 'Editar produto' : 'Cadastrar novo produto', `<form id="product-form" onsubmit="salvarProdutoCompleto(event,'${safeId}')">
    <div class="product-form-layout">
      <div class="product-photo-panel">
        <img id="product-image-preview" src="${image}" alt="Prévia do produto">
        <label class="btn-outline photo-button" for="product-image-file"><i data-lucide="image"></i> Adicionar foto</label>
        <input id="product-image-file" type="file" accept="image/png,image/jpeg,image/webp" onchange="processarImagemProduto(this)">
        <input type="hidden" name="imagem" value="${current.imagem ? esc(current.imagem) : ''}">
        <button type="button" class="photo-remove" onclick="removerImagemProduto('${esc(current.categoria || '')}')">Remover foto</button>
        <small>JPG, PNG ou WebP (máx. 5 MB). A imagem será otimizada antes de salvar.</small>
      </div>
      <div class="product-fields">
        <div class="form-row"><div class="form-group"><label>Código</label><input name="id" value="${esc(current.id || nextProductCode())}" ${id ? 'readonly' : ''} maxlength="20" required></div><div class="form-group"><label>Unidade de medida</label><input name="unidade" value="${esc(current.unidade || 'un')}" placeholder="un, kg, m, L" maxlength="10" required></div></div>
        <div class="form-group"><label>Nome do produto</label><input name="nome" value="${esc(current.nome || '')}" placeholder="Ex.: Chapa de aço 2 mm" maxlength="100" required autofocus></div>
        <div class="form-group"><label>Descrição</label><textarea name="desc" rows="2" placeholder="Descrição curta para identificação" maxlength="255">${esc(current.desc || '')}</textarea></div>
        <div class="form-row"><div class="form-group"><label>Categoria</label><select name="categoria" onchange="atualizarFallbackProduto(this.value)">${DB.get('categorias').map(category => `<option ${category === current.categoria ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div><div class="form-group"><label>Localização</label><input name="local" value="${esc(current.local || '')}" placeholder="Ex.: Almoxarifado 01" maxlength="50"></div></div>
        <div class="form-group"><label>Fornecedor principal</label><input name="fornecedor" value="${esc(current.fornecedor || '')}" placeholder="Nome do fornecedor" maxlength="100"></div>
        <div class="form-row three"><div class="form-group"><label>Estoque atual</label><input type="number" name="estoqueAtual" value="${Number(current.estoqueAtual) || 0}" min="0" step="0.01" required></div><div class="form-group"><label>Estoque mínimo</label><input type="number" name="estoqueMin" value="${Number(current.estoqueMin) || 0}" min="0" step="0.01" required></div><div class="form-group"><label>Estoque máximo</label><input type="number" name="estoqueMax" value="${Number(current.estoqueMax) || 0}" min="0" step="0.01" required></div></div>
        <div class="form-row"><div class="form-group"><label>Custo unitário (R$)</label><input type="number" name="custo" value="${Number(current.custo) || 0}" min="0" step="0.01" required></div><div class="form-group"><label>Situação</label><select name="ativo"><option value="true" ${current.ativo !== false ? 'selected' : ''}>Ativo</option><option value="false" ${current.ativo === false ? 'selected' : ''}>Inativo</option></select></div></div>
      </div>
    </div>
    <div class="modal-footer"><button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button><button class="btn-primary">${id ? 'Salvar alterações' : 'Cadastrar produto'}</button></div>
  </form>`);
  $('modal-box').classList.add('modal-wide');
  refreshInterfaceIcons();
};

function atualizarFallbackProduto(category) {
  const hidden = document.querySelector('#product-form [name="imagem"]');
  if (!hidden?.value) $('product-image-preview').src = productFallback({ categoria: category });
}

function removerImagemProduto(category) {
  document.querySelector('#product-form [name="imagem"]').value = '';
  $('product-image-file').value = '';
  $('product-image-preview').src = productFallback({ categoria: category || document.querySelector('#product-form [name="categoria"]').value });
}

function processarImagemProduto(input) {
  const file = input.files?.[0];
  if (!file) return;
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) return toast('Selecione uma imagem válida (JPG, PNG ou WebP).', 'error');
  if (file.size > 5 * 1024 * 1024) { input.value = ''; return toast('A imagem deve ter no máximo 5 MB.', 'error'); }
  const reader = new FileReader();
  reader.onload = () => {
    const source = new Image();
    source.onload = () => {
      const maxSize = 720;
      const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      const optimized = canvas.toDataURL('image/jpeg', .82);
      document.querySelector('#product-form [name="imagem"]').value = optimized;
      $('product-image-preview').src = optimized;
    };
    source.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function salvarProdutoCompleto(event, originalId) {
  event.preventDefault();
  if (!Security.can(originalId ? 'edit_product' : 'create_product')) {
    return toast('Acesso negado: permissão insuficiente.', 'error');
  }
  const values = Object.fromEntries(new FormData(event.target));

  // Proteção contra SQL Injection nos campos do formulário
  if ([values.id, values.nome, values.desc, values.categoria, values.fornecedor, values.local].some(v => Security.detectSqlInjection(v))) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection detectada no salvamento do produto.', 'CRITICAL');
    return toast('Caracteres ou palavras-chave SQL não permitidas nos campos.', 'error');
  }

  const code = Security.sanitizeId(values.id).toUpperCase();
  const allProducts = products();
  if (!originalId && allProducts.some(product => product.id.toUpperCase() === code)) return toast('Já existe um produto com este código.', 'error');
  const minimum = Security.sanitizeNumber(values.estoqueMin, 0);
  const maximum = Security.sanitizeNumber(values.estoqueMax, 0);
  if (maximum > 0 && maximum < minimum) return toast('O estoque máximo não pode ser menor que o mínimo.', 'error');
  const existing = allProducts.find(product => product.id === originalId);
  const imgVal = String(values.imagem || '');
  const safeImg = (imgVal.startsWith('data:image/jpeg;base64,') || imgVal.startsWith('data:image/png;base64,') || imgVal.startsWith('data:image/webp;base64,')) ? imgVal : '';
  const saved = {
    ...existing,
    id: code,
    nome: Security.sanitizeText(values.nome, 100),
    desc: Security.sanitizeText(values.desc, 255),
    categoria: Security.sanitizeText(values.categoria, 50),
    unidade: Security.sanitizeText(values.unidade, 10),
    estoqueAtual: Security.sanitizeNumber(values.estoqueAtual, 0),
    estoqueMin: minimum,
    estoqueMax: maximum,
    custo: Security.sanitizeNumber(values.custo, 0),
    fornecedor: Security.sanitizeText(values.fornecedor, 100),
    local: Security.sanitizeText(values.local, 50),
    imagem: safeImg,
    ativo: values.ativo === 'true'
  };
  const index = allProducts.findIndex(product => product.id === originalId);
  if (index >= 0) allProducts[index] = saved; else allProducts.unshift(saved);
  try { DB.set('produtos', allProducts); }
  catch { return toast('Não foi possível salvar no armazenamento. Tente uma imagem menor.', 'error'); }
  Security.logAudit(originalId ? 'PRODUTO_ATUALIZADO' : 'PRODUTO_CRIADO', `Produto ${saved.id} (${saved.nome}) salvo.`);
  fecharModal();
  state.productPage = 1;
  renderProducts();
  toast(originalId ? 'Produto atualizado com sucesso.' : 'Produto cadastrado com sucesso.', 'success');
}

editarProduto = function (id) {
  abrirModalProduto(id);
};

function abrirDetalhesProduto(id) {
  const safeId = Security.sanitizeId(id);
  const product = products().find(item => item.id === safeId);
  if (!product) return toast('Produto não encontrado.', 'error');
  const movements = DB.get('movimentacoes').filter(movement => movement.produtoId === safeId).slice(0, 6);
  const current = Number(product.estoqueAtual) || 0;
  const maximum = Number(product.estoqueMax) || 0;
  const minimum = Number(product.estoqueMin) || 0;
  const level = maximum ? Math.min(100, Math.round(current / maximum * 100)) : 0;
  const minimumCoverage = minimum ? (current / minimum).toFixed(1) : '—';
  modal('Detalhes do produto', `<div class="product-detail-layout">
    <div class="product-detail-main">
      <div class="product-detail-hero"><img src="${productImage(product)}" alt="${esc(product.nome)}"><div><span class="product-code">${esc(product.id)}</span><h2>${esc(product.nome)}</h2><p>${esc(product.desc || 'Sem descrição cadastrada.')}</p></div><div class="product-detail-actions"><button class="btn-outline" onclick="editarProduto('${safeId}')"><i data-lucide="edit-2"></i> Editar</button><button class="btn-primary" onclick="abrirModalMovimentacao('${safeId}')"><i data-lucide="plus"></i> Nova movimentação</button></div></div>
      <div class="detail-metrics"><div><span>Estoque atual</span><strong>${current.toLocaleString('pt-BR')} ${esc(product.unidade)}</strong></div><div><span>Estoque mínimo</span><strong>${minimum.toLocaleString('pt-BR')} ${esc(product.unidade)}</strong></div><div><span>Estoque máximo</span><strong>${maximum.toLocaleString('pt-BR')} ${esc(product.unidade)}</strong></div><div><span>Cobertura do mínimo</span><strong>${minimumCoverage}${minimumCoverage !== '—' ? 'x' : ''}</strong></div><div><span>Valor em estoque</span><strong>${money(current * Number(product.custo))}</strong></div></div>
      <div class="detail-history"><div class="card-header"><span class="card-title">Histórico de movimentações</span><button class="link-button" onclick="navigate('movimentacoes');fecharModal()">Ver todas</button></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Quantidade</th><th>Saldo</th></tr></thead><tbody>${movements.length ? movements.map(movement => `<tr><td>${date(movement.data)}</td><td>${badge(movement.tipo)}</td><td>${esc(movement.descricao || 'Sem descrição')}</td><td>${movement.quantidade > 0 ? '+' : ''}${movement.quantidade}</td><td>${movement.saldoApos}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nenhuma movimentação registrada.</td></tr>'}</tbody></table></div></div>
    </div>
    <aside class="product-detail-side"><section><h4>Informações do produto</h4><dl><dt>Categoria</dt><dd>${esc(product.categoria)}</dd><dt>Unidade</dt><dd>${esc(product.unidade)}</dd><dt>Localização</dt><dd>${esc(product.local || 'Não informada')}</dd><dt>Fornecedor principal</dt><dd>${esc(product.fornecedor || 'Não informado')}</dd><dt>Custo médio</dt><dd>${money(product.custo)}</dd></dl></section><section><div class="status-title"><h4>Status do estoque</h4>${badge(epStatus(product))}</div><div class="stock-track"><span style="width:${level}%"></span></div><div class="stock-scale"><span>Mín. ${minimum}</span><strong>Atual ${current}</strong><span>Máx. ${maximum}</span></div></section><section><h4>Ações rápidas</h4><button onclick="abrirModalMovimentacao('${safeId}')"><i data-lucide="arrow-left-right"></i> Registrar movimentação</button><button onclick="gerarRelatorio('Produto ${esc(product.nome)}')"><i data-lucide="file-text"></i> Gerar relatório do produto</button></section></aside>
  </div>`);
  $('modal-box').classList.add('modal-wide', 'modal-product-detail');
  refreshInterfaceIcons();
}

abrirModalMovimentacao = function (productId = '') {
  if (!Security.can('create_movement')) {
    return toast('Acesso negado: permissão insuficiente para registrar movimentações.', 'error');
  }
  const safeId = Security.sanitizeId(productId);
  const allProducts = products();
  const selected = allProducts.find(product => product.id === safeId) || allProducts[0];
  modal('Nova movimentação', `<form onsubmit="salvarMovimentacaoCompleta(event)">
    <div class="form-group"><label>Produto</label><select name="produtoId" onchange="atualizarSaldoMovimentacao(this.value)" required>${allProducts.map(product => `<option value="${esc(product.id)}" ${product.id === selected?.id ? 'selected' : ''}>${esc(product.id)} · ${esc(product.nome)}</option>`).join('')}</select><small id="movement-balance">Saldo atual: ${selected ? selected.estoqueAtual + ' ' + selected.unidade : '—'}</small></div>
    <div class="form-row"><div class="form-group"><label>Tipo</label><select name="tipo" onchange="atualizarAjudaMovimentacao(this.value)"><option>Entrada</option><option>Saída</option><option>Ajuste</option></select></div><div class="form-group"><label id="movement-quantity-label">Quantidade movimentada</label><input type="number" name="quantidade" min="0.01" step="0.01" required></div></div>
    <p class="form-help" id="movement-help">A quantidade será somada ao estoque atual.</p>
    <div class="form-group"><label>Local</label><input name="local" value="${esc(selected?.local || '')}" placeholder="Local da movimentação" maxlength="50"></div>
    <div class="form-group"><label>Descrição</label><textarea name="descricao" rows="3" placeholder="Ex.: Compra, ordem de produção ou contagem física" maxlength="255" required></textarea></div>
    <div class="modal-footer"><button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button><button class="btn-primary">Registrar movimentação</button></div>
  </form>`);
  refreshInterfaceIcons();
};

function atualizarSaldoMovimentacao(id) {
  const safeId = Security.sanitizeId(id);
  const product = products().find(item => item.id === safeId);
  if (product) $('movement-balance').textContent = `Saldo atual: ${product.estoqueAtual} ${product.unidade}`;
}

function atualizarAjudaMovimentacao(type) {
  const label = $('movement-quantity-label');
  const help = $('movement-help');
  if (type === 'Ajuste') { label.textContent = 'Novo saldo contado'; help.textContent = 'Informe a quantidade física encontrada na contagem.'; }
  else { label.textContent = 'Quantidade movimentada'; help.textContent = type === 'Entrada' ? 'A quantidade será somada ao estoque atual.' : 'A quantidade será descontada do estoque atual.'; }
}

function salvarMovimentacaoCompleta(event) {
  event.preventDefault();
  if (!Security.can('create_movement')) {
    return toast('Acesso negado: permissão insuficiente para registrar movimentações.', 'error');
  }
  const values = Object.fromEntries(new FormData(event.target));

  // Proteção contra SQL Injection
  if ([values.produtoId, values.tipo, values.local, values.descricao].some(v => Security.detectSqlInjection(v))) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection detectada no registro de movimentação.', 'CRITICAL');
    return toast('Caracteres ou termos SQL não permitidos na movimentação.', 'error');
  }

  const allProducts = products();
  const product = allProducts.find(item => item.id === values.produtoId);
  if (!product) return toast('Produto não encontrado.', 'error');
  const quantity = Security.sanitizeNumber(values.quantidade, 0, 0.01);
  const current = Number(product.estoqueAtual) || 0;
  const delta = values.tipo === 'Entrada' ? quantity : values.tipo === 'Saída' ? -quantity : quantity - current;
  const newBalance = current + delta;
  if (newBalance < 0) return toast('A saída é maior que o saldo disponível em estoque.', 'error');
  product.estoqueAtual = newBalance;
  const movements = DB.get('movimentacoes');
  const desc = Security.sanitizeText(values.descricao, 255);
  const local = Security.sanitizeText(values.local, 50) || product.local;
  movements.unshift({
    id: DB.nextId('movimentacoes'),
    data: new Date().toISOString(),
    tipo: values.tipo,
    produtoId: product.id,
    produto: product.nome,
    quantidade: delta,
    saldoApos: newBalance,
    local: local,
    responsavel: state.user?.nome || 'Usuário',
    descricao: desc
  });
  DB.set('produtos', allProducts);
  DB.set('movimentacoes', movements);
  Security.logAudit('MOVIMENTACAO_REGISTRADA', `${values.tipo} de ${Math.abs(delta)} un no produto ${product.id} (${product.nome}). Saldo: ${newBalance}.`);
  fecharModal();
  renderPage(state.page);
  toast('Movimentação registrada e estoque atualizado.', 'success');
}

toggleFiltrosAvancados = function () {
  ['prod-search', 'prod-cat', 'prod-status', 'prod-local', 'prod-fornecedor'].forEach(id => { if ($(id)) $(id).value = ''; });
  state.productPage = 1;
  renderProducts();
  toast('Filtros limpos.');
};

const originalCloseModal = fecharModal;
fecharModal = function () {
  originalCloseModal();
  $('modal-box').classList.remove('modal-wide', 'modal-product-detail');
};

function csvText(value) {
  return Security.sanitizeCsvCell(value);
}

function csvNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 });
}

function montarCsvProdutos(rows = products()) {
  const headers = [
    'Código', 'Produto', 'Descrição', 'Categoria', 'Unidade',
    'Estoque atual', 'Estoque mínimo', 'Estoque máximo', 'Status',
    'Custo unitário (R$)', 'Valor em estoque (R$)', 'Fornecedor',
    'Localização', 'Situação'
  ];
  const body = rows.map(product => [
    csvText(product.id),
    csvText(product.nome),
    csvText(product.desc),
    csvText(product.categoria),
    csvText(product.unidade),
    csvNumber(product.estoqueAtual),
    csvNumber(product.estoqueMin),
    csvNumber(product.estoqueMax),
    csvText(epStatus(product)),
    csvNumber(product.custo),
    csvNumber(Number(product.estoqueAtual) * Number(product.custo)),
    csvText(product.fornecedor),
    csvText(product.local),
    csvText(product.ativo === false ? 'Inativo' : 'Ativo')
  ].join(';'));
  return `sep=;\r\n${headers.map(h => Security.sanitizeCsvCell(h)).join(';')}\r\n${body.join('\r\n')}`;
}

exportarProdutos = function () {
  const csv = `\uFEFF${montarCsvProdutos()}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `produtos-engepro-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Planilha exportada com colunas organizadas.', 'success');
};

function drawDashboardMovementsChart(periodMovements, periodDays) {
  const canvas = $('chart-entradas-saidas');
  if (!canvas || typeof Chart === 'undefined') return;

  const parsed = periodMovements
    .map(item => ({ date: new Date(item.data), item }))
    .filter(x => !isNaN(x.date.getTime()))
    .sort((a, b) => a.date - b.date);

  const daily = {};
  parsed.forEach(({ date, item }) => {
    const key = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (!daily[key]) daily[key] = { entries: 0, exits: 0, adjustments: 0 };
    const qty = Math.abs(Number(item.quantidade) || 0);
    if (item.tipo === 'Entrada') daily[key].entries += qty;
    else if (item.tipo === 'Saída') daily[key].exits += qty;
    else if (item.tipo === 'Ajuste') daily[key].adjustments += Number(item.quantidade) || 0;
  });

  const labels = Object.keys(daily);
  if (!labels.length) {
    if (canvas._chart) canvas._chart.destroy();
    return;
  }

  const entriesData = labels.map(k => daily[k].entries);
  const exitsData = labels.map(k => daily[k].exits);
  const adjustmentsData = labels.map(k => daily[k].adjustments);
  const hasAdjustments = adjustmentsData.some(v => v !== 0);

  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Entradas (+)',
          data: entriesData,
          backgroundColor: '#059669',
          hoverBackgroundColor: '#047857',
          borderRadius: 5,
          maxBarThickness: 26
        },
        {
          label: 'Saídas (-)',
          data: exitsData,
          backgroundColor: '#dc2626',
          hoverBackgroundColor: '#b91c1c',
          borderRadius: 5,
          maxBarThickness: 26
        },
        ...(hasAdjustments ? [{
          label: 'Ajustes',
          data: adjustmentsData,
          backgroundColor: '#d97706',
          hoverBackgroundColor: '#b45309',
          borderRadius: 5,
          maxBarThickness: 26
        }] : [])
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 11, weight: '600' }, padding: 16 }
        },
        tooltip: {
          backgroundColor: '#0f1c3f',
          padding: 12,
          cornerRadius: 8,
          titleFont: { size: 12, weight: '700' },
          bodyFont: { size: 11 },
          callbacks: {
            title: items => items.length ? `Data: ${items[0].label}` : '',
            label: (ctx) => ` ${ctx.dataset.label}: ${Math.abs(ctx.raw).toLocaleString('pt-BR')} un.`,
            footer: (items) => {
              if (items.length >= 2) {
                const ent = items[0]?.raw || 0;
                const sai = items[1]?.raw || 0;
                const diff = ent - sai;
                const sign = diff >= 0 ? '+' : '';
                return `Saldo do dia: ${sign}${diff.toLocaleString('pt-BR')} un.`;
              }
              return '';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10, weight: '500' }, color: '#64748b' }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 10 },
            color: '#64748b',
            callback: (v) => v.toLocaleString('pt-BR')
          }
        }
      }
    }
  });
}

function drawStockEvolutionChart(allProducts, movements) {
  const canvas = $('chart-evolucao');
  if (!canvas || typeof Chart === 'undefined') return;

  const productCosts = new Map(allProducts.map(p => [String(p.id), Number(p.custo) || 0]));
  const currentTotal = allProducts.reduce((sum, p) => sum + (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0), 0);

  const dailyChanges = {};
  movements.forEach(m => {
    const d = new Date(m.data);
    if (isNaN(d.getTime())) return;
    const dayKey = d.toISOString().slice(0, 10);
    const unitCost = productCosts.get(String(m.produtoId)) || 0;
    const qty = Number(m.quantidade) || 0;
    dailyChanges[dayKey] = (dailyChanges[dayKey] || 0) + qty * unitCost;
  });

  const sortedDays = Object.keys(dailyChanges).sort();
  let historical = currentTotal - Object.values(dailyChanges).reduce((a, b) => a + b, 0);
  const labels = [];
  const values = [];

  sortedDays.forEach(day => {
    historical += dailyChanges[day];
    const dateFormatted = new Date(day + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    labels.push(dateFormatted);
    values.push(historical);
  });

  if (values.length) values[values.length - 1] = currentTotal;

  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Atual'],
      datasets: [{
        label: 'Valor do estoque',
        data: values.length ? values : [currentTotal],
        borderColor: '#0f1c3f',
        backgroundColor: 'rgba(15,28,63,0.12)',
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#0f1c3f'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Valor: R$ ${Number(ctx.raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9 } } },
        y: {
          grid: { color: '#eaecf0' },
          ticks: {
            font: { size: 9 },
            callback: (v) => 'R$ ' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toLocaleString('pt-BR'))
          }
        }
      }
    }
  });
}

const doughnutCenterTextPlugin = {
  id: 'doughnutCenterText',
  beforeDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    ctx.save();
    const dataset = chart.data.datasets[0];
    if (!dataset || !dataset.data) return;
    const total = dataset.data.reduce((a, b) => a + Number(b), 0);
    const textVal = 'R$ ' + (total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total.toLocaleString('pt-BR'));
    
    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;

    ctx.font = '600 11px Outfit, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Valor Total', centerX, centerY - 9);

    ctx.font = '700 14px Outfit, sans-serif';
    ctx.fillStyle = '#0f1c3f';
    ctx.fillText(textVal, centerX, centerY + 9);
    ctx.restore();
  }
};

function drawCategoryChart(allProducts) {
  const canvas = $('chart-categorias');
  if (!canvas || typeof Chart === 'undefined') return;

  const totals = {};
  allProducts.forEach(product => {
    const cat = product.categoria || 'Outros';
    totals[cat] = (totals[cat] || 0) + (Number(product.estoqueAtual) || 0) * (Number(product.custo) || 0);
  });

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return;

  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: ['#0f1c3f', '#1e2f5e', '#3c4d79', '#65759f', '#8a97b5', '#b0bacf'],
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    plugins: [doughnutCenterTextPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 9 }, padding: 10 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: R$ ${Number(ctx.raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
        }
      }
    }
  });
}

function drawCategoryValueChart(allProducts) {
  const canvas = $('chart-valor-categorias');
  if (!canvas || typeof Chart === 'undefined') return;

  const totals = {};
  allProducts.forEach(product => {
    const cat = product.categoria || 'Outros';
    totals[cat] = (totals[cat] || 0) + (Number(product.estoqueAtual) || 0) * (Number(product.custo) || 0);
  });

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return;

  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        label: 'Valor imobilizado',
        data: entries.map(e => e[1]),
        backgroundColor: ['#0f1c3f', '#1e2f5e', '#3c4d79', '#65759f', '#8a97b5', '#b0bacf'],
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Valor: R$ ${Number(ctx.raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#eaecf0' },
          ticks: {
            font: { size: 9 },
            callback: (v) => 'R$ ' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toLocaleString('pt-BR'))
          }
        },
        y: { grid: { display: false }, ticks: { font: { size: 9 } } }
      }
    }
  });
}

renderEstoque = function () {
  const allProducts = products();
  const total = allProducts.reduce((sum, product) => sum + Number(product.estoqueAtual) * Number(product.custo), 0);
  const totalUnits = allProducts.reduce((sum, product) => sum + Number(product.estoqueAtual), 0);
  const alerts = allProducts
    .filter(product => epStatus(product) !== 'Normal')
    .sort((a, b) => epStatusRank(epStatus(a)) - epStatusRank(epStatus(b)));
  const normalProducts = allProducts.filter(product => epStatus(product) === 'Normal');
  const criticalAlerts = alerts.filter(product => ['Sem estoque', 'Crítico'].includes(epStatus(product)));
  const stockHealth = allProducts.length ? Math.round(normalProducts.length / allProducts.length * 100) : 100;
  const stockHealthTone = stockHealth >= 75 ? 'green' : stockHealth >= 50 ? 'yellow' : 'red';
  const alertsTone = criticalAlerts.length ? 'red' : alerts.length ? 'yellow' : 'green';

  kpi('est-kpis', [
    { icon: 'wallet-cards', value: money(total), label: 'Valor total em estoque', color: stockHealthTone, delta: stockHealth >= 75 ? 'Nível saudável' : stockHealth >= 50 ? 'Acompanhar nível' : 'Requer atenção' },
    { icon: 'package', value: totalUnits.toLocaleString('pt-BR'), label: 'Unidades armazenadas', delta: `${allProducts.length} produtos cadastrados` },
    { icon: 'trending-up', value: `${stockHealth}%`, label: 'Itens em nível normal', color: stockHealthTone, delta: `${normalProducts.length} itens adequados` },
    { icon: 'triangle-alert', value: alerts.length, label: 'Itens para acompanhar', color: alertsTone, delta: alerts.length ? criticalAlerts.length ? 'Ação prioritária' : 'Acompanhar reposição' : 'Tudo em ordem' }
  ]);

  if ($('est-alert-count')) {
    $('est-alert-count').textContent = String(alerts.length);
    $('est-alert-count').className = `alert-count ${alertsTone}`;
  }
  $('est-alertas').innerHTML = alerts.length
    ? `<div class="stock-alert-list">${alerts.slice(0, 5).map(product => {
        const currentStatus = epStatus(product);
        const danger = currentStatus === 'Sem estoque' || currentStatus === 'Crítico';
        return `<button class="stock-alert-item ${danger ? 'danger' : 'warning'}" onclick="abrirDetalhesProduto('${esc(product.id)}')">
          <span class="stock-alert-icon"><i data-lucide="${danger ? 'triangle-alert' : 'clock-3'}"></i></span>
          <span class="stock-alert-copy"><strong>${esc(product.nome)}</strong><span>${currentStatus} · atual ${Number(product.estoqueAtual).toLocaleString('pt-BR')} ${esc(product.unidade)} · mínimo ${Number(product.estoqueMin).toLocaleString('pt-BR')}</span></span>
          <span class="stock-alert-arrow"><i data-lucide="chevron-right"></i></span>
        </button>`;
      }).join('')}</div>`
    : '<p class="empty-state">Nenhum item exige atenção no momento.</p>';
  refreshInterfaceIcons();

  const topProducts = [...allProducts]
    .sort((a, b) => Number(b.estoqueAtual) * Number(b.custo) - Number(a.estoqueAtual) * Number(a.custo))
    .slice(0, 5);
  $('est-top-tbl').querySelector('tbody').innerHTML = topProducts.map((product, index) => {
    const value = Number(product.estoqueAtual) * Number(product.custo);
    const share = total ? value / total * 100 : 0;
    return `<tr onclick="abrirDetalhesProduto('${esc(product.id)}')" class="clickable-row">
      <td><span class="rank-pill">${index + 1}</span></td>
      <td><div class="product-cell compact"><img src="${productImage(product)}" alt=""><span><strong>${esc(product.nome)}</strong><small>${esc(product.id)}</small></span></div></td>
      <td><span class="category-pill">${esc(product.categoria)}</span></td>
      <td><strong>${money(value)}</strong></td>
      <td><div class="value-share"><div class="value-share-track"><span style="width:${Math.max(2, share)}%"></span></div><strong>${share.toFixed(1)}%</strong></div></td>
    </tr>`;
  }).join('');

  drawStockEvolutionChart(allProducts, DB.get('movimentacoes'));
};

const reportTypes = {
  stock: {
    icon: 'package',
    name: 'Posição de estoque',
    subtitle: 'Visão patrimonial completa de saldo, valor e curva ABC de produtos',
    description: 'Saldo, nível e valor dos produtos.'
  },
  purchases: {
    icon: 'shopping-cart',
    name: 'Necessidade de compra',
    subtitle: 'Produtos abaixo do estoque mínimo com reposição sugerida e custos',
    description: 'Itens abaixo do nível mínimo e reposição sugerida.'
  },
  movements: {
    icon: 'arrow-left-right',
    name: 'Movimentações',
    subtitle: 'Fluxo diário de entradas, saídas e ajustes com trilha de responsabilidade',
    description: 'Entradas, saídas e ajustes registrados.'
  },
  suppliers: {
    icon: 'handshake',
    name: 'Fornecedores',
    subtitle: 'Scorecard de pontualidade, qualidade e volume acumulado de compras',
    description: 'Cadastro, avaliação e desempenho de entrega.'
  }
};

let selectedReportType = 'stock';
let currentReportRows = [];
let reportChartInstance = null;

renderRelatorios = function () {
  const container = $('relat-cards');
  if (container) {
    container.innerHTML = Object.entries(reportTypes).map(([key, report]) => `
      <button type="button" class="relat-card ${key === selectedReportType ? 'selected' : ''}" onclick="selecionarRelatorio('${key}', this)">
        <div class="rc-icon" aria-hidden="true"><i data-lucide="${report.icon}"></i></div>
        <div class="rc-info">
          <h4>${report.name}</h4>
          <p>${report.description}</p>
        </div>
      </button>
    `).join('');
  }
  carregarDadosRelatorio(selectedReportType);
  renderRecentReports();
  refreshInterfaceIcons();
};

function selecionarRelatorio(key, element) {
  selectedReportType = key;
  document.querySelectorAll('#relat-cards .relat-card').forEach(card => card.classList.remove('selected'));
  element?.classList.add('selected');
  carregarDadosRelatorio(key);
  refreshInterfaceIcons();
}

function carregarDadosRelatorio(type) {
  const reportInfo = reportTypes[type] || reportTypes.stock;
  if ($('report-badge-icon')) $('report-badge-icon').innerHTML = `<i data-lucide="${reportInfo.icon}"></i>`;
  if ($('report-current-title')) $('report-current-title').textContent = reportInfo.name;
  if ($('report-current-subtitle')) $('report-current-subtitle').textContent = reportInfo.subtitle;

  const allProducts = products();
  const allMovements = DB.get('movimentacoes') || [];
  const allSuppliers = DB.get('fornecedores') || [];

  if (type === 'stock') {
    renderRelatorioEstoque(allProducts);
  } else if (type === 'purchases') {
    renderRelatorioCompras(allProducts);
  } else if (type === 'movements') {
    renderRelatorioMovimentacoes(allMovements);
  } else if (type === 'suppliers') {
    renderRelatorioFornecedores(allSuppliers);
  }

  refreshInterfaceIcons();
}

function renderRelatorioEstoque(allProducts) {
  const totalVal = allProducts.reduce((sum, p) => sum + (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0), 0);
  const totalUnits = allProducts.reduce((sum, p) => sum + (Number(p.estoqueAtual) || 0), 0);
  const normalItems = allProducts.filter(p => epStatus(p) === 'Normal');
  const alertItems = allProducts.filter(p => epStatus(p) !== 'Normal');
  const normalPct = allProducts.length ? Math.round((normalItems.length / allProducts.length) * 100) : 100;

  kpi('report-kpis', [
    { icon: 'package', value: allProducts.length, label: 'Itens cadastrados', delta: `${totalUnits.toLocaleString('pt-BR')} unidades` },
    { icon: 'wallet-cards', value: money(totalVal), label: 'Valor total imobilizado' },
    { icon: 'trending-up', value: `${normalPct}%`, label: 'Itens em nível normal', color: 'green' },
    { icon: 'triangle-alert', value: alertItems.length, label: 'Itens com alerta', color: alertItems.length ? 'red' : 'green' }
  ]);

  // Gráfico: Valor por Categoria
  const catMap = {};
  allProducts.forEach(p => {
    const cat = p.categoria || 'Outros';
    catMap[cat] = (catMap[cat] || 0) + (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0);
  });
  const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  renderGraficoRelatorio('doughnut', {
    labels: sortedCats.map(c => c[0]),
    datasets: [{
      data: sortedCats.map(c => c[1]),
      backgroundColor: ['#2563eb', '#f5851f', '#10b981', '#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#94a3b8']
    }]
  }, 'Valor em Estoque por Categoria (R$)');

  // Tabela
  const abcMap = computeAbcClasses(allProducts);
  $('report-table-thead').innerHTML = `
    <tr>
      <th>Código</th><th>Produto</th><th>Categoria</th><th>Unid.</th><th>Saldo Atual</th><th>Est. Mín.</th><th>Est. Máx.</th><th>Custo Unit.</th><th>Valor Total</th><th>Curva ABC</th><th>Status</th>
    </tr>
  `;

  currentReportRows = allProducts.map(p => {
    const val = (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0);
    const abc = abcMap[p.id] || 'C';
    const st = epStatus(p);
    return {
      textSearch: `${p.id} ${p.nome} ${p.categoria} ${st}`.toLowerCase(),
      html: `
        <tr>
          <td><strong>${esc(p.id)}</strong></td>
          <td><strong>${esc(p.nome)}</strong></td>
          <td><span class="category-pill">${esc(p.categoria)}</span></td>
          <td>${esc(p.unidade)}</td>
          <td><strong>${Number(p.estoqueAtual).toLocaleString('pt-BR')}</strong></td>
          <td>${Number(p.estoqueMin).toLocaleString('pt-BR')}</td>
          <td>${Number(p.estoqueMax).toLocaleString('pt-BR')}</td>
          <td>${money(p.custo)}</td>
          <td><strong>${money(val)}</strong></td>
          <td><span class="badge ${abc === 'A' ? 'normal' : abc === 'B' ? 'ajuste' : 'sem-estoque'}">Classe ${abc}</span></td>
          <td>${badge(st)}</td>
        </tr>
      `
    };
  });

  aplicarTabelaRelatorio();
}

function renderRelatorioCompras(allProducts) {
  const needItems = allProducts.filter(p => Number(p.estoqueAtual) < Number(p.estoqueMin));
  const totalNeedVal = needItems.reduce((sum, p) => sum + Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual)) * (Number(p.custo) || 0), 0);
  const criticalItems = needItems.filter(p => epStatus(p) === 'Crítico' || epStatus(p) === 'Sem estoque');
  const suppliers = [...new Set(needItems.map(p => p.fornecedor).filter(Boolean))];

  kpi('report-kpis', [
    { icon: 'shopping-cart', value: needItems.length, label: 'Itens para reposição', color: 'yellow' },
    { icon: 'wallet-cards', value: money(totalNeedVal), label: 'Investimento estimado' },
    { icon: 'triangle-alert', value: criticalItems.length, label: 'Alta criticidade', color: 'red' },
    { icon: 'handshake', value: suppliers.length, label: 'Fornecedores a acionar' }
  ]);

  // Gráfico: Valor de Reposição por Categoria
  const catNeedMap = {};
  needItems.forEach(p => {
    const cat = p.categoria || 'Outros';
    const val = Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual)) * (Number(p.custo) || 0);
    catNeedMap[cat] = (catNeedMap[cat] || 0) + val;
  });
  const sortedNeedCats = Object.entries(catNeedMap).sort((a, b) => b[1] - a[1]);

  renderGraficoRelatorio('bar', {
    labels: sortedNeedCats.map(c => c[0]),
    datasets: [{
      label: 'Valor de Reposição (R$)',
      data: sortedNeedCats.map(c => c[1]),
      backgroundColor: '#f5851f',
      borderRadius: 6
    }]
  }, 'Necessidade Financeira de Compra por Categoria');

  $('report-table-thead').innerHTML = `
    <tr>
      <th>Código</th><th>Produto</th><th>Categoria</th><th>Saldo Atual</th><th>Est. Mín.</th><th>Est. Máx.</th><th>Reposição Sugerida</th><th>Custo Unit.</th><th>Total Estimado</th><th>Fornecedor</th><th>Status</th>
    </tr>
  `;

  currentReportRows = needItems.map(p => {
    const qty = Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual));
    const val = qty * (Number(p.custo) || 0);
    const st = epStatus(p);
    return {
      textSearch: `${p.id} ${p.nome} ${p.categoria} ${p.fornecedor || ''}`.toLowerCase(),
      html: `
        <tr>
          <td><strong>${esc(p.id)}</strong></td>
          <td><strong>${esc(p.nome)}</strong></td>
          <td><span class="category-pill">${esc(p.categoria)}</span></td>
          <td>${Number(p.estoqueAtual).toLocaleString('pt-BR')} ${esc(p.unidade)}</td>
          <td>${Number(p.estoqueMin).toLocaleString('pt-BR')}</td>
          <td>${Number(p.estoqueMax).toLocaleString('pt-BR')}</td>
          <td><strong style="color: #ea580c;">+${qty} ${esc(p.unidade)}</strong></td>
          <td>${money(p.custo)}</td>
          <td><strong>${money(val)}</strong></td>
          <td>${esc(p.fornecedor || 'Não informado')}</td>
          <td>${badge(st)}</td>
        </tr>
      `
    };
  });

  aplicarTabelaRelatorio();
}

function renderRelatorioMovimentacoes(allMovements) {
  const periodDays = Number($('report-period-select')?.value || 0);
  let filteredMovs = [...allMovements];
  if (periodDays > 0) {
    const cutoff = Date.now() - periodDays * 86400000;
    filteredMovs = filteredMovs.filter(m => new Date(m.data).getTime() >= cutoff);
  }
  filteredMovs.sort((a, b) => new Date(b.data) - new Date(a.data));

  const totalIn = filteredMovs.filter(m => m.tipo === 'Entrada').reduce((sum, m) => sum + Math.abs(Number(m.quantidade) || 0), 0);
  const totalOut = filteredMovs.filter(m => m.tipo === 'Saída').reduce((sum, m) => sum + Math.abs(Number(m.quantidade) || 0), 0);
  const totalAdj = filteredMovs.filter(m => m.tipo === 'Ajuste').length;

  kpi('report-kpis', [
    { icon: 'arrow-left-right', value: filteredMovs.length, label: 'Movimentações no período' },
    { icon: 'arrow-down-to-line', value: totalIn.toLocaleString('pt-BR'), label: 'Volume de entradas', color: 'green' },
    { icon: 'arrow-up-from-line', value: totalOut.toLocaleString('pt-BR'), label: 'Volume de saídas', color: 'yellow' },
    { icon: 'wrench', value: totalAdj, label: 'Ajustes de inventário' }
  ]);

  // Gráfico: Entradas vs Saídas por Data
  const dateMap = {};
  filteredMovs.forEach(m => {
    const day = (m.data || '').slice(0, 10);
    if (!day) return;
    if (!dateMap[day]) dateMap[day] = { in: 0, out: 0 };
    if (m.tipo === 'Entrada') dateMap[day].in += Math.abs(Number(m.quantidade) || 0);
    if (m.tipo === 'Saída') dateMap[day].out += Math.abs(Number(m.quantidade) || 0);
  });
  const sortedDays = Object.keys(dateMap).sort();

  renderGraficoRelatorio('bar', {
    labels: sortedDays.map(d => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
    datasets: [
      { label: 'Entradas', data: sortedDays.map(d => dateMap[d].in), backgroundColor: '#2563eb', borderRadius: 4 },
      { label: 'Saídas', data: sortedDays.map(d => dateMap[d].out), backgroundColor: '#f5851f', borderRadius: 4 }
    ]
  }, 'Volume Diário de Entradas e Saídas');

  $('report-table-thead').innerHTML = `
    <tr>
      <th>Data/Hora</th><th>Tipo</th><th>Código</th><th>Produto</th><th>Quantidade</th><th>Saldo Após</th><th>Local</th><th>Responsável</th><th>Descrição / NF</th>
    </tr>
  `;

  currentReportRows = filteredMovs.map(m => {
    return {
      textSearch: `${m.data} ${m.tipo} ${m.produtoId} ${m.produto} ${m.responsavel || ''} ${m.descricao || ''}`.toLowerCase(),
      html: `
        <tr>
          <td>${new Date(m.data).toLocaleString('pt-BR')}</td>
          <td>${badge(m.tipo)}</td>
          <td><strong>${esc(m.produtoId)}</strong></td>
          <td><strong>${esc(m.produto)}</strong></td>
          <td><strong style="color: ${m.tipo === 'Entrada' ? '#16a34a' : m.tipo === 'Saída' ? '#dc2626' : '#64748b'};">${m.quantidade > 0 ? '+' : ''}${m.quantidade}</strong></td>
          <td>${m.saldoApos ?? '—'}</td>
          <td>${esc(m.local || '—')}</td>
          <td>${esc(m.responsavel || 'Sistema')}</td>
          <td><small>${esc(m.descricao || 'Sem observações')}</small></td>
        </tr>
      `
    };
  });

  aplicarTabelaRelatorio();
}

function renderRelatorioFornecedores(allSuppliers) {
  const approved = allSuppliers.filter(s => s.situacao === 'Aprovado').length;
  const avgPrazo = allSuppliers.length ? Math.round(allSuppliers.reduce((sum, s) => sum + (Number(s.entregasPrazo) || 0), 0) / allSuppliers.length) : 100;
  const avgQual = allSuppliers.length ? (allSuppliers.reduce((sum, s) => sum + (Number(s.avaliacao) || 0), 0) / allSuppliers.length).toFixed(1) : '5.0';
  const totalCompras = allSuppliers.reduce((sum, s) => sum + (Number(s.totalCompras) || 0), 0);

  kpi('report-kpis', [
    { icon: 'handshake', value: allSuppliers.length, label: 'Fornecedores ativos' },
    { icon: 'circle-check', value: approved, label: 'Fornecedores homologados', color: 'green' },
    { icon: 'star', value: `${avgQual} / 5.0`, label: 'Avaliação média geral' },
    { icon: 'wallet-cards', value: money(totalCompras), label: 'Total acumulado em compras' }
  ]);

  // Gráfico: Comparativo de Pontualidade (%)
  renderGraficoRelatorio('bar', {
    labels: allSuppliers.map(s => s.nome.slice(0, 18)),
    datasets: [
      { label: 'Entregas no Prazo (%)', data: allSuppliers.map(s => Number(s.entregasPrazo) || 0), backgroundColor: '#10b981', borderRadius: 5 },
      { label: 'Qualidade do Material (%)', data: allSuppliers.map(s => Number(s.qualidade) || 0), backgroundColor: '#2563eb', borderRadius: 5 }
    ]
  }, 'Desempenho Operacional de Fornecedores (%)');

  $('report-table-thead').innerHTML = `
    <tr>
      <th>Fornecedor</th><th>CNPJ</th><th>Categoria</th><th>Avaliação</th><th>Entregas no Prazo</th><th>Qualidade</th><th>Total de Compras</th><th>Última Compra</th><th>Situação</th>
    </tr>
  `;

  currentReportRows = allSuppliers.map(s => {
    const nota = Number(s.avaliacao) || 0;
    return {
      textSearch: `${s.nome} ${s.cnpj} ${s.categoria} ${s.situacao}`.toLowerCase(),
      html: `
        <tr>
          <td><strong>${esc(s.nome)}</strong></td>
          <td><small>${esc(s.cnpj)}</small></td>
          <td><span class="category-pill">${esc(s.categoria)}</span></td>
          <td><span class="rating-badge"><i data-lucide="star"></i> ${nota.toFixed(1)}</span></td>
          <td><strong>${s.entregasPrazo}%</strong></td>
          <td>${s.qualidade}%</td>
          <td><strong>${money(s.totalCompras)}</strong></td>
          <td>${date(s.ultimaCompra)}</td>
          <td>${badge(s.situacao)}</td>
        </tr>
      `
    };
  });

  aplicarTabelaRelatorio();
}

function computeAbcClasses(allProducts) {
  const sorted = [...allProducts].map(p => ({
    id: p.id,
    val: (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0)
  })).sort((a, b) => b.val - a.val);

  const total = sorted.reduce((sum, item) => sum + item.val, 0);
  const map = {};
  let accumulated = 0;

  sorted.forEach(item => {
    accumulated += item.val;
    const share = total > 0 ? (accumulated / total) * 100 : 0;
    if (share <= 80) {
      map[item.id] = 'A';
    } else if (share <= 95) {
      map[item.id] = 'B';
    } else {
      map[item.id] = 'C';
    }
  });

  return map;
}

function renderGraficoRelatorio(chartType, chartData, title) {
  if ($('report-chart-title')) $('report-chart-title').textContent = title || 'Distribuição Visual';
  const canvas = $('chart-relatorio-dinamico');
  if (!canvas || typeof Chart === 'undefined') return;

  if (reportChartInstance) {
    reportChartInstance.destroy();
    reportChartInstance = null;
  }

  reportChartInstance = new Chart(canvas, {
    type: chartType,
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: chartType === 'doughnut' ? 'right' : 'top',
          labels: { font: { family: 'Outfit', size: 12 }, boxWidth: 14 }
        }
      },
      scales: chartType === 'bar' ? {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Outfit', size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { family: 'Outfit', size: 11 } } }
      } : {}
    }
  });
}

function aplicarTabelaRelatorio() {
  const tbody = $('report-table-tbody');
  const countEl = $('report-table-count');
  const query = ($('report-search-input')?.value || '').toLowerCase().trim();

  if (!tbody) return;

  const filtered = query
    ? currentReportRows.filter(r => r.textSearch.includes(query))
    : currentReportRows;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Nenhum registro encontrado para a consulta informada.</td></tr>';
    if (countEl) countEl.textContent = '0 registros encontrados';
  } else {
    tbody.innerHTML = filtered.map(r => r.html).join('');
    if (countEl) countEl.textContent = `Mostrando ${filtered.length} de ${currentReportRows.length} registro(s)`;
  }
}

function filtrarDadosRelatorio() {
  aplicarTabelaRelatorio();
  refreshInterfaceIcons();
}

function atualizarPeriodoRelatorio(value) {
  carregarDadosRelatorio(selectedReportType);
}

function exportarRelatorioAtual() {
  const report = reportTypes[selectedReportType];
  if (!report) return;

  let filename = `relatorio-${selectedReportType}`;
  let csvContent = '';

  if (selectedReportType === 'stock') {
    csvContent = montarCsvProdutos();
    filename = 'relatorio-posicao-estoque';
  } else if (selectedReportType === 'purchases') {
    const need = products().filter(p => Number(p.estoqueAtual) < Number(p.estoqueMin));
    const rows = need.map(p => [
      csvText(p.id),
      csvText(p.nome),
      csvText(p.categoria),
      csvNumber(p.estoqueAtual),
      csvNumber(p.estoqueMin),
      csvNumber(p.estoqueMax),
      csvNumber(Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual))),
      csvNumber(p.custo),
      csvNumber(Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual)) * (Number(p.custo) || 0)),
      csvText(p.fornecedor || 'Não informado'),
      csvText(epStatus(p))
    ]);
    csvContent = genericCsv(['Código', 'Produto', 'Categoria', 'Estoque Atual', 'Estoque Mínimo', 'Estoque Máximo', 'Reposição Sugerida', 'Custo Unitário (R$)', 'Total Estimado (R$)', 'Fornecedor', 'Status'], rows);
    filename = 'relatorio-necessidade-compra';
  } else if (selectedReportType === 'movements') {
    const movs = DB.get('movimentacoes') || [];
    const rows = movs.map(m => [
      csvText(new Date(m.data).toLocaleString('pt-BR')),
      csvText(m.tipo),
      csvText(m.produtoId),
      csvText(m.produto),
      csvNumber(m.quantidade),
      csvNumber(m.saldoApos),
      csvText(m.local || '—'),
      csvText(m.responsavel || 'Sistema'),
      csvText(m.descricao || '—')
    ]);
    csvContent = genericCsv(['Data/Hora', 'Tipo', 'Código', 'Produto', 'Quantidade', 'Saldo Após', 'Local', 'Responsável', 'Descrição'], rows);
    filename = 'relatorio-movimentacoes';
  } else if (selectedReportType === 'suppliers') {
    const fs = DB.get('fornecedores') || [];
    const rows = fs.map(s => [
      csvText(s.nome),
      csvText(s.cnpj),
      csvText(s.categoria),
      csvNumber(s.avaliacao),
      csvNumber(s.entregasPrazo),
      csvNumber(s.qualidade),
      csvNumber(s.totalCompras),
      csvText(date(s.ultimaCompra)),
      csvText(s.situacao)
    ]);
    csvContent = genericCsv(['Fornecedor', 'CNPJ', 'Categoria', 'Avaliação', 'Entregas no Prazo (%)', 'Qualidade (%)', 'Total Comprado (R$)', 'Última Compra', 'Situação'], rows);
    filename = 'relatorio-fornecedores';
  }

  downloadCsvReport(filename, csvContent);

  const history = DB.get('relatorios') || [];
  history.unshift({
    id: Date.now(),
    nome: report.name,
    data: new Date().toISOString(),
    responsavel: state.user?.nome || 'Administrador',
    formato: 'CSV'
  });
  DB.set('relatorios', history.slice(0, 15));
  Security.logAudit('RELATORIO_EXPORTADO', `Relatório "${report.name}" exportado em CSV.`);
  renderRecentReports();
  toast(`${report.name} exportado com sucesso!`, 'success');
}

function imprimirRelatorioAtual() {
  const report = reportTypes[selectedReportType];
  Security.logAudit('RELATORIO_IMPRESSO', `Impressão do relatório: ${report?.name || selectedReportType}`);
  window.print();
}

async function copiarResumoRelatorio() {
  const report = reportTypes[selectedReportType];
  if (!report) return;

  const kpis = document.querySelectorAll('#report-kpis .kpi-card');
  let kpiText = '';
  kpis.forEach(card => {
    const label = card.querySelector('.kpi-label')?.textContent || '';
    const val = card.querySelector('.kpi-val')?.textContent || '';
    kpiText += `• ${label}: ${val}\n`;
  });

  const summary = `📊 *${report.name} - EngePro Gestão de Estoque*\nData: ${new Date().toLocaleString('pt-BR')}\n\n*Principais Indicadores:*\n${kpiText}\nGerado pelo sistema de estoque EngePro.`;

  try {
    await navigator.clipboard.writeText(summary);
    toast('Resumo copiado para a área de transferência!', 'success');
  } catch {
    toast('Não foi possível copiar automaticamente.', 'error');
  }
}

function renderRecentReports() {
  const recent = DB.get('relatorios') || [];
  const tbody = $('relat-tbody');
  if (!tbody) return;

  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum relatório exportado recentemente.</td></tr>';
    return;
  }

  tbody.innerHTML = recent.slice(0, 6).map(r => `
    <tr>
      <td><strong>${esc(r.nome)}</strong></td>
      <td>${new Date(r.data).toLocaleString('pt-BR')}</td>
      <td>${esc(r.responsavel || 'Administrador')}</td>
      <td><span class="format-pill">${esc(r.formato || 'CSV')}</span></td>
      <td>
        <button type="button" class="btn-icon" title="Exportar novamente" onclick="selecionarRelatorioPeloNome('${esc(r.nome)}')"><i data-lucide="download"></i></button>
      </td>
    </tr>
  `).join('');
  refreshInterfaceIcons();
}

function selecionarRelatorioPeloNome(nome) {
  const entry = Object.entries(reportTypes).find(([, r]) => r.name === nome);
  if (entry) {
    selecionarRelatorio(entry[0], document.querySelector(`#relat-cards .relat-card:nth-child(${Object.keys(reportTypes).indexOf(entry[0]) + 1})`));
  }
}

function genericCsv(headers, rows) {
  return `sep=;\r\n${headers.map(h => Security.sanitizeCsvCell(h)).join(';')}\r\n${rows.map(row => row.join(';')).join('\r\n')}`;
}

function downloadCsvReport(filename, content) {
  const safeFilename = Security.sanitizeId(filename) || 'relatorio';
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function movimentacaoRapidaProduto(productId, delta, event) {
  event?.stopPropagation();
  if (!Security.can('create_movement')) {
    return toast('Acesso negado: permissão insuficiente para movimentar estoque.', 'error');
  }
  const safeId = Security.sanitizeId(productId);
  const allProducts = products();
  const product = allProducts.find(p => p.id === safeId);
  if (!product) return toast('Produto não encontrado.', 'error');

  const currentStock = Number(product.estoqueAtual) || 0;
  const newStock = Math.max(0, currentStock + delta);

  if (delta < 0 && currentStock <= 0) {
    return toast(`Estoque de "${product.nome}" já está zerado.`, 'warning');
  }

  product.estoqueAtual = newStock;
  DB.set('produtos', allProducts);

  const movs = DB.get('movimentacoes') || [];
  movs.unshift({
    id: Date.now(),
    data: new Date().toISOString(),
    tipo: delta > 0 ? 'Entrada' : 'Saída',
    produtoId: product.id,
    produto: product.nome,
    quantidade: delta > 0 ? 1 : -1,
    saldoApos: newStock,
    local: product.local || 'Balcão / Rápido',
    responsavel: state.user?.nome || 'Operador',
    descricao: delta > 0 ? 'Entrada rápida de balcão (+1 un)' : 'Baixa rápida de balcão (-1 un)'
  });
  DB.set('movimentacoes', movs);

  Security.logAudit(delta > 0 ? 'MOVIMENTACAO_ENTRADA_RAPIDA' : 'MOVIMENTACAO_SAIDA_RAPIDA', `Movimentação rápida (${delta > 0 ? '+1' : '-1'}) no produto ${product.id} - ${product.nome}. Saldo: ${newStock}.`);

  renderProducts();
  if (typeof renderHeaderBadges === 'function') renderHeaderBadges();
  toast(`${delta > 0 ? '+1' : '-1'} ${product.unidade}: ${product.nome} (Novo saldo: ${newStock})`, delta > 0 ? 'success' : 'info');
}

// ===== IMPORTAÇÃO DE XML DE NOTA FISCAL (NF-e) =====
function abrirModalImportarNFe() {
  if (!Security.can('create_movement')) {
    return toast('Acesso negado: permissão insuficiente para importar NF-e.', 'error');
  }
  state.pendingNFe = null;

  modal('Importar XML de Nota Fiscal (NF-e)', `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="border: 2px dashed #cbd5e1; border-radius: 12px; padding: 28px 20px; text-align: center; background: #f8fafc; cursor: pointer;" onclick="$('nfe-file-input').click()">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: #e0f2fe; color: #0284c7; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;"><i data-lucide="file-code-2"></i></div>
        <h4 style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #0f172a;">Selecione ou arraste o arquivo XML da NF-e</h4>
        <p style="margin: 0; font-size: 12px; color: #64748b;">Suporta arquivos de Nota Fiscal Eletrônica no formato padrão SEFAZ (.xml)</p>
        <input type="file" id="nfe-file-input" accept=".xml,text/xml" style="display: none;" onchange="processarArquivoNFe(this)">
      </div>
      <div id="nfe-preview-container"></div>
    </div>
  `);
  $('modal-box').classList.add('modal-wide');
  refreshInterfaceIcons();
}

function processarArquivoNFe(input) {
  const file = input?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const text = e.target.result;
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'text/xml');

      if (xml.querySelector('parsererror')) {
        return toast('Arquivo XML inválido ou corrompido.', 'error');
      }

      // Extração de dados da NF-e
      const nNF = xml.querySelector('ide > nNF, nNF')?.textContent || 'S/N';
      const serie = xml.querySelector('ide > serie, serie')?.textContent || '1';
      const dhEmi = xml.querySelector('ide > dhEmi, ide > dEmi, dhEmi, dEmi')?.textContent || new Date().toISOString();
      const emitNome = xml.querySelector('emit > xNome, emit xNome')?.textContent || 'Fornecedor Desconhecido';
      let emitCnpj = xml.querySelector('emit > CNPJ, emit CNPJ, emit > CPF, emit CPF')?.textContent || '';
      if (emitCnpj.length === 14) {
        emitCnpj = emitCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      }

      const detNodes = Array.from(xml.querySelectorAll('det'));
      if (!detNodes.length) {
        return toast('Nenhum item/produto encontrado dentro do XML da NF-e.', 'error');
      }

      const allProducts = products();
      const items = detNodes.map((det, idx) => {
        const cProd = det.querySelector('prod > cProd, cProd')?.textContent?.trim() || '';
        const xProd = det.querySelector('prod > xProd, xProd')?.textContent?.trim() || '';
        const NCM = det.querySelector('prod > NCM, NCM')?.textContent?.trim() || '';
        const uCom = (det.querySelector('prod > uCom, uCom')?.textContent?.trim() || 'UN').toUpperCase();
        const qCom = parseFloat(det.querySelector('prod > qCom, qCom')?.textContent || '0') || 1;
        const vUnCom = parseFloat(det.querySelector('prod > vUnCom, vUnCom')?.textContent || '0') || 0;
        const vProd = parseFloat(det.querySelector('prod > vProd, vProd')?.textContent || '0') || (qCom * vUnCom);

        // Matching com produtos existentes
        const matched = allProducts.find(p =>
          p.id.toLowerCase() === cProd.toLowerCase() ||
          p.nome.toLowerCase() === xProd.toLowerCase() ||
          p.nome.toLowerCase().includes(xProd.toLowerCase()) ||
          xProd.toLowerCase().includes(p.nome.toLowerCase())
        );

        return {
          idx,
          cProd,
          xProd,
          NCM,
          uCom,
          qCom,
          vUnCom,
          vProd,
          matchedProductId: matched ? matched.id : null,
          action: matched ? 'update' : 'create'
        };
      });

      const totalNF = items.reduce((sum, item) => sum + item.vProd, 0);

      state.pendingNFe = {
        nNF,
        serie,
        dhEmi,
        emitNome,
        emitCnpj,
        totalNF,
        items
      };

      renderNFePreview();
    } catch (err) {
      console.error(err);
      toast('Erro ao processar o XML da NF-e: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function renderNFePreview() {
  const container = $('nfe-preview-container');
  if (!container || !state.pendingNFe) return;

  const nfe = state.pendingNFe;
  const allProducts = products();

  container.innerHTML = `
    <div style="border-top: 1px solid var(--border); padding-top: 16px;">
      <dl class="nfe-header-card">
        <div><dt>Fornecedor / Emitente</dt><dd>${esc(nfe.emitNome)}</dd></div>
        <div><dt>CNPJ</dt><dd>${esc(nfe.emitCnpj || 'Não informado')}</dd></div>
        <div><dt>Nota Fiscal</dt><dd>Nº ${esc(nfe.nNF)} (Série ${esc(nfe.serie)})</dd></div>
        <div><dt>Data de Emissão</dt><dd>${new Date(nfe.dhEmi).toLocaleDateString('pt-BR')}</dd></div>
        <div><dt>Total dos Produtos</dt><dd><strong style="color: #16a34a;">${money(nfe.totalNF)}</strong></dd></div>
      </dl>

      <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <strong style="font-size: 13px; color: #0f172a;">Itens Identificados no XML (${nfe.items.length})</strong>
        <span class="card-helper">Verifique os vínculos com o estoque</span>
      </div>

      <div class="table-wrap" style="max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px;">
        <table class="tbl" style="margin: 0;">
          <thead>
            <tr>
              <th>Cód. NF</th><th>Descrição do Produto</th><th>Qtd.</th><th>Unid.</th><th>Valor Unit.</th><th>Subtotal</th><th>Destino no Estoque</th>
            </tr>
          </thead>
          <tbody>
            ${nfe.items.map(item => `
              <tr>
                <td><small>${esc(item.cProd)}</small></td>
                <td><strong>${esc(item.xProd)}</strong><br><small style="color: var(--text2);">NCM: ${esc(item.NCM || '—')}</small></td>
                <td><strong>+${item.qCom}</strong></td>
                <td><small>${esc(item.uCom)}</small></td>
                <td>${money(item.vUnCom)}</td>
                <td><strong>${money(item.vProd)}</strong></td>
                <td>
                  <select onchange="atualizarVinculoItemNFe(${item.idx}, this.value)" style="padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 11px; max-width: 200px;">
                    <option value="__NEW__" ${!item.matchedProductId ? 'selected' : ''}>+ Cadastrar como novo produto</option>
                    ${allProducts.map(p => `<option value="${esc(p.id)}" ${item.matchedProductId === p.id ? 'selected' : ''}>Vincular: ${esc(p.id)} - ${esc(p.nome)}</option>`).join('')}
                  </select>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px; background: #f8fafc; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
          <input type="checkbox" id="nfe-recalc-cost" checked>
          <span><strong>Cálculo de Custo Médio Ponderado:</strong> Atualizar o custo unitário dos produtos vinculados com base na média ponderada da entrada.</span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
          <input type="checkbox" id="nfe-register-supplier" checked>
          <span><strong>Cadastrar/Atualizar Fornecedor:</strong> Registrar ${esc(nfe.emitNome)} no catálogo de fornecedores com o histórico desta compra.</span>
        </label>
      </div>

      <div class="modal-footer" style="margin-top: 16px;">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="button" class="btn-primary" onclick="confirmarImportacaoNFe()"><i data-lucide="check"></i> Confirmar Entrada de Estoque</button>
      </div>
    </div>
  `;
  refreshInterfaceIcons();
}

function atualizarVinculoItemNFe(itemIdx, value) {
  if (!state.pendingNFe || !state.pendingNFe.items[itemIdx]) return;
  state.pendingNFe.items[itemIdx].matchedProductId = value === '__NEW__' ? null : value;
}

function confirmarImportacaoNFe() {
  if (!state.pendingNFe) return;
  const nfe = state.pendingNFe;
  const shouldRecalcCost = $('nfe-recalc-cost')?.checked !== false;
  const shouldRegisterSupplier = $('nfe-register-supplier')?.checked !== false;

  let allProducts = products();
  const movs = DB.get('movimentacoes') || [];
  let addedCount = 0;
  let updatedCount = 0;

  nfe.items.forEach(item => {
    let product = item.matchedProductId ? allProducts.find(p => p.id === item.matchedProductId) : null;

    if (product) {
      // Atualiza produto existente
      const oldStock = Number(product.estoqueAtual) || 0;
      const oldCost = Number(product.custo) || 0;
      const newStock = oldStock + item.qCom;

      if (shouldRecalcCost) {
        const newCost = newStock > 0 ? ((oldStock * oldCost) + (item.qCom * item.vUnCom)) / newStock : item.vUnCom;
        product.custo = parseFloat(newCost.toFixed(2));
      }

      product.estoqueAtual = newStock;
      if (!product.fornecedor) product.fornecedor = nfe.emitNome;

      movs.unshift({
        id: Date.now() + Math.random(),
        data: nfe.dhEmi || new Date().toISOString(),
        tipo: 'Entrada',
        produtoId: product.id,
        produto: product.nome,
        quantidade: item.qCom,
        saldoApos: newStock,
        local: product.local || 'Estoque Central',
        responsavel: state.user?.nome || 'Operador',
        descricao: `Entrada via NF-e nº ${nfe.nNF} (${nfe.emitNome})`
      });
      updatedCount++;
    } else {
      // Cadastra novo produto
      const newId = nextProductCode();
      const newProduct = {
        id: newId,
        nome: item.xProd,
        desc: `Importado via NF-e nº ${nfe.nNF} (NCM: ${item.NCM || '—'})`,
        categoria: 'Geral',
        unidade: item.uCom || 'UN',
        estoqueAtual: item.qCom,
        estoqueMin: Math.max(5, Math.ceil(item.qCom * 0.2)),
        estoqueMax: Math.max(20, Math.ceil(item.qCom * 2)),
        custo: item.vUnCom,
        preco: parseFloat((item.vUnCom * 1.4).toFixed(2)),
        local: 'Estoque Central',
        fornecedor: nfe.emitNome,
        ativo: true
      };
      allProducts.unshift(newProduct);

      movs.unshift({
        id: Date.now() + Math.random(),
        data: nfe.dhEmi || new Date().toISOString(),
        tipo: 'Entrada',
        produtoId: newId,
        produto: item.xProd,
        quantidade: item.qCom,
        saldoApos: item.qCom,
        local: 'Estoque Central',
        responsavel: state.user?.nome || 'Operador',
        descricao: `Cadastro e entrada inicial via NF-e nº ${nfe.nNF} (${nfe.emitNome})`
      });
      addedCount++;
    }
  });

  DB.set('produtos', allProducts);
  DB.set('movimentacoes', movs);

  // Cadastrar ou atualizar fornecedor
  if (shouldRegisterSupplier && nfe.emitNome) {
    const suppliers = DB.get('fornecedores') || [];
    let sup = suppliers.find(s => (nfe.emitCnpj && s.cnpj === nfe.emitCnpj) || s.nome.toLowerCase() === nfe.emitNome.toLowerCase());
    if (sup) {
      sup.totalCompras = (Number(sup.totalCompras) || 0) + nfe.totalNF;
      sup.ultimaCompra = nfe.dhEmi ? nfe.dhEmi.slice(0, 10) : new Date().toISOString().slice(0, 10);
    } else {
      suppliers.unshift({
        nome: nfe.emitNome,
        cnpj: nfe.emitCnpj || '00.000.000/0000-00',
        categoria: 'Geral',
        avaliacao: 5.0,
        entregasPrazo: 100,
        qualidade: 100,
        situacao: 'Aprovado',
        totalCompras: nfe.totalNF,
        ultimaCompra: nfe.dhEmi ? nfe.dhEmi.slice(0, 10) : new Date().toISOString().slice(0, 10)
      });
    }
    DB.set('fornecedores', suppliers);
  }

  Security.logAudit('NFE_IMPORTADA', `NF-e nº ${nfe.nNF} (${nfe.emitNome}) processada com sucesso: ${updatedCount} produtos atualizados, ${addedCount} novos produtos cadastrados. Total: ${money(nfe.totalNF)}.`);

  fecharModal();
  renderProducts();
  if (typeof renderRelatorios === 'function') renderRelatorios();
  if (typeof renderHeaderBadges === 'function') renderHeaderBadges();
  toast(`NF-e nº ${nfe.nNF} importada com sucesso! (${nfe.items.length} itens processados)`, 'success');
}

// ===== BACKUP COMPLETO E RESTAURAÇÃO (JSON) =====
function exportarBackupCompleto() {
  if (!Security.can('view_settings')) {
    return toast('Acesso negado: apenas administradores podem exportar backup.', 'error');
  }

  const payload = {
    sistema: 'EngePro Gestao de Estoque',
    versao: '2.5.0',
    timestamp: new Date().toISOString(),
    autor: state.user?.nome || 'Administrador',
    contadores: {
      produtos: DB.get('produtos')?.length || 0,
      movimentacoes: DB.get('movimentacoes')?.length || 0,
      pedidos: DB.get('pedidos')?.length || 0,
      fornecedores: DB.get('fornecedores')?.length || 0,
      usuarios: DB.get('usuarios')?.length || 0,
      relatorios: DB.get('relatorios')?.length || 0,
      automacoes: DB.get('automacoes')?.length || 0
    },
    bancoDeDados: {
      produtos: DB.get('produtos') || [],
      movimentacoes: DB.get('movimentacoes') || [],
      pedidos: DB.get('pedidos') || [],
      fornecedores: DB.get('fornecedores') || [],
      usuarios: DB.get('usuarios') || [],
      categorias: DB.get('categorias') || [],
      relatorios: DB.get('relatorios') || [],
      automacoes: DB.get('automacoes') || [],
      audit_log: DB.get('audit_log') || []
    }
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `backup-estoque-engepro-${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  Security.logAudit('BACKUP_EXPORTADO', `Backup completo em JSON gerado com ${payload.contadores.produtos} produtos e ${payload.contadores.movimentacoes} movimentações.`);
  toast('Backup completo exportado com sucesso! Guarde o arquivo com segurança.', 'success');
}

function abrirModalRestaurarBackup() {
  if (!Security.can('view_settings')) {
    return toast('Acesso negado: apenas administradores podem restaurar backup.', 'error');
  }
  state.pendingBackupData = null;

  modal('Restaurar Backup do Banco de Dados (JSON)', `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="border: 2px dashed #cbd5e1; border-radius: 12px; padding: 24px 20px; text-align: center; background: #f8fafc; cursor: pointer;" onclick="$('backup-file-input').click()">
        <div style="width: 48px; height: 48px; border-radius: 12px; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;"><i data-lucide="database"></i></div>
        <h4 style="margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #0f172a;">Selecione o arquivo de Backup (.json)</h4>
        <p style="margin: 0; font-size: 12px; color: #64748b;">Carregue o arquivo JSON gerado anteriormente pelo sistema</p>
        <input type="file" id="backup-file-input" accept=".json,application/json" style="display: none;" onchange="processarArquivoBackup(this)">
      </div>
      <div id="backup-restore-preview"></div>
    </div>
  `);
  refreshInterfaceIcons();
}

function processarArquivoBackup(input) {
  const file = input?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.bancoDeDados || typeof data.bancoDeDados !== 'object') {
        return toast('Arquivo de backup inválido: estrutura de dados não reconhecida.', 'error');
      }

      state.pendingBackupData = data;
      const preview = $('backup-restore-preview');
      if (preview) {
        preview.innerHTML = `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px 16px; margin-top: 10px;">
            <strong style="color: #991b1b; font-size: 13.5px;">⚠️ Atenção: A restauração substituirá os dados atuais!</strong>
            <p style="color: #7f1d1d; font-size: 12px; margin: 4px 0 10px;">Recomendamos baixar uma cópia do seu estado atual antes de prosseguir.</p>
            <ul style="font-size: 12px; color: #334155; margin: 0; padding-left: 18px; line-height: 1.6;">
              <li><strong>Data do Backup:</strong> ${data.timestamp ? new Date(data.timestamp).toLocaleString('pt-BR') : 'Data não informada'}</li>
              <li><strong>Autor:</strong> ${esc(data.autor || 'Administrador')}</li>
              <li><strong>Produtos a restaurar:</strong> ${data.bancoDeDados.produtos?.length || 0}</li>
              <li><strong>Movimentações a restaurar:</strong> ${data.bancoDeDados.movimentacoes?.length || 0}</li>
              <li><strong>Fornecedores a restaurar:</strong> ${data.bancoDeDados.fornecedores?.length || 0}</li>
              <li><strong>Usuários a restaurar:</strong> ${data.bancoDeDados.usuarios?.length || 0}</li>
            </ul>
          </div>
          <div class="modal-footer" style="margin-top: 16px;">
            <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
            <button type="button" class="btn-danger" onclick="confirmarRestauracaoBackup()"><i data-lucide="rotate-ccw"></i> Confirmar Restauração</button>
          </div>
        `;
        refreshInterfaceIcons();
      }
    } catch (err) {
      toast('Erro ao ler arquivo JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function confirmarRestauracaoBackup() {
  if (!state.pendingBackupData || !state.pendingBackupData.bancoDeDados) return;
  const db = state.pendingBackupData.bancoDeDados;

  Object.entries(db).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      DB.set(key, value);
    }
  });

  Security.logAudit('BACKUP_RESTAURADO', `Restauração completa efetuada a partir do backup de ${state.pendingBackupData.timestamp || 'data desconhecida'}.`);

  fecharModal();
  toast('Banco de dados restaurado com sucesso!', 'success');
  setTimeout(() => location.reload(), 1200);
}

function renderConfiguracoesBackupStats() {
  const container = $('backup-counts-summary');
  if (!container) return;
  const pCount = DB.get('produtos')?.length || 0;
  const mCount = DB.get('movimentacoes')?.length || 0;
  const fCount = DB.get('fornecedores')?.length || 0;
  const uCount = DB.get('usuarios')?.length || 0;

  container.innerHTML = `
    <span><strong>${pCount}</strong> produtos</span>
    <span><strong>${mCount}</strong> movimentações</span>
    <span><strong>${fCount}</strong> fornecedores</span>
    <span><strong>${uCount}</strong> usuários</span>
  `;
}

// Hook de estatísticas de backup em renderConfiguracoes
const originalRenderConfiguracoes = typeof renderConfiguracoes === 'function' ? renderConfiguracoes : null;
renderConfiguracoes = function () {
  if (originalRenderConfiguracoes) originalRenderConfiguracoes();
  renderConfiguracoesBackupStats();
};

function refreshInterfaceIcons() {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
}

kpi = function (target, items) {
  const container = $(target);
  if (!container) return;
  container.innerHTML = items.map(item => {
    const iconName = item.icon || 'circle';
    const deltaType = item.deltaType || item.color || 'neutral';
    return `<article class="kpi-card ${esc(item.color || '')}">
      <div class="kpi-icon"><i data-lucide="${esc(iconName)}"></i></div>
      <div class="kpi-val">${esc(String(item.value))}</div>
      <div class="kpi-label">${esc(item.label)}</div>
      ${item.delta ? `<div class="kpi-delta ${esc(deltaType)}">${esc(item.delta)}</div>` : ''}
    </article>`;
  }).join('');
  refreshInterfaceIcons();
};

const renderPageBeforeIconRefresh = renderPage;
renderPage = function (page) {
  renderPageBeforeIconRefresh(page);
  requestAnimationFrame(refreshInterfaceIcons);
};

document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(refreshInterfaceIcons));

