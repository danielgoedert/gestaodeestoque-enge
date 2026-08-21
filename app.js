// ===== APP.JS - Lógica principal da aplicação com Proteção Criptográfica, RBAC, Anti-SQL Injection, Recuperação de Senha, Notificações e Importação de Planilhas =====

// Estado global
const state = {
  user: null,
  page: 'dashboard',
  movFilter: 'Todas',
  editingProductId: null,
  editingUserId: null,
  editingSupplierId: null,
  activeAutomacaoId: null,
  searchQuery: ''
};

// Atalho DOM seguro
const $ = id => document.getElementById(id);
const esc = str => Security.esc(str);

// Funções de formatação
const money = val => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
const date = str => {
  if (!str) return '—';
  const d = new Date(str);
  return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
};
const status = p => {
  const cur = Number(p.estoqueAtual) || 0;
  const min = Number(p.estoqueMin) || 0;
  if (cur === 0) return 'Sem estoque';
  if (cur <= min * 0.5) return 'Crítico';
  if (cur <= min) return 'Atenção';
  return 'Normal';
};
const badge = s => {
  const map = {
    'Normal': 'badge normal',
    'Atenção': 'badge atencao',
    'Crítico': 'badge critico',
    'Sem estoque': 'badge sem-estoque',
    'Entrada': 'badge entrada',
    'Saída': 'badge saida',
    'Ajuste': 'badge ajuste',
    'Aprovado': 'badge aprovado',
    'Em avaliação': 'badge avaliacao',
    'Bloqueado': 'badge bloqueado'
  };
  return `<span class="${map[s] || 'badge'}">${esc(s)}</span>`;
};

// Ícones da interface
function refreshIcons() {
  if (typeof window !== 'undefined' && window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons();
  }
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  DB.init();

  // 1. Preenche e-mail lembrado neste dispositivo se houver
  const rememberedEmail = localStorage.getItem('ep_remembered_email');
  if (rememberedEmail && $('login-email')) {
    $('login-email').value = rememberedEmail;
    if ($('remember')) $('remember').checked = true;
  }

  // 2. Verifica sessão persistida (localStorage para 'lembrar', sessionStorage para sessão única)
  const saved = localStorage.getItem('ep_user') || sessionStorage.getItem('ep_user');
  if (saved) {
    try {
      const u = JSON.parse(saved);
      const now = Date.now();
      const loginTime = u.loginTime || 0;
      const isRemembered = !!localStorage.getItem('ep_user');
      const maxAge = isRemembered ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
      
      if (loginTime && (now - loginTime < maxAge)) {
        loginSuccess(u);
        return;
      } else {
        localStorage.removeItem('ep_user');
        sessionStorage.removeItem('ep_user');
      }
    } catch {
      localStorage.removeItem('ep_user');
      sessionStorage.removeItem('ep_user');
    }
  }

  $('page-login').classList.add('active');
  $('app').classList.add('hidden');
  refreshIcons();
});

// Autenticação com SHA-256 + Salt + Proteção Anti-Força Bruta, Anti-SQL Injection e Lembrar Dispositivo
async function doLogin(event) {
  if (event) event.preventDefault();

  // 1. Verificação de Bloqueio por Força Bruta (Rate Limiting)
  const rateLimit = Security.checkRateLimit();
  if (!rateLimit.allowed) {
    toast(`Muitas tentativas inválidas. Tente novamente em ${rateLimit.remainingSec}s.`, 'error');
    Security.logAudit('LOGIN_BLOQUEADO_RATE_LIMIT', 'Tentativa de login durante período de bloqueio.', 'CRITICAL');
    return;
  }

  const emailRaw = $('login-email')?.value || '';
  const senhaRaw = $('login-senha')?.value || '';

  // 2. Proteção contra SQL Injection nos campos de autenticação
  if (Security.detectSqlInjection(emailRaw) || Security.detectSqlInjection(senhaRaw)) {
    Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection no formulário de login para: ${emailRaw.slice(0, 50)}`, 'CRITICAL');
    Security.recordFailedLogin();
    toast('Credenciais inválidas.', 'error');
    return;
  }

  const email = Security.sanitizeText(emailRaw, 100).toLowerCase().trim();
  const senha = senhaRaw.slice(0, 100);

  if (!email || !senha) {
    toast('Preencha todos os campos.', 'error');
    return;
  }

  const u = DB.getUser(email);

  if (!u || !u.ativo) {
    Security.recordFailedLogin();
    Security.logAudit('LOGIN_FALHOU', `Tentativa com usuário inexistente ou inativo: ${email}`, 'FAILURE');
    toast('E-mail ou senha inválidos.', 'error');
    return;
  }

  // 3. Verificação de Senha Criptográfica
  let isValid = false;
  if (u.salt && u.passwordHash) {
    const computedHash = await Security.hashPassword(senha, u.salt);
    isValid = (computedHash === u.passwordHash);
  } else if (u.senha) {
    isValid = (u.senha === senha);
  }

  if (isValid) {
    Security.resetRateLimit();

    // Criação de sessão segura sem exposição de credenciais ou hashes
    const safeUserSession = {
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil,
      avatar: u.avatar || 'US',
      loginTime: Date.now()
    };

    const rememberChecked = $('remember')?.checked;
    if (rememberChecked) {
      localStorage.setItem('ep_user', JSON.stringify(safeUserSession));
      localStorage.setItem('ep_remembered_email', u.email);
      sessionStorage.removeItem('ep_user');
    } else {
      sessionStorage.setItem('ep_user', JSON.stringify(safeUserSession));
      localStorage.removeItem('ep_user');
      localStorage.removeItem('ep_remembered_email');
    }

    Security.logAudit('LOGIN_SUCESSO', `Usuário ${u.nome} (${u.email}) logado com sucesso. Perfil: ${u.perfil}`, 'SUCCESS', safeUserSession);
    loginSuccess(safeUserSession);
    toast(`Bem-vindo, ${u.nome}!`, 'success');
  } else {
    Security.recordFailedLogin();
    Security.logAudit('LOGIN_FALHOU', `Senha incorreta para o usuário: ${email}`, 'FAILURE', { nome: u.nome, email: u.email, perfil: u.perfil });
    const updatedRate = Security.checkRateLimit();
    if (!updatedRate.allowed) {
      toast(`Conta temporariamente bloqueada por 30s devido a 5 tentativas falhas.`, 'error');
    } else {
      toast('E-mail ou senha inválidos.', 'error');
    }
  }
}

function loginSuccess(u) {
  state.user = u;
  $('page-login').classList.remove('active');
  $('app').classList.remove('hidden');

  const avatar = esc(u.avatar || u.nome?.slice(0, 2).toUpperCase() || 'US');
  $('user-avatar-sb').textContent = avatar;
  $('user-name-sb').textContent = esc(u.nome);
  $('user-role-sb').textContent = esc(u.perfil);
  $('topbar-avatar').textContent = avatar;
  $('topbar-username').textContent = esc(u.nome);

  const isAdmin = (u.perfil === 'Administrador');
  const automacoesNav = document.querySelector('.nav-item[data-page="automacoes"]');
  if (automacoesNav) automacoesNav.style.display = isAdmin ? 'flex' : 'none';
  const configNav = document.querySelector('.nav-item[data-page="configuracoes"]');
  if (configNav) configNav.style.display = isAdmin ? 'flex' : 'none';

  navigate('dashboard');
  updateNotificacoes();
  refreshIcons();
}

function doLogout() {
  Security.logAudit('LOGOUT', `Usuário ${state.user?.nome || 'Anônimo'} encerrou a sessão.`, 'SUCCESS');
  localStorage.removeItem('ep_user');
  sessionStorage.removeItem('ep_user');
  state.user = null;
  $('app').classList.add('hidden');
  $('page-login').classList.add('active');
  $('login-senha').value = '';

  const rememberedEmail = localStorage.getItem('ep_remembered_email');
  if (rememberedEmail && $('login-email')) {
    $('login-email').value = rememberedEmail;
    if ($('remember')) $('remember').checked = true;
  }

  toast('Você saiu do sistema.');
  refreshIcons();
}

function togglePass() {
  const inp = $('login-senha');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function toggleUserMenu() {
  $('user-dropdown')?.classList.toggle('open');
}

// ===== RECUPERAÇÃO DE SENHA =====
function abrirModalEsqueciSenha() {
  modal('Recuperar Senha', `
    <form onsubmit="solicitarRecuperacaoSenha(event)">
      <p style="margin-bottom: 16px; font-size: 13px; color: var(--text2); line-height: 1.5;">
        Informe seu e-mail cadastrado. Enviaremos um código de verificação para que você possa redefinir sua senha com segurança.
      </p>
      <div class="form-group">
        <label>E-mail de acesso *</label>
        <div class="input-icon">
          <span><i data-lucide="mail"></i></span>
          <input type="email" id="rec-email" placeholder="seu@email.com" required maxlength="100" style="padding-left: 44px !important;" autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Enviar Código</button>
      </div>
    </form>
  `);
  refreshIcons();
}

function solicitarRecuperacaoSenha(e) {
  e.preventDefault();
  const rawEmail = $('rec-email')?.value || '';
  if (Security.detectSqlInjection(rawEmail)) {
    Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection na recuperação de senha: ${rawEmail}`, 'CRITICAL');
    return toast('E-mail com caracteres inválidos.', 'error');
  }

  const email = Security.sanitizeText(rawEmail, 100).toLowerCase().trim();
  const u = DB.getUser(email);

  if (!u || !u.ativo) {
    return toast('E-mail não encontrado no sistema.', 'error');
  }

  // Gera código PIN de 6 dígitos seguro
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  sessionStorage.setItem('ep_recovery_code', pin);
  sessionStorage.setItem('ep_recovery_email', email);

  toast(`Código de verificação enviado: ${pin}`, 'info');

  modal('Definir Nova Senha', `
    <form onsubmit="confirmarNovaSenha(event)">
      <p style="margin-bottom: 16px; font-size: 13px; color: var(--text2); line-height: 1.5;">
        Um código de 6 dígitos foi gerado para <strong>${esc(email)}</strong>.<br>
        <small style="color: #2563eb;">(Código para teste gerado: <strong>${pin}</strong>)</small>
      </p>
      <div class="form-group">
        <label>Código de Verificação *</label>
        <input type="text" id="rec-code" placeholder="123456" required maxlength="6" style="letter-spacing: 4px; font-weight: 700; text-align: center; font-size: 18px;">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Nova Senha *</label>
          <input type="password" id="rec-new-pass" placeholder="Mínimo 6 caracteres" required minlength="6" maxlength="100">
        </div>
        <div class="form-group">
          <label>Confirmar Nova Senha *</label>
          <input type="password" id="rec-confirm-pass" placeholder="Repita a nova senha" required minlength="6" maxlength="100">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="abrirModalEsqueciSenha()">Voltar</button>
        <button type="submit" class="btn-primary">Redefinir Senha</button>
      </div>
    </form>
  `);
  refreshIcons();
}

