// ===== SUPABASECLIENT.JS - Ponte Direta e Conexão Nativa com Supabase Cloud =====

const SUPABASE_CONFIG = {
  url: 'https://syhrzkhtlhgjkfxqaqpx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5aHJ6a2h0bGhnamtmeHFhcXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MjM5MDcsImV4cCI6MjEwMzA5OTkwN30.ymiRtgzoqcpN_X6gC_lZBlVawjiRCYfpK9U7rLUDr4A'
};

const SupabaseBridge = {
  token: null,
  currentUser: null,
  currentPerfil: null,

  isConfigured() {
    return Boolean(
      SUPABASE_CONFIG.url &&
      SUPABASE_CONFIG.anonKey &&
      !SUPABASE_CONFIG.url.includes('SEU_PROJETO')
    );
  },

  getHeaders(useAuth = true) {
    const headers = {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json'
    };
    const t = this.token || localStorage.getItem('ep_sb_token') || sessionStorage.getItem('ep_sb_token');
    if (useAuth && t) {
      headers['Authorization'] = `Bearer ${t}`;
    }
    return headers;
  },

  init() {
    // A sessão só é restaurada após restoreSession() validá-la no Supabase.
    console.log('Supabase Bridge inicializado.');
    return this;
  },

  clearStoredSession() {
    this.token = null;
    this.currentUser = null;
    this.currentPerfil = null;
    ['ep_sb_token', 'ep_sb_perfil', 'ep_user'].forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  },

  persistSession(remember = false) {
    const primary = remember ? localStorage : sessionStorage;
    const secondary = remember ? sessionStorage : localStorage;
    secondary.removeItem('ep_sb_token');
    secondary.removeItem('ep_sb_perfil');
    if (this.token) primary.setItem('ep_sb_token', this.token);
    if (this.currentPerfil) primary.setItem('ep_sb_perfil', JSON.stringify(this.currentPerfil));
  },

  async restoreSession() {
    if (!this.isConfigured()) return null;
    const token = localStorage.getItem('ep_sb_token') || sessionStorage.getItem('ep_sb_token');
    if (!token) return null;

    try {
      const userRes = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/user`, {
        headers: { apikey: SUPABASE_CONFIG.anonKey, Authorization: `Bearer ${token}` }
      });
      if (!userRes.ok) throw new Error('Sessão inválida ou expirada.');
      const user = await userRes.json();
      this.token = token;
      this.currentUser = user;
      const profileRes = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/perfis?select=*,empresas(*)&id=eq.${encodeURIComponent(user.id)}`, {
        headers: this.getHeaders(true)
      });
      if (!profileRes.ok) throw new Error('Perfil não encontrado.');
      const profile = (await profileRes.json())[0];
      if (!profile || profile.ativo === false || !['Administrador', 'Operador'].includes(profile.perfil)) {
        throw new Error('Perfil sem autorização.');
      }
      this.currentPerfil = profile;
      return this.buildAppSession(user, profile);
    } catch {
      this.clearStoredSession();
      return null;
    }
  },

  buildAppSession(user, perfil) {
    return {
      id: user.id,
      email: user.email,
      nome: perfil.nome || user.email.split('@')[0],
      perfil: perfil.perfil,
      empresaId: perfil.empresa_id,
      empresaNome: perfil.empresas?.nome || 'Gestão de Estoque',
      avatar: perfil.avatar || 'US'
    };
  },

  getEmpresaId() {
    if (this.currentPerfil?.empresa_id) return this.currentPerfil.empresa_id;
    if (typeof state !== 'undefined' && state.user?.empresaId) return state.user.empresaId;
    try {
      const u = JSON.parse(localStorage.getItem('ep_user') || sessionStorage.getItem('ep_user') || '{}');
      if (u.empresaId) return u.empresaId;
    } catch {}
    return '11111111-1111-1111-1111-111111111111';
  },

  // ===== AUTENTICAÇÃO DIRETA =====
  async login(email, password) {
    if (!this.isConfigured()) throw new Error('Supabase não configurado.');

    const endpoint = `${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      const errorMsg = data.error_description || data.msg || data.message || 'Falha ao autenticar no Supabase.';
      throw new Error(errorMsg);
    }

    this.token = data.access_token;
    this.currentUser = data.user;

    // Busca o perfil da empresa
    let perfil = null;
    try {
      const pRes = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/perfis?select=*,empresas(*)&id=eq.${data.user.id}`, {
        headers: this.getHeaders(true)
      });
      if (pRes.ok) {
        const pList = await pRes.json();
        if (pList && pList.length > 0) perfil = pList[0];
      }
    } catch (err) {
      console.warn('Perfil query warning:', err);
    }

    if (!perfil || perfil.ativo === false || !['Administrador', 'Operador'].includes(perfil.perfil)) {
      this.clearStoredSession();
      throw new Error('Seu usuário não possui um perfil ativo autorizado.');
    }
    this.currentPerfil = perfil;
    return this.buildAppSession(data.user, perfil);
  },

  async logout() {
    this.clearStoredSession();
  },

  async requestPasswordReset(email) {
    const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: SUPABASE_CONFIG.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirect_to: `${window.location.origin}/` })
    });
    if (!res.ok) throw new Error('Não foi possível iniciar a recuperação de senha.');
    return true;
  },

  getRecoveryToken() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return params.get('type') === 'recovery' ? params.get('access_token') : null;
  },

  async updatePasswordFromRecovery(newPassword) {
    const token = this.getRecoveryToken();
    if (!token) throw new Error('Link de recuperação inválido ou expirado.');
    const res = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: SUPABASE_CONFIG.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: newPassword })
    });
    if (!res.ok) throw new Error('Não foi possível atualizar a senha. Solicite um novo link.');
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    return true;
  },

  // ===== PRODUTOS =====
  async getProdutos() {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/produtos?select=*&order=nome.asc`, {
        headers: this.getHeaders(true)
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.map(p => ({
        id: p.id,
        nome: p.nome,
        desc: p.descricao,
        categoria: p.categoria,
        unidade: p.unidade,
        estoqueAtual: Number(p.estoque_atual),
        estoqueMin: Number(p.estoque_min),
        estoqueMax: Number(p.estoque_max),
        custo: Number(p.custo),
        fornecedor: p.fornecedor,
        local: p.localizacao
      }));
    } catch (e) {
      console.warn('Erro ao buscar produtos do Supabase:', e);
      return null;
    }
  },

  async saveProduto(prod) {
    if (!this.isConfigured()) return null;
    const empresaId = this.getEmpresaId();
    const payload = {
      id: prod.id,
      empresa_id: empresaId,
      nome: prod.nome,
      descricao: prod.desc || '',
      categoria: prod.categoria || 'Outros',
      unidade: prod.unidade || 'un',
      estoque_atual: prod.estoqueAtual || 0,
      estoque_min: prod.estoqueMin || 0,
      estoque_max: prod.estoqueMax || 0,
      custo: prod.custo || 0,
      fornecedor: prod.fornecedor || '',
      localizacao: prod.local || '',
      updated_at: new Date().toISOString()
    };
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/produtos`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(true),
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (e) {
      console.warn('Erro ao salvar produto no Supabase:', e);
      return false;
    }
  },

  async saveProdutosBatch(prods) {
    if (!this.isConfigured() || !Array.isArray(prods) || !prods.length) return false;
    const empresaId = this.getEmpresaId();
    const payload = prods.map(prod => ({
      id: prod.id,
      empresa_id: empresaId,
      nome: prod.nome,
      descricao: prod.desc || '',
      categoria: prod.categoria || 'Outros',
      unidade: prod.unidade || 'un',
      estoque_atual: prod.estoqueAtual || 0,
      estoque_min: prod.estoqueMin || 0,
      estoque_max: prod.estoqueMax || 0,
      custo: prod.custo || 0,
      fornecedor: prod.fornecedor || '',
      localizacao: prod.local || '',
      updated_at: new Date().toISOString()
    }));
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/produtos`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(true),
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (e) {
      console.warn('Erro ao salvar lote de produtos no Supabase:', e);
      return false;
    }
  },

  async deleteProduto(id) {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/produtos?id=eq.${id}`, {
        method: 'DELETE',
        headers: this.getHeaders(true)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  // ===== MOVIMENTAÇÕES =====
  async getMovimentacoes() {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/movimentacoes?select=*&order=data.desc`, {
        headers: this.getHeaders(true)
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.map(m => ({
        id: m.id,
        data: m.data,
        tipo: m.tipo,
        produtoId: m.produto_id,
        produto: m.produto_nome,
        quantidade: Number(m.quantidade),
        saldoApos: Number(m.saldo_apos),
        local: m.local,
        responsavel: m.responsavel,
        descricao: m.descricao
      }));
    } catch (e) {
      return null;
    }
  },

  async addMovimentacao(mov) {
    if (!this.isConfigured()) return null;
    const empresaId = this.getEmpresaId();
    const payload = {
      empresa_id: empresaId,
      produto_id: mov.produtoId || mov.produto,
      produto_nome: mov.produto,
      tipo: mov.tipo,
      quantidade: mov.quantidade,
      saldo_apos: mov.saldoApos,
      local: mov.local || 'Almoxarifado',
      responsavel: mov.responsavel,
      descricao: mov.descricao || '',
      data: mov.data || new Date().toISOString()
    };
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/movimentacoes`, {
        method: 'POST',
        headers: this.getHeaders(true),
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  // ===== FORNECEDORES =====
  async getFornecedores() {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/fornecedores?select=*&order=nome.asc`, {
        headers: this.getHeaders(true)
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.map(f => ({
        id: f.id,
        nome: f.nome,
        cnpj: f.cnpj,
        contato: f.contato,
        email: f.email,
        telefone: f.telefone,
        totalComprado: Number(f.total_comprado || 0),
        avaliacao: Number(f.avaliacao || 5),
        entregasPrazo: Number(f.entregas_prazo || 100),
        qualidade: Number(f.qualidade || 100),
        situacao: f.situacao || 'Aprovado'
      }));
    } catch (e) {
      return null;
    }
  },

  async saveFornecedor(forn) {
    if (!this.isConfigured()) return null;
    const empresaId = this.getEmpresaId();
    const payload = {
      empresa_id: empresaId,
      nome: forn.nome,
      cnpj: forn.cnpj || '',
      contato: forn.contato || '',
      email: forn.email || '',
      telefone: forn.telefone || '',
      avaliacao: forn.avaliacao || 5,
      entregas_prazo: forn.entregasPrazo || 100,
      qualidade: forn.qualidade || 100,
      situacao: forn.situacao || 'Aprovado'
    };
    if (forn.id && forn.id.length > 20) payload.id = forn.id;
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/fornecedores`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(true),
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
};

// Inicializa a ponte Supabase
if (typeof window !== 'undefined') {
  window.SupabaseBridge = SupabaseBridge;
  document.addEventListener('DOMContentLoaded', () => {
    SupabaseBridge.init();
  });
}
