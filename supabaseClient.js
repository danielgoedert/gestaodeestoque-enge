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
    const savedToken = localStorage.getItem('ep_sb_token') || sessionStorage.getItem('ep_sb_token');
    if (savedToken) this.token = savedToken;
    const savedPerfil = localStorage.getItem('ep_sb_perfil') || sessionStorage.getItem('ep_sb_perfil');
    if (savedPerfil) {
      try { this.currentPerfil = JSON.parse(savedPerfil); } catch {}
    }
    console.log('✅ Supabase Bridge nativo inicializado!');
    return this;
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
    localStorage.setItem('ep_sb_token', data.access_token);
    sessionStorage.setItem('ep_sb_token', data.access_token);
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

    this.currentPerfil = perfil;
    if (perfil) {
      localStorage.setItem('ep_sb_perfil', JSON.stringify(perfil));
      sessionStorage.setItem('ep_sb_perfil', JSON.stringify(perfil));
    }

    const resolvedEmpresaId = perfil?.empresa_id || '11111111-1111-1111-1111-111111111111';
    const resolvedEmpresaNome = perfil?.empresas?.nome || (perfil?.nome ? `${perfil.nome} - Estoque` : 'EngePro Gestão de Estoque');

    return {
      id: data.user.id,
      email: data.user.email,
      nome: perfil?.nome || data.user.email.split('@')[0],
      perfil: perfil?.perfil || 'Administrador',
      empresaId: resolvedEmpresaId,
      empresaNome: resolvedEmpresaNome,
      avatar: perfil?.avatar || 'AD'
    };
  },

  async logout() {
    this.token = null;
    this.currentUser = null;
    this.currentPerfil = null;
    localStorage.removeItem('ep_sb_token');
    sessionStorage.removeItem('ep_sb_token');
    localStorage.removeItem('ep_sb_perfil');
    sessionStorage.removeItem('ep_sb_perfil');
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