async function confirmarNovaSenha(e) {
  e.preventDefault();
  const code = $('rec-code')?.value?.trim();
  const newPass = $('rec-new-pass')?.value || '';
  const confirmPass = $('rec-confirm-pass')?.value || '';
  const savedCode = sessionStorage.getItem('ep_recovery_code');
  const email = sessionStorage.getItem('ep_recovery_email');

  if (!code || code !== savedCode) {
    return toast('Código de verificação incorreto ou expirado.', 'error');
  }

  if (newPass.length < 6) {
    return toast('A nova senha deve ter no mínimo 6 caracteres.', 'error');
  }

  if (newPass !== confirmPass) {
    return toast('As senhas digitadas não coincidem.', 'error');
  }

  const users = DB.get('usuarios');
  const idx = users.findIndex(x => x.email.toLowerCase() === email.toLowerCase());
  if (idx >= 0) {
    const salt = Security.generateSalt(16);
    const passwordHash = await Security.hashPassword(newPass, salt);
    users[idx].salt = salt;
    users[idx].passwordHash = passwordHash;
    delete users[idx].senha;
    DB.set('usuarios', users);

    Security.logAudit('SENHA_REDEFINIDA', `Senha do usuário ${email} redefinida com sucesso via código de verificação.`, 'SUCCESS');
    sessionStorage.removeItem('ep_recovery_code');
    sessionStorage.removeItem('ep_recovery_email');

    fecharModal();
    if ($('login-email')) $('login-email').value = email;
    if ($('login-senha')) $('login-senha').value = '';
    toast('Senha redefinida com sucesso! Você já pode entrar.', 'success');
  } else {
    toast('Erro ao atualizar usuário.', 'error');
  }
}

// ===== NOTIFICAÇÕES (SINO) =====
function toggleNotif(e) {
  if (e) e.stopPropagation();
  const dropdown = $('notif-dropdown');
  if (!dropdown) return;
  const isCurrentlyOpen = dropdown.classList.contains('open');
  if (!isCurrentlyOpen) {
    renderNotificacoes();
    dropdown.classList.add('open');
  } else {
    dropdown.classList.remove('open');
  }
  refreshIcons();
}

function fecharNotif() {
  $('notif-dropdown')?.classList.remove('open');
}

function renderNotificacoes() {
  const ps = products();
  const alerts = ps.filter(p => status(p) !== 'Normal');
  const list = $('notif-list');
  if (!list) return;

  if (!alerts.length) {
    list.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text2); font-size: 13px;">
        <i data-lucide="circle-check" style="width: 32px; height: 32px; color: #16a34a; margin-bottom: 8px; display: inline-block;"></i>
        <p>Todos os itens estão com nível de estoque normal!</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  list.innerHTML = alerts.map(p => {
    const st = status(p);
    const isDanger = st === 'Sem estoque' || st === 'Crítico';
    const safeId = Security.sanitizeId(p.id);
    return `
      <div class="notif-item" onclick="abrirDetalhesProduto('${safeId}');fecharNotif()">
        <div class="notif-item-icon ${isDanger ? 'danger' : 'warning'}">
          <i data-lucide="${isDanger ? 'triangle-alert' : 'clock-3'}"></i>
        </div>
        <div class="notif-item-content">
          <div class="notif-item-title">${esc(p.nome)}</div>
          <div class="notif-item-desc">${esc(st)}: Saldo atual ${Number(p.estoqueAtual)} ${esc(p.unidade)} (mínimo ${Number(p.estoqueMin)}).</div>
          <div class="notif-item-time">Ação requerida na reposição</div>
        </div>
      </div>
    `;
  }).join('');
  refreshIcons();
}

function limparNotificacoes(e) {
  if (e) e.stopPropagation();
  const notif = $('notif-badge');
  if (notif) notif.style.display = 'none';
  toast('Notificações marcadas como visualizadas.');
  fecharNotif();
}

document.addEventListener('click', e => {
  if (!e.target.closest('.topbar-user')) {
    $('user-dropdown')?.classList.remove('open');
  }
  if (!e.target.closest('.notif-wrapper')) {
    fecharNotif();
  }
});

function toggleMobileSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle('mobile-open');
  if (overlay) overlay.classList.toggle('active', isOpen);
  refreshIcons();
}

function closeMobileSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
}

function navigate(page, el) {
  closeMobileSidebar();
  if (page === 'configuracoes' && !Security.can('view_settings')) {
    return toast('Acesso negado: apenas administradores podem acessar as configurações.', 'error');
  }
  if (page === 'automacoes' && !Security.can('view_automations')) {
    return toast('Acesso negado: apenas administradores podem acessar automações.', 'error');
  }

  state.page = page;
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-bottom .nav-item').forEach(n => n.classList.remove('active'));

  const pgEl = $('pg-' + page);
  if (pgEl) pgEl.classList.add('active');

  const navEl = el || document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  renderPage(page);
  refreshIcons();
}

function renderPage(page) {
  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'produtos': renderProducts(); fillCategories(); break;
    case 'estoque': renderEstoque(); break;
    case 'movimentacoes': renderMovimentacoes(); break;
    case 'compras': renderCompras(); break;
    case 'fornecedores': renderFornecedores(); break;
    case 'relatorios': renderRelatorios(); break;
    case 'automacoes': renderAutomacoes(); break;
    case 'configuracoes': renderConfiguracoes(); break;
  }
  refreshIcons();
}

function updateNotificacoes() {
  const alertas = products().filter(p => status(p) !== 'Normal').length;
  const notif = $('notif-badge');
  if (notif) {
    notif.textContent = alertas > 0 ? String(alertas) : '0';
    notif.style.display = alertas > 0 ? 'flex' : 'none';
  }
}

function kpi(target, items) {
  const el = $(target);
  if (!el) return;
  el.innerHTML = items.map(x => `
    <div class="kpi-card ${esc(x.color || '')}">
      <div class="kpi-icon"><i data-lucide="${esc(x.icon || 'circle')}"></i></div>
      <div class="kpi-val">${esc(String(x.value))}</div>
      <div class="kpi-label">${esc(x.label)}</div>
      ${x.delta ? `<div class="kpi-delta ${esc(x.deltaType || 'up')}">${esc(x.delta)}</div>` : ''}
    </div>
  `).join('');
  refreshIcons();
}

// ===== DASHBOARD =====
function renderDashboard() {
  const ps = products();
  const total = ps.reduce((s, p) => s + (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0), 0);
  const critical = ps.filter(p => status(p) === 'Crítico' || status(p) === 'Sem estoque').length;

  kpi('dash-kpis', [
    { icon: 'package', value: ps.length, label: 'Produtos cadastrados', delta: 'Cadastrados' },
    { icon: 'wallet-cards', value: money(total), label: 'Valor em estoque' },
    { icon: 'triangle-alert', value: critical, label: 'Itens em situação crítica', color: 'red' },
    { icon: 'circle-check', value: '98%', label: 'Precisão do inventário', color: 'green' }
  ]);

  const attention = ps.filter(p => status(p) !== 'Normal').slice(0, 8);
  const tbody = $('dash-atencao-tbl')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = attention.length
      ? attention.map(p => `<tr>
          <td><strong>${esc(p.nome)}</strong><br><small>${esc(p.id)}</small></td>
          <td>${esc(p.categoria)}</td>
          <td>${Number(p.estoqueAtual).toLocaleString('pt-BR')} ${esc(p.unidade)}</td>
          <td>${Number(p.estoqueMin).toLocaleString('pt-BR')}</td>
          <td>${badge(status(p))}</td>
          <td>Hoje</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty-state">Nenhum item exige atenção no momento.</td></tr>';
  }

  if ($('dash-acoes')) {
    $('dash-acoes').innerHTML = attention.slice(0, 3).map(p => `
      <div class="alert-item ${status(p) === 'Sem estoque' ? 'danger' : 'warning'}" onclick="navigate('produtos')">
        <span class="alert-icon"><i data-lucide="${status(p) === 'Sem estoque' ? 'circle-slash' : 'triangle-alert'}"></i></span>
        <span class="alert-text"><strong>${esc(p.nome)}</strong>: ${esc(status(p))} (estoque abaixo do mínimo).</span>
      </div>
    `).join('') || '<p class="empty-state">Tudo em ordem no estoque.</p>';
  }
  refreshIcons();
}

function fillCategories() {
  const select = $('prod-cat');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Categoria: Todas</option>' + DB.get('categorias').map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  select.value = current;
}

// ===== PRODUTOS =====
function products() {
  return DB.get('produtos') || [];
}

function renderProducts() {
  const ps = products();
  const rawQ = $('prod-search')?.value || '';
  
  if (Security.detectSqlInjection(rawQ)) {
    Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection na busca de produtos: ${rawQ}`, 'CRITICAL');
    toast('Termo de busca com caracteres inválidos.', 'error');
    return;
  }
  
  const q = Security.sanitizeText(rawQ, 100).toLowerCase().trim();
  const cat = $('prod-cat')?.value || '';
  const st = $('prod-status')?.value || '';
  const loc = $('prod-local')?.value || '';
  const forn = $('prod-fornecedor')?.value || '';

  const filtered = ps.filter(p => {
    const mQ = !q || p.nome.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q);
    const mCat = !cat || p.categoria === cat;
    const mSt = !st || status(p) === st;
    const mLoc = !loc || p.local === loc;
    const mForn = !forn || p.fornecedor === forn;
    return mQ && mCat && mSt && mLoc && mForn;
  });

  kpi('prod-kpis', [
    { icon: 'package', value: ps.length, label: 'Total de produtos' },
    { icon: 'circle-check', value: ps.filter(p => status(p) === 'Normal').length, label: 'Em nível normal', color: 'green' },
    { icon: 'clock', value: ps.filter(p => status(p) === 'Atenção').length, label: 'Em atenção', color: 'yellow' },
    { icon: 'triangle-alert', value: ps.filter(p => status(p) === 'Crítico' || status(p) === 'Sem estoque').length, label: 'Críticos', color: 'red' }
  ]);

  const tbody = $('produtos-tbl')?.querySelector('tbody');
  const isAdmin = Security.can('delete_product');
  if (tbody) {
    tbody.innerHTML = filtered.length
      ? filtered.map(p => {
          const safeId = Security.sanitizeId(p.id);
          return `<tr>
            <td><strong>${esc(p.id)}</strong></td>
            <td><strong>${esc(p.nome)}</strong><br><small>${esc(p.desc || 'Sem descrição')}</small></td>
            <td>${esc(p.categoria)}</td>
            <td>${esc(p.unidade)}</td>
            <td><strong>${Number(p.estoqueAtual).toLocaleString('pt-BR')}</strong></td>
            <td>${Number(p.estoqueMin).toLocaleString('pt-BR')}</td>
            <td>${Number(p.estoqueMax).toLocaleString('pt-BR')}</td>
            <td>${badge(status(p))}</td>
            <td>
              <button class="btn-icon" title="Editar" onclick="editarProduto('${safeId}')"><i data-lucide="edit-2"></i></button>
              ${isAdmin ? `<button class="btn-icon" title="Excluir" onclick="excluirProduto('${safeId}')"><i data-lucide="trash-2"></i></button>` : ''}
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="9" class="empty-state">Nenhum produto encontrado com os filtros atuais.</td></tr>';
  }

  renderPagination(filtered.length);
  refreshIcons();
}

function renderPagination(total) {
  const el = $('prod-pagination');
  if (!el) return;
  el.innerHTML = `Mostrando ${total} produto(s)`;
}

function filtrarProdutos() {
  renderProducts();
}

function toggleFiltrosAvancados() {
  if ($('prod-search')) $('prod-search').value = '';
  if ($('prod-cat')) $('prod-cat').value = '';
  if ($('prod-status')) $('prod-status').value = '';
  if ($('prod-local')) $('prod-local').value = '';
  if ($('prod-fornecedor')) $('prod-fornecedor').value = '';
  renderProducts();
  toast('Filtros limpos.');
}

function abrirModalProduto(id = null) {
  if (!Security.can(id ? 'edit_product' : 'create_product')) {
    return toast('Acesso negado: permissão insuficiente.', 'error');
  }

  state.editingProductId = id;
  const p = id ? products().find(x => x.id === id) : null;
  const cats = DB.get('categorias');

  modal(id ? 'Editar Produto' : 'Novo Produto', `
    <form onsubmit="salvarProduto(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Código *</label>
          <input type="text" id="p-id" value="${esc(p?.id || '')}" ${id ? 'readonly' : ''} required maxlength="20">
        </div>
        <div class="form-group">
          <label>Categoria *</label>
          <select id="p-cat" required>
            ${cats.map(c => `<option value="${esc(c)}" ${p?.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Nome do Produto *</label>
        <input type="text" id="p-nome" value="${esc(p?.nome || '')}" required maxlength="100">
      </div>
      <div class="form-group">
        <label>Descrição</label>
        <input type="text" id="p-desc" value="${esc(p?.desc || '')}" maxlength="255">
      </div>
      <div class="form-row three">
        <div class="form-group">
          <label>Unidade *</label>
          <input type="text" id="p-unidade" value="${esc(p?.unidade || 'un')}" required maxlength="10">
        </div>
        <div class="form-group">
          <label>Estoque Atual *</label>
          <input type="number" id="p-atual" value="${Number(p?.estoqueAtual) || 0}" min="0" step="0.01" required>
        </div>
        <div class="form-group">
          <label>Custo Unitário (R$) *</label>
          <input type="number" id="p-custo" value="${Number(p?.custo) || 0}" min="0" step="0.01" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Estoque Mínimo *</label>
          <input type="number" id="p-min" value="${Number(p?.estoqueMin) || 0}" min="0" step="0.01" required>
        </div>
        <div class="form-group">
          <label>Estoque Máximo *</label>
          <input type="number" id="p-max" value="${Number(p?.estoqueMax) || 0}" min="0" step="0.01" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Fornecedor</label>
          <input type="text" id="p-forn" value="${esc(p?.fornecedor || '')}" maxlength="100">
        </div>
        <div class="form-group">
          <label>Localização</label>
          <input type="text" id="p-local" value="${esc(p?.local || '')}" maxlength="50">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Salvar Produto</button>
      </div>
    </form>
  `);
}

function salvarProduto(e) {
  e.preventDefault();
  const id = state.editingProductId;
  if (!Security.can(id ? 'edit_product' : 'create_product')) {
    return toast('Acesso negado: permissão insuficiente.', 'error');
  }

  const rawId = $('p-id')?.value || '';
  const rawNome = $('p-nome')?.value || '';
  const rawDesc = $('p-desc')?.value || '';
  const rawForn = $('p-forn')?.value || '';
  const rawLocal = $('p-local')?.value || '';

  if ([rawId, rawNome, rawDesc, rawForn, rawLocal].some(v => Security.detectSqlInjection(v))) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection detectada no formulário de produto.', 'CRITICAL');
    return toast('Os dados contêm caracteres ou termos SQL não permitidos.', 'error');
  }

  const code = Security.sanitizeId(rawId).toUpperCase();
  const nome = Security.sanitizeText(rawNome, 100);
  const desc = Security.sanitizeText(rawDesc, 255);
  const cat = Security.sanitizeText($('p-cat')?.value || '', 50);
  const unidade = Security.sanitizeText($('p-unidade')?.value || 'un', 10);
  const atual = Security.sanitizeNumber($('p-atual')?.value, 0);
  const min = Security.sanitizeNumber($('p-min')?.value, 0);
  const max = Security.sanitizeNumber($('p-max')?.value, 0);
  const custo = Security.sanitizeNumber($('p-custo')?.value, 0);
  const fornecedor = Security.sanitizeText(rawForn, 100);
  const local = Security.sanitizeText(rawLocal, 50);

  if (max > 0 && max < min) {
    return toast('O estoque máximo não pode ser menor que o estoque mínimo.', 'error');
  }

  const ps = products();
  if (!id && ps.some(x => x.id === code)) {
    return toast('Já existe um produto cadastrado com esse código.', 'error');
  }

  const prod = {
    id: code,
    nome,
    desc,
    categoria: cat,
    unidade,
    estoqueAtual: atual,
    estoqueMin: min,
    estoqueMax: max,
    custo,
    fornecedor,
    local,
    ativo: true
  };

  if (id) {
    const idx = ps.findIndex(x => x.id === id);
    if (idx >= 0) ps[idx] = { ...ps[idx], ...prod };
    Security.logAudit('PRODUTO_ATUALIZADO', `Produto ${code} (${nome}) atualizado.`);
  } else {
    ps.unshift(prod);
    Security.logAudit('PRODUTO_CRIADO', `Produto ${code} (${nome}) cadastrado.`);
  }

  DB.set('produtos', ps);
  fecharModal();
  renderProducts();
  updateNotificacoes();
  toast(id ? 'Produto atualizado com sucesso!' : 'Produto cadastrado com sucesso!', 'success');
}

function editarProduto(id) {
  abrirModalProduto(id);
}

function excluirProduto(id) {
  if (!Security.can('delete_product')) {
    return toast('Acesso negado: apenas administradores podem excluir produtos.', 'error');
  }
  const safeId = Security.sanitizeId(id);
  const p = products().find(x => x.id === safeId);
  if (!p) return;

  if (confirm(`Tem certeza que deseja excluir o produto "${p.nome}" (${safeId})?`)) {
    const ps = products().filter(x => x.id !== safeId);
    DB.set('produtos', ps);
    Security.logAudit('PRODUTO_EXCLUIDO', `Produto ${safeId} (${p.nome}) excluído.`);
    renderProducts();
    updateNotificacoes();
    toast('Produto excluído com sucesso.');
  }
}

function exportarProdutos() {
  if (typeof montarCsvProdutos === 'function') {
    const content = montarCsvProdutos();
    downloadCsvReport('relatorio-produtos', content);
    Security.logAudit('EXPORTACAO_CSV', 'Exportação de planilha de produtos.');
    toast('Exportação concluída.', 'success');
  }
}

// ===== IMPORTAÇÃO DE PLANILHA DE PRODUTOS =====
window._planilhaImportacaoTemp = [];

function abrirModalImportarProdutos() {
  if (!Security.can('create_product')) {
    return toast('Acesso negado: permissão insuficiente para importar produtos.', 'error');
  }

  // Carrega planilha padrão por padrão
  window._planilhaImportacaoTemp = [
    { id: 'MP-0004', nome: 'Barra de Aço 1/2"', desc: 'Barra redonda 1020 6m', categoria: 'Matéria-prima', unidade: 'm', estoqueAtual: 340, estoqueMin: 100, estoqueMax: 600, custo: 18.50, fornecedor: 'Metalúrgica São José', local: 'Almoxarifado 01' },
    { id: 'COMP-0003', nome: 'Arruela Lisa M8', desc: 'Aço carbono zincado', categoria: 'Componentes', unidade: 'un', estoqueAtual: 750, estoqueMin: 300, estoqueMax: 1500, custo: 0.15, fornecedor: 'Parafusos Brasil', local: 'Almoxarifado 01' },
    { id: 'EMB-0003', nome: 'Plástico Bolha 1,20m', desc: 'Bobina 50 metros', categoria: 'Embalagem', unidade: 'un', estoqueAtual: 22, estoqueMin: 15, estoqueMax: 50, custo: 48.00, fornecedor: 'Embalagens Brasil', local: 'Galpão B' },
    { id: 'EPI-0003', nome: 'Óculos de Proteção Incolor', desc: 'Anti-risco e anti-embaçante', categoria: 'EPI', unidade: 'un', estoqueAtual: 65, estoqueMin: 30, estoqueMax: 120, custo: 14.90, fornecedor: 'Tradição Representações', local: 'Almoxarifado 03' }
  ];

  modal('Importar Produtos (Planilha Excel / CSV)', `
    <div class="import-toolbar">
      <div>
        <strong>Planilha Padrão para Importação</strong>
        <p style="font-size: 11.5px; color: var(--text2); margin-top: 2px;">Baixe o modelo ou faça upload de um arquivo CSV / Excel formatado.</p>
      </div>
      <div class="import-buttons">
        <button type="button" class="btn-outline sm" onclick="baixarPlanilhaModelo()"><i data-lucide="download"></i> Baixar Modelo (.csv)</button>
        <label class="btn-primary sm" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
          <i data-lucide="file-up"></i> Selecionar Arquivo
          <input type="file" accept=".csv,.txt,.xlsx,.xls" onchange="processarArquivoPlanilha(this)" style="display: none;">
        </label>
        <button type="button" class="btn-outline sm" onclick="carregarPlanilhaExemplo()"><i data-lucide="refresh-cw"></i> Restaurar Padrão</button>
      </div>
    </div>

    <div class="import-summary-bar">
      <span>Pré-visualização dos itens a serem importados (<strong id="import-count">${window._planilhaImportacaoTemp.length}</strong> itens)</span>
      <span style="font-size: 11px; color: #16a34a;"><i data-lucide="shield-check" style="width: 13px; height: 13px; vertical-align: middle;"></i> Dados higienizados contra injeções SQL</span>
    </div>

    <div class="import-preview-wrap">
      <table id="import-preview-tbl">
        <thead>
          <tr>
            <th>Código</th><th>Produto</th><th>Descrição</th><th>Categoria</th><th>Unid.</th><th>Est. Atual</th><th>Est. Mín.</th><th>Est. Máx.</th><th>Custo (R$)</th><th>Fornecedor</th><th>Local</th>
          </tr>
        </thead>
        <tbody id="import-preview-tbody">
          ${renderTabelaImportacao()}
        </tbody>
      </table>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
      <button type="button" class="btn-primary" onclick="executarImportacaoProdutos()"><i data-lucide="check"></i> Confirmar Importação</button>
    </div>
  `);

  $('modal-box').classList.add('modal-wide');
  refreshIcons();
}

function renderTabelaImportacao() {
  if (!window._planilhaImportacaoTemp || !window._planilhaImportacaoTemp.length) {
    return '<tr><td colspan="11" class="empty-state">Nenhum item na planilha. Selecione um arquivo ou clique em "Restaurar Padrão".</td></tr>';
  }
  return window._planilhaImportacaoTemp.map(p => `
    <tr>
      <td><strong>${esc(p.id)}</strong></td>
      <td><strong>${esc(p.nome)}</strong></td>
      <td><small>${esc(p.desc || '—')}</small></td>
      <td><span class="category-pill">${esc(p.categoria)}</span></td>
      <td>${esc(p.unidade)}</td>
      <td>${Number(p.estoqueAtual).toLocaleString('pt-BR')}</td>
      <td>${Number(p.estoqueMin).toLocaleString('pt-BR')}</td>
      <td>${Number(p.estoqueMax).toLocaleString('pt-BR')}</td>
      <td>${money(p.custo)}</td>
      <td>${esc(p.fornecedor || '—')}</td>
      <td>${esc(p.local || '—')}</td>
    </tr>
  `).join('');
}

function carregarPlanilhaExemplo() {
  window._planilhaImportacaoTemp = [
    { id: 'MP-0004', nome: 'Barra de Aço 1/2"', desc: 'Barra redonda 1020 6m', categoria: 'Matéria-prima', unidade: 'm', estoqueAtual: 340, estoqueMin: 100, estoqueMax: 600, custo: 18.50, fornecedor: 'Metalúrgica São José', local: 'Almoxarifado 01' },
    { id: 'COMP-0003', nome: 'Arruela Lisa M8', desc: 'Aço carbono zincado', categoria: 'Componentes', unidade: 'un', estoqueAtual: 750, estoqueMin: 300, estoqueMax: 1500, custo: 0.15, fornecedor: 'Parafusos Brasil', local: 'Almoxarifado 01' },
    { id: 'EMB-0003', nome: 'Plástico Bolha 1,20m', desc: 'Bobina 50 metros', categoria: 'Embalagem', unidade: 'un', estoqueAtual: 22, estoqueMin: 15, estoqueMax: 50, custo: 48.00, fornecedor: 'Embalagens Brasil', local: 'Galpão B' },
    { id: 'EPI-0003', nome: 'Óculos de Proteção Incolor', desc: 'Anti-risco e anti-embaçante', categoria: 'EPI', unidade: 'un', estoqueAtual: 65, estoqueMin: 30, estoqueMax: 120, custo: 14.90, fornecedor: 'Tradição Representações', local: 'Almoxarifado 03' }
  ];
  const tbody = $('import-preview-tbody');
  if (tbody) tbody.innerHTML = renderTabelaImportacao();
  const count = $('import-count');
  if (count) count.textContent = String(window._planilhaImportacaoTemp.length);
  toast('Planilha padrão carregada.');
  refreshIcons();
}

function baixarPlanilhaModelo() {
  const headers = ['Código', 'Produto', 'Descrição', 'Categoria', 'Unidade', 'Estoque Atual', 'Estoque Mínimo', 'Estoque Máximo', 'Custo Unitário (R$)', 'Fornecedor', 'Localização'];
  const sampleRows = [
    ['PROD-0101', 'Parafuso Allen M6', 'Aço 8.8 com rosca total', 'Componentes', 'un', '500', '150', '800', '0.65', 'Parafusos Brasil', 'Almoxarifado 01'],
    ['PROD-0102', 'Luva Nitrílica', 'Tamanho M cano médio', 'EPI', 'par', '80', '40', '200', '9.80', 'Tradição Representações', 'Almoxarifado 03']
  ];
  const csvContent = `sep=;\r\n${headers.map(h => Security.sanitizeCsvCell(h)).join(';')}\r\n${sampleRows.map(r => r.map(c => Security.sanitizeCsvCell(c)).join(';')).join('\r\n')}`;
  downloadCsvReport('modelo-importacao-produtos', csvContent);
  toast('Planilha modelo baixada com sucesso.', 'success');
}

function processarArquivoPlanilha(input) {
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0 && !line.startsWith('sep='));
    if (lines.length < 2) {
      return toast('Arquivo vazio ou sem linhas de dados.', 'error');
    }

    const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.slice(1).map(line => {
      // Divide respeitando aspas
      const values = line.split(delimiter).map(v => v.replace(/^["']|["']$/g, '').trim());
      if (values.length < 2 || !values[0]) return null;
      return {
        id: Security.sanitizeId(values[0]).toUpperCase(),
        nome: Security.sanitizeText(values[1] || 'Produto Importado', 100),
        desc: Security.sanitizeText(values[2] || '', 255),
        categoria: Security.sanitizeText(values[3] || 'Outros', 50),
        unidade: Security.sanitizeText(values[4] || 'un', 10),
        estoqueAtual: Security.sanitizeNumber(values[5], 0),
        estoqueMin: Security.sanitizeNumber(values[6], 0),
        estoqueMax: Security.sanitizeNumber(values[7], 0),
        custo: Security.sanitizeNumber(values[8], 0),
        fornecedor: Security.sanitizeText(values[9] || '', 100),
        local: Security.sanitizeText(values[10] || '', 50)
      };
    }).filter(Boolean);

    if (!rows.length) {
      return toast('Não foi possível identificar produtos válidos no arquivo.', 'error');
    }

    window._planilhaImportacaoTemp = rows;
    const tbody = $('import-preview-tbody');
    if (tbody) tbody.innerHTML = renderTabelaImportacao();
    const count = $('import-count');
    if (count) count.textContent = String(rows.length);
    toast(`${rows.length} produtos carregados do arquivo.`, 'success');
    refreshIcons();
  };
  reader.readAsText(file, 'UTF-8');
}

function executarImportacaoProdutos() {
  if (!Security.can('create_product')) {
    return toast('Acesso negado.', 'error');
  }

  const itemsToImport = window._planilhaImportacaoTemp;
  if (!itemsToImport || !itemsToImport.length) {
    return toast('Nenhum item para importar.', 'error');
  }

  const currentProducts = products();
  let countAdded = 0;
  let countUpdated = 0;

  for (const item of itemsToImport) {
    if ([item.id, item.nome, item.desc, item.categoria, item.fornecedor, item.local].some(v => Security.detectSqlInjection(v))) {
      Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection bloqueada durante importação: ${item.id}`, 'CRITICAL');
      continue;
    }

    const safeItem = {
      id: Security.sanitizeId(item.id).toUpperCase(),
      nome: Security.sanitizeText(item.nome, 100),
      desc: Security.sanitizeText(item.desc, 255),
      categoria: Security.sanitizeText(item.categoria || 'Outros', 50),
      unidade: Security.sanitizeText(item.unidade || 'un', 10),
      estoqueAtual: Security.sanitizeNumber(item.estoqueAtual, 0),
      estoqueMin: Security.sanitizeNumber(item.estoqueMin, 0),
      estoqueMax: Security.sanitizeNumber(item.estoqueMax, 0),
      custo: Security.sanitizeNumber(item.custo, 0),
      fornecedor: Security.sanitizeText(item.fornecedor, 100),
      local: Security.sanitizeText(item.local, 50),
      ativo: true
    };

    const existingIdx = currentProducts.findIndex(p => p.id === safeItem.id);
    if (existingIdx >= 0) {
      currentProducts[existingIdx] = { ...currentProducts[existingIdx], ...safeItem };
      countUpdated++;
    } else {
      currentProducts.unshift(safeItem);
      countAdded++;
    }
  }

  DB.set('produtos', currentProducts);
  Security.logAudit('IMPORTACAO_PLANILHA', `Importação de planilha concluída. ${countAdded} adicionados, ${countUpdated} atualizados.`);
  fecharModal();
  renderProducts();
  updateNotificacoes();
  toast(`Importação concluída! (${countAdded} adicionados, ${countUpdated} atualizados)`, 'success');
}

// ===== ESTOQUE =====
function renderEstoque() {
  const ps = products();
  const total = ps.reduce((s, p) => s + (Number(p.estoqueAtual) || 0) * (Number(p.custo) || 0), 0);
  const units = ps.reduce((s, p) => s + (Number(p.estoqueAtual) || 0), 0);
  const alerts = ps.filter(p => status(p) !== 'Normal');

  kpi('est-kpis', [
    { icon: 'wallet-cards', value: money(total), label: 'Valor total em estoque' },
    { icon: 'package', value: units.toLocaleString('pt-BR'), label: 'Itens em estoque' },
    { icon: 'trending-up', value: '12%', label: 'Giro médio mensal', color: 'green' },
    { icon: 'triangle-alert', value: alerts.length, label: 'Itens para acompanhar', color: 'yellow' }
  ]);

  const top = [...ps].sort((a, b) => (Number(b.estoqueAtual) * Number(b.custo)) - (Number(a.estoqueAtual) * Number(a.custo))).slice(0, 5);
  const tbody = $('est-top-tbl')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = top.map((p, i) => {
      const val = Number(p.estoqueAtual) * Number(p.custo);
      const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td><strong>#${i + 1}</strong></td>
        <td><strong>${esc(p.nome)}</strong><br><small>${esc(p.id)}</small></td>
        <td>${esc(p.categoria)}</td>
        <td><strong>${money(val)}</strong></td>
        <td>${pct}%</td>
      </tr>`;
    }).join('');
  }

  const alertContainer = $('est-alertas');
  if (alertContainer) {
    alertContainer.innerHTML = alerts.slice(0, 5).map(p => `
      <div class="alert-item ${status(p) === 'Sem estoque' ? 'danger' : 'warning'}">
        <span class="alert-icon"><i data-lucide="triangle-alert"></i></span>
        <span class="alert-text"><strong>${esc(p.nome)}</strong>: Saldo ${Number(p.estoqueAtual)} (mínimo ${Number(p.estoqueMin)}).</span>
      </div>
    `).join('') || '<p class="empty-state">Nenhum alerta pendente.</p>';
  }
  refreshIcons();
}

// ===== MOVIMENTAÇÕES =====
function renderMovimentacoes() {
  const movs = DB.get('movimentacoes') || [];
  kpi('mov-kpis', [
    { icon: 'arrow-left-right', value: movs.length, label: 'Movimentações registradas' },
    { icon: 'arrow-down-to-line', value: movs.filter(m => m.tipo === 'Entrada').length, label: 'Entradas' },
    { icon: 'arrow-up-from-line', value: movs.filter(m => m.tipo === 'Saída').length, label: 'Saídas' },
    { icon: 'wrench', value: movs.filter(m => m.tipo === 'Ajuste').length, label: 'Ajustes' }
  ]);

  const f = state.movFilter;
  const filtered = (f === 'Todas' ? movs : movs.filter(m => m.tipo === f)).slice(0, 30);

  const tbody = $('mov-tbl')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = filtered.length
      ? filtered.map(m => `<tr>
          <td>${date(m.data)}</td>
          <td>${badge(m.tipo)}</td>
          <td><strong>${esc(m.produto)}</strong><br><small>${esc(m.produtoId)}</small></td>
          <td><strong>${m.quantidade > 0 ? '+' : ''}${m.quantidade}</strong></td>
          <td>${esc(m.local || '—')}</td>
          <td>${esc(m.responsavel || '—')}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty-state">Nenhuma movimentação encontrada.</td></tr>';
  }
  refreshIcons();
}

function filtrarMovTab(tipo, el) {
  state.movFilter = tipo;
  document.querySelectorAll('#mov-tabs .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderMovimentacoes();
}

// ===== COMPRAS =====
function renderCompras() {
  const ps = products();
  const need = ps.filter(p => Number(p.estoqueAtual) < Number(p.estoqueMin));
  const estimatedTotal = need.reduce((s, p) => s + Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual)) * Number(p.custo), 0);

  kpi('comp-kpis', [
    { icon: 'shopping-cart', value: need.length, label: 'Itens para reposição', color: 'yellow' },
    { icon: 'clock', value: '3', label: 'Pedidos em aberto' },
    { icon: 'wallet-cards', value: money(estimatedTotal), label: 'Valor estimado' },
    { icon: 'triangle-alert', value: need.filter(p => status(p) === 'Crítico' || status(p) === 'Sem estoque').length, label: 'Alta criticidade', color: 'red' }
  ]);

  const tbody = $('comp-tbl')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = need.length
      ? need.map(p => {
          const qty = Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual));
          const val = qty * Number(p.custo);
          const safeId = Security.sanitizeId(p.id);
          return `<tr>
            <td><strong>${esc(p.nome)}</strong><br><small>${esc(p.id)} · ${esc(p.fornecedor || 'Sem fornecedor')}</small></td>
            <td>${Number(p.estoqueAtual)} ${esc(p.unidade)}</td>
            <td>${Number(p.estoqueMin)}</td>
            <td><strong>${qty} ${esc(p.unidade)}</strong></td>
            <td>${money(val)}</td>
            <td>${badge(status(p))}</td>
            <td><button class="btn-primary sm" onclick="abrirModalCompra('${safeId}')">+ Pedido</button></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="empty-state">Nenhum item precisa de reposição no momento.</td></tr>';
  }
  refreshIcons();
}

function abrirModalCompra(prodId = '') {
  if (!Security.can('create_purchase')) {
    return toast('Acesso negado: permissão insuficiente para emitir pedidos.', 'error');
  }

  const ps = products();
  const safeId = Security.sanitizeId(prodId);
  const p = safeId ? ps.find(x => x.id === safeId) : null;
  const qty = p ? Math.max(0, Number(p.estoqueMax) - Number(p.estoqueAtual)) : 100;

  modal('Novo Pedido de Compra', `
    <form onsubmit="salvarPedidoCompra(event)">
      <div class="form-group">
        <label>Produto *</label>
        <select id="po-prod" required>
          ${ps.map(x => `<option value="${esc(x.id)}" ${x.id === safeId ? 'selected' : ''}>${esc(x.id)} - ${esc(x.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Quantidade *</label>
          <input type="number" id="po-qty" value="${qty}" min="1" step="1" required>
        </div>
        <div class="form-group">
          <label>Data Prevista de Entrega</label>
          <input type="date" id="po-date" value="${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}">
        </div>
      </div>
      <div class="form-group">
        <label>Observações</label>
        <input type="text" id="po-obs" placeholder="Número de cotação ou observações" maxlength="255">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Emitir Pedido</button>
      </div>
    </form>
  `);
}

function salvarPedidoCompra(e) {
  e.preventDefault();
  const prodId = Security.sanitizeId($('po-prod')?.value || '');
  const qty = Security.sanitizeNumber($('po-qty')?.value, 1, 1);
  const obs = Security.sanitizeText($('po-obs')?.value || '', 255);

  if (Security.detectSqlInjection(obs)) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection em observações de compra.', 'CRITICAL');
    return toast('Caracteres inválidos.', 'error');
  }

  Security.logAudit('PEDIDO_COMPRA_CRIADO', `Pedido de compra gerado para produto ${prodId}. Quantidade: ${qty}. Obs: ${obs}`);
  fecharModal();
  toast('Pedido de compra registrado com sucesso!', 'success');
}

// ===== FORNECEDORES =====
function renderFornecedores() {
  const fs = DB.get('fornecedores') || [];
  const rawQ = $('forn-search')?.value || '';

  if (Security.detectSqlInjection(rawQ)) {
    Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection na busca de fornecedores: ${rawQ}`, 'CRITICAL');
    toast('Termo de busca inválido.', 'error');
    return;
  }

  const q = Security.sanitizeText(rawQ, 100).toLowerCase().trim();
  const filtered = fs.filter(f => !q || f.nome.toLowerCase().includes(q) || f.categoria.toLowerCase().includes(q) || f.cnpj.includes(q));

  const totalCompras = fs.reduce((s, f) => s + (Number(f.totalCompras) || 0), 0);
  const aprovados = fs.filter(f => f.situacao === 'Aprovado').length;
  const mediaGeral = fs.length ? (fs.reduce((s, f) => s + (Number(f.avaliacao) || 0), 0) / fs.length).toFixed(1) : '—';

  kpi('forn-kpis', [
    { icon: 'handshake', value: fs.length, label: 'Fornecedores cadastrados' },
    { icon: 'circle-check', value: aprovados, label: 'Aprovados', color: 'green' },
    { icon: 'star', value: mediaGeral, label: 'Avaliação média' },
    { icon: 'wallet-cards', value: money(totalCompras), label: 'Compras acumuladas' }
  ]);

  const tbody = $('forn-tbl')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = filtered.length
      ? filtered.map(f => {
          const media = Number(f.avaliacao) || null;
          const notaDisplay = media !== null ? `${media.toFixed(1)} / 5.0` : '—';
          return `<tr>
            <td><strong>${esc(f.nome)}</strong><br><small>${esc(f.cnpj)}</small></td>
            <td>${esc(f.categoria)}</td>
            <td><span class="rating-badge"><i data-lucide="star"></i> ${notaDisplay}</span></td>
            <td>${f.entregasPrazo}%</td>
            <td>${date(f.ultimaCompra)}</td>
            <td>${badge(f.situacao)}</td>
            <td>
              <button class="btn-icon" title="Avaliar fornecedor" onclick="abrirModalAvaliacao(${Number(f.id)})"><i data-lucide="award"></i> Avaliar</button>
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="empty-state">Nenhum fornecedor encontrado.</td></tr>';
  }
  refreshIcons();
}

function filtrarFornecedores() {
  renderFornecedores();
}

function abrirModalFornecedor() {
  if (!Security.can('create_supplier')) {
    return toast('Acesso negado: permissão insuficiente para cadastrar fornecedores.', 'error');
  }

  modal('Novo Fornecedor', `
    <form onsubmit="salvarFornecedor(event)">
      <div class="form-group">
        <label>Nome / Razão Social *</label>
        <input type="text" id="f-nome" required maxlength="100">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>CNPJ *</label>
          <input type="text" id="f-cnpj" placeholder="00.000.000/0000-00" required maxlength="18">
        </div>
        <div class="form-group">
          <label>Categoria *</label>
          <input type="text" id="f-cat" required maxlength="50" placeholder="Ex.: Metalúrgicos">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Salvar Fornecedor</button>
      </div>
    </form>
  `);
}

function salvarFornecedor(e) {
  e.preventDefault();
  if (!Security.can('create_supplier')) {
    return toast('Acesso negado.', 'error');
  }

  const rawNome = $('f-nome')?.value || '';
  const rawCnpj = $('f-cnpj')?.value || '';
  const rawCat = $('f-cat')?.value || '';

  if ([rawNome, rawCnpj, rawCat].some(v => Security.detectSqlInjection(v))) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection em cadastro de fornecedor.', 'CRITICAL');
    return toast('Caracteres inválidos.', 'error');
  }

  const forn = {
    id: DB.nextId('fornecedores'),
    nome: Security.sanitizeText(rawNome, 100),
    cnpj: Security.sanitizeText(rawCnpj, 18),
    categoria: Security.sanitizeText(rawCat, 50),
    avaliacao: 5.0,
    entregasPrazo: 100,
    qualidade: 100,
    ultimaCompra: new Date().toISOString().slice(0, 10),
    situacao: 'Em avaliação',
    totalCompras: 0
  };

  const fs = DB.get('fornecedores');
  fs.unshift(forn);
  DB.set('fornecedores', fs);
  Security.logAudit('FORNECEDOR_CRIADO', `Fornecedor ${forn.nome} (${forn.cnpj}) cadastrado.`);
  fecharModal();
  renderFornecedores();
  toast('Fornecedor cadastrado com sucesso!', 'success');
}

function abrirModalAvaliacao(id) {
  const f = DB.get('fornecedores').find(x => x.id === id);
  if (!f) return;

  modal(`Avaliar Fornecedor: ${esc(f.nome)}`, `
    <form onsubmit="salvarAvaliacao(event, ${id})">
      <div class="form-group">
        <label>Nota Geral (1 a 5) *</label>
        <input type="number" id="av-nota" value="${f.avaliacao}" min="1" max="5" step="0.1" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Entregas no Prazo (%) *</label>
          <input type="number" id="av-prazo" value="${f.entregasPrazo}" min="0" max="100" required>
        </div>
        <div class="form-group">
          <label>Qualidade do Material (%) *</label>
          <input type="number" id="av-qual" value="${f.qualidade}" min="0" max="100" required>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Salvar Avaliação</button>
      </div>
    </form>
  `);
}

function salvarAvaliacao(e, id) {
  e.preventDefault();
  const nota = Security.sanitizeNumber($('av-nota')?.value, 5.0, 1, 5);
  const prazo = Security.sanitizeNumber($('av-prazo')?.value, 100, 0, 100);
  const qual = Security.sanitizeNumber($('av-qual')?.value, 100, 0, 100);

  const fs = DB.get('fornecedores');
  const idx = fs.findIndex(x => x.id === id);
  if (idx >= 0) {
    fs[idx].avaliacao = nota;
    fs[idx].entregasPrazo = prazo;
    fs[idx].qualidade = qual;
    fs[idx].situacao = nota >= 4.0 ? 'Aprovado' : nota >= 3.0 ? 'Em avaliação' : 'Bloqueado';
    DB.set('fornecedores', fs);
    Security.logAudit('FORNECEDOR_AVALIADO', `Fornecedor ${fs[idx].nome} avaliado com nota ${nota}.`);
  }

  fecharModal();
  renderFornecedores();
  toast('Avaliação registrada com sucesso!', 'success');
}

// ===== RELATÓRIOS =====
function renderRelatorios() {
  if (typeof window.renderRelatorios === 'function' && window.renderRelatorios !== renderRelatorios) {
    window.renderRelatorios();
    return;
  }
}

// ===== CONFIGURAÇÕES =====
function renderConfiguracoes() {
  if (!Security.can('view_settings')) {
    return toast('Acesso negado: apenas administradores podem ver as configurações.', 'error');
  }

  const us = DB.get('usuarios') || [];
  const tbody = $('user-tbl')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = us.map(u => `
      <tr>
        <td><strong>${esc(u.nome)}</strong></td>
        <td>${esc(u.email)}</td>
        <td>${badge(u.perfil)}</td>
        <td>
          <button class="btn-icon" title="Editar usuário" onclick="abrirModalUsuario('${Security.sanitizeId(u.email)}')"><i data-lucide="pencil"></i></button>
          ${us.length > 1 && u.email !== state.user?.email ? `<button class="btn-icon" title="Excluir usuário" onclick="excluirUsuario('${Security.sanitizeId(u.email)}')"><i data-lucide="trash-2"></i></button>` : ''}
        </td>
      </tr>
    `).join('');
  }

  const cats = DB.get('categorias') || [];
  const catList = $('cat-list');
  if (catList) {
    catList.innerHTML = cats.map(c => `
      <div class="cat-item">
        <span>${esc(c)}</span>
        <span class="cat-lock-icon" title="Categoria do sistema"><i data-lucide="lock"></i></span>
      </div>
    `).join('');
  }

  renderAuditLogs();
  refreshIcons();
}

const auditStatusMap = {
  'SUCCESS': { label: 'Sucesso', badge: 'normal' },
  'FAILURE': { label: 'Falha', badge: 'atencao' },
  'CRITICAL': { label: 'Crítico', badge: 'critico' },
  'INFO': { label: 'Informativo', badge: 'ajuste' }
};

const auditActionMap = {
  'LOGIN_SUCESSO': 'Login realizado',
  'LOGIN_FALHOU': 'Falha no login',
  'LOGIN_BLOQUEADO_RATE_LIMIT': 'Bloqueio por tentativas',
  'LOGOUT': 'Encerramento de sessão',
  'SISTEMA_INICIALIZADO': 'Inicialização do sistema',
  'SISTEMA_MIGRACAO_SENHAS': 'Migração de senhas',
  'PRODUTO_CRIADO': 'Cadastro de produto',
  'PRODUTO_ATUALIZADO': 'Atualização de produto',
  'PRODUTO_EXCLUIDO': 'Exclusão de produto',
  'IMPORTACAO_PLANILHA': 'Importação de planilha',
  'EXPORTACAO_CSV': 'Exportação CSV',
  'MOVIMENTACAO_REGISTRADA': 'Registro de movimentação',
  'PEDIDO_COMPRA_CRIADO': 'Pedido de compra',
  'FORNECEDOR_CRIADO': 'Cadastro de fornecedor',
  'FORNECEDOR_AVALIADO': 'Avaliação de fornecedor',
  'USUARIO_CRIADO': 'Cadastro de usuário',
  'USUARIO_ATUALIZADO': 'Atualização de usuário',
  'USUARIO_EXCLUIDO': 'Exclusão de usuário',
  'SENHA_REDEFINIDA': 'Redefinição de senha',
  'CATEGORIA_CRIADA': 'Cadastro de categoria',
  'AUTOMACAO_CRIADA': 'Cadastro de automação',
  'AUTOMACAO_ALTERADA': 'Alteração de automação',
  'AUTOMACAO_EXCLUIDA': 'Exclusão de automação',
  'SQL_INJECTION_DETECTADA': 'Tentativa anti-SQL bloqueada',
  'AUDIT_LOGS_EXPORTED': 'Exportação de auditoria'
};

function renderAuditLogs() {
  const container = $('audit-logs-container');
  if (!container) return;

  const logs = (DB.get('audit_log') || []).slice(0, 15);
  container.innerHTML = `
    <div class="card" style="margin-top: 24px;">
      <div class="card-header">
        <div>
          <span class="card-title">Trilha de Auditoria e Segurança</span>
          <p class="card-helper">Registro de eventos operacionais, autenticações e proteção SQL</p>
        </div>
        <button class="btn-outline sm" onclick="exportarLogsAuditoria()"><i data-lucide="download"></i> Exportar Logs</button>
      </div>
      <div class="table-wrap">
        <table class="tbl" id="audit-tbl">
          <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Perfil</th><th>Ação</th><th>Status</th><th>Detalhes</th></tr></thead>
          <tbody>
            ${logs.length ? logs.map(l => {
              const st = auditStatusMap[l.status] || { label: l.status, badge: 'normal' };
              const actName = auditActionMap[l.action] || l.action;
              return `
                <tr>
                  <td><small>${new Date(l.timestamp).toLocaleString('pt-BR')}</small></td>
                  <td><strong>${esc(l.actorName)}</strong></td>
                  <td><span class="badge ${l.actorPerfil === 'Administrador' ? 'normal' : 'ajuste'}">${esc(l.actorPerfil)}</span></td>
                  <td><strong>${esc(actName)}</strong><br><small style="color: var(--text2); font-size: 10.5px;">${esc(l.action)}</small></td>
                  <td><span class="badge ${st.badge}">${esc(st.label)}</span></td>
                  <td><small>${esc(l.details)}</small></td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="6" class="empty-state">Nenhum registro de auditoria no momento.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  refreshIcons();
}

function exportarLogsAuditoria() {
  const logs = DB.get('audit_log') || [];
  const headers = ['ID', 'Data/Hora', 'Usuário', 'E-mail', 'Perfil', 'Ação', 'Status', 'Detalhes', 'User-Agent'];
  const rows = logs.map(l => {
    const st = auditStatusMap[l.status]?.label || l.status;
    const act = auditActionMap[l.action] || l.action;
    return [
      Security.sanitizeCsvCell(l.id),
      Security.sanitizeCsvCell(new Date(l.timestamp).toLocaleString('pt-BR')),
      Security.sanitizeCsvCell(l.actorName),
      Security.sanitizeCsvCell(l.actorEmail),
      Security.sanitizeCsvCell(l.actorPerfil),
      Security.sanitizeCsvCell(`${act} (${l.action})`),
      Security.sanitizeCsvCell(st),
      Security.sanitizeCsvCell(l.details),
      Security.sanitizeCsvCell(l.userAgent)
    ];
  });
  const content = `sep=;\r\n${headers.map(h => Security.sanitizeCsvCell(h)).join(';')}\r\n${rows.map(r => r.join(';')).join('\r\n')}`;
  downloadCsvReport('trilha-auditoria-seguranca', content);
  Security.logAudit('AUDIT_LOGS_EXPORTED', 'Exportação da trilha de auditoria para CSV.');
  toast('Logs de auditoria exportados com sucesso.', 'success');
}

function abrirModalUsuario(email = null) {
  if (!Security.can('manage_users')) {
    return toast('Acesso negado: apenas administradores podem gerenciar usuários.', 'error');
  }

  state.editingUserId = email;
  const safeEmail = Security.sanitizeId(email);
  const u = email ? DB.get('usuarios').find(x => x.email === email) : null;

  modal(email ? 'Editar Usuário' : 'Novo Usuário', `
    <form onsubmit="salvarUsuario(event)">
      <div class="form-group">
        <label>Nome Completo *</label>
        <input type="text" id="u-nome" value="${esc(u?.nome || '')}" required maxlength="100">
      </div>
      <div class="form-group">
        <label>E-mail *</label>
        <input type="email" id="u-email" value="${esc(u?.email || '')}" ${email ? 'readonly' : ''} required maxlength="100">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${email ? 'Nova Senha' : 'Senha Inicial *'}</label>
          <input type="password" id="u-senha" placeholder="${email ? 'Deixe em branco para manter' : 'Mínimo 6 caracteres'}" ${email ? '' : 'required'} minlength="6" maxlength="100">
        </div>
        <div class="form-group">
          <label>Perfil de Acesso *</label>
          <select id="u-perfil" required>
            <option value="Operador" ${u?.perfil === 'Operador' ? 'selected' : ''}>Operador</option>
            <option value="Administrador" ${u?.perfil === 'Administrador' ? 'selected' : ''}>Administrador</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Salvar Usuário</button>
      </div>
    </form>
  `);
}

async function salvarUsuario(e) {
  e.preventDefault();
  if (!Security.can('manage_users')) {
    return toast('Acesso negado: permissão insuficiente.', 'error');
  }

  const rawNome = $('u-nome')?.value || '';
  const rawEmail = $('u-email')?.value || '';
  const rawSenha = $('u-senha')?.value || '';
  const rawPerfil = $('u-perfil')?.value || 'Operador';

  if ([rawNome, rawEmail, rawSenha, rawPerfil].some(v => Security.detectSqlInjection(v))) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection em cadastro de usuário.', 'CRITICAL');
    return toast('Caracteres ou termos não permitidos detectados.', 'error');
  }

  const emailOriginal = state.editingUserId;
  const nome = Security.sanitizeText(rawNome, 100);
  const email = Security.sanitizeText(rawEmail, 100).toLowerCase().trim();
  const senha = rawSenha.slice(0, 100);
  const perfil = (rawPerfil === 'Administrador') ? 'Administrador' : 'Operador';

  const us = DB.get('usuarios');

  if (!emailOriginal && us.some(x => x.email.toLowerCase() === email)) {
    return toast('Já existe um usuário cadastrado com esse e-mail.', 'error');
  }

  if (emailOriginal) {
    const idx = us.findIndex(x => x.email === emailOriginal);
    if (idx >= 0) {
      us[idx].nome = nome;
      us[idx].perfil = perfil;
      if (senha && senha.length >= 6) {
        const salt = Security.generateSalt(16);
        const hash = await Security.hashPassword(senha, salt);
        us[idx].salt = salt;
        us[idx].passwordHash = hash;
        delete us[idx].senha;
      }
      Security.logAudit('USUARIO_ATUALIZADO', `Usuário ${email} atualizado. Perfil: ${perfil}`);
    }
  } else {
    if (!senha || senha.length < 6) {
      return toast('A senha inicial deve ter no mínimo 6 caracteres.', 'error');
    }
    const salt = Security.generateSalt(16);
    const hash = await Security.hashPassword(senha, salt);
    const novoUsuario = {
      id: DB.nextId('usuarios'),
      nome,
      email,
      salt,
      passwordHash: hash,
      perfil,
      ativo: true,
      avatar: nome.slice(0, 2).toUpperCase()
    };
    us.push(novoUsuario);
    Security.logAudit('USUARIO_CRIADO', `Novo usuário ${email} cadastrado com perfil ${perfil}.`);
  }

  DB.set('usuarios', us);
  fecharModal();
  renderConfiguracoes();
  toast(emailOriginal ? 'Usuário atualizado com sucesso!' : 'Usuário cadastrado com sucesso!', 'success');
}

function excluirUsuario(email) {
  if (!Security.can('manage_users')) {
    return toast('Acesso negado: apenas administradores podem excluir usuários.', 'error');
  }
  if (email === state.user?.email) {
    return toast('Você não pode excluir seu próprio usuário.', 'error');
  }

  if (confirm(`Tem certeza que deseja excluir o usuário ${email}?`)) {
    const us = DB.get('usuarios').filter(x => x.email !== email);
    DB.set('usuarios', us);
    Security.logAudit('USUARIO_EXCLUIDO', `Usuário ${email} excluído.`);
    renderConfiguracoes();
    toast('Usuário excluído com sucesso.');
  }
}

function abrirModalCategoria() {
  modal('Nova Categoria', `
    <form onsubmit="salvarCategoria(event)">
      <div class="form-group">
        <label>Nome da Categoria *</label>
        <input type="text" id="cat-nome" required maxlength="50">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Salvar</button>
      </div>
    </form>
  `);
}

function salvarCategoria(e) {
  e.preventDefault();
  const rawNome = $('cat-nome')?.value || '';
  if (Security.detectSqlInjection(rawNome)) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection em categoria.', 'CRITICAL');
    return toast('Nome de categoria inválido.', 'error');
  }

  const nome = Security.sanitizeText(rawNome, 50);
  const cats = DB.get('categorias');
  if (cats.includes(nome)) return toast('Essa categoria já existe.', 'error');

  cats.push(nome);
  DB.set('categorias', cats);
  Security.logAudit('CATEGORIA_CRIADA', `Categoria ${nome} criada.`);
  fecharModal();
  renderConfiguracoes();
  toast('Categoria adicionada com sucesso!', 'success');
}

// ===== AUTOMAÇÕES =====
function renderAutomacoes() {
  if (!Security.can('view_automations')) {
    return toast('Acesso negado: apenas administradores podem acessar automações.', 'error');
  }

  let autos = DB.get('automacoes');
  if (!autos || !autos.length) {
    autos = [
      { id: 1, gatilho: 'Estoque Crítico', acao: 'Enviar Alerta por E-mail', destino: 'compras@engepro.com', ativo: true },
      { id: 2, gatilho: 'Relatório Semanal (Segunda-feira 08:00)', acao: 'Exportar e Enviar Posição de Estoque', destino: 'gerencia@engepro.com', ativo: true }
    ];
    DB.set('automacoes', autos);
  }

  const tbody = $('auto-tbody');
  if (tbody) {
    tbody.innerHTML = autos.map(a => `
      <tr>
        <td>
          <label class="switch">
            <input type="checkbox" ${a.ativo ? 'checked' : ''} onchange="toggleAutomacao(${Number(a.id)})">
            <span class="slider"></span>
          </label>
        </td>
        <td><strong>${esc(a.gatilho)}</strong></td>
        <td>${esc(a.acao)}</td>
        <td>${esc(a.destino)}</td>
        <td>
          <button class="btn-icon" title="Excluir automação" onclick="excluirAutomacao(${Number(a.id)})"><i data-lucide="trash-2"></i></button>
        </td>
      </tr>
    `).join('');
  }
  refreshIcons();
}

function abrirModalAutomacao() {
  if (!Security.can('manage_automations')) {
    return toast('Acesso negado: permissão insuficiente.', 'error');
  }

  modal('Nova Automação', `
    <form onsubmit="salvarAutomacao(event)">
      <div class="form-group">
        <label>Gatilho / Horário *</label>
        <input type="text" id="auto-gatilho" placeholder="Ex.: Estoque Crítico ou Diário às 18:00" required maxlength="100">
      </div>
      <div class="form-group">
        <label>Ação *</label>
        <input type="text" id="auto-acao" placeholder="Ex.: Enviar Alerta por E-mail" required maxlength="100">
      </div>
      <div class="form-group">
        <label>E-mail de Destino *</label>
        <input type="email" id="auto-dest" placeholder="gestao@engepro.com" required maxlength="100">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-outline" onclick="fecharModal()">Cancelar</button>
        <button type="submit" class="btn-primary">Criar Automação</button>
      </div>
    </form>
  `);
}

function salvarAutomacao(e) {
  e.preventDefault();
  if (!Security.can('manage_automations')) {
    return toast('Acesso negado.', 'error');
  }

  const rawGat = $('auto-gatilho')?.value || '';
  const rawAcao = $('auto-acao')?.value || '';
  const rawDest = $('auto-dest')?.value || '';

  if ([rawGat, rawAcao, rawDest].some(v => Security.detectSqlInjection(v))) {
    Security.logAudit('SQL_INJECTION_DETECTADA', 'Tentativa de SQL Injection em automação.', 'CRITICAL');
    return toast('Caracteres inválidos detectados.', 'error');
  }

  const auto = {
    id: DB.nextId('automacoes'),
    gatilho: Security.sanitizeText(rawGat, 100),
    acao: Security.sanitizeText(rawAcao, 100),
    destino: Security.sanitizeText(rawDest, 100),
    ativo: true
  };

  const autos = DB.get('automacoes') || [];
  autos.push(auto);
  DB.set('automacoes', autos);
  Security.logAudit('AUTOMACAO_CRIADA', `Automação "${auto.gatilho}" criada.`);
  fecharModal();
  renderAutomacoes();
  toast('Automação cadastrada com sucesso!', 'success');
}

function toggleAutomacao(id) {
  if (!Security.can('manage_automations')) {
    return toast('Acesso negado.', 'error');
  }
  const autos = DB.get('automacoes') || [];
  const a = autos.find(x => x.id === id);
  if (a) {
    a.ativo = !a.ativo;
    DB.set('automacoes', autos);
    Security.logAudit('AUTOMACAO_ALTERADA', `Automação ${id} status alterado para ${a.ativo ? 'ativo' : 'inativo'}.`);
    toast(`Automação ${a.ativo ? 'ativada' : 'desativada'}.`);
  }
}

function excluirAutomacao(id) {
  if (!Security.can('manage_automations')) {
    return toast('Acesso negado.', 'error');
  }
  if (confirm('Deseja realmente remover esta automação?')) {
    const autos = (DB.get('automacoes') || []).filter(x => x.id !== id);
    DB.set('automacoes', autos);
    Security.logAudit('AUTOMACAO_EXCLUIDA', `Automação ${id} excluída.`);
    renderAutomacoes();
    toast('Automação removida.');
  }
}

// ===== BUSCA GLOBAL =====
$('global-search')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const rawQ = e.target.value;
    if (Security.detectSqlInjection(rawQ)) {
      Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection na busca global: ${rawQ}`, 'CRITICAL');
      toast('Termo de busca com caracteres inválidos.', 'error');
      return;
    }
    const q = Security.sanitizeText(rawQ, 100).trim();
    if (!q) return;
    navigate('produtos');
    if ($('prod-search')) {
      $('prod-search').value = q;
      filtrarProdutos();
    }
  }
});

// ===== MODAL & TOAST =====
function modal(title, bodyHtml) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  $('modal-overlay').classList.remove('hidden');
  refreshIcons();
}

function fecharModal() {
  $('modal-overlay').classList.add('hidden');
  $('modal-body').innerHTML = '';
  $('modal-box')?.classList.remove('modal-wide', 'modal-product-detail');
}

function toast(msg, type = 'info') {
  const t = $('toast');
  if (!t) return;
  t.className = `toast ${type}`;
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}
