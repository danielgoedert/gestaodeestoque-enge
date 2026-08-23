// ===== SUPABASECLIENT.JS - Ponte de Conexão e Sincronização Cloud =====

// 1. CONFIGURAÇÃO DAS SUAS CHAVES DO SUPABASE
const SUPABASE_CONFIG = {
  url: 'https://syhrzkhtlhgjkfxqaqpx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5aHJ6a2h0bGhnamtmeHFhcXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MjM5MDcsImV4cCI6MjEwMzA5OTkwN30.ymiRtgzoqcpN_X6gC_lZBlVawjiRCYfpK9U7rLUDr4A'
};

const SupabaseBridge = {
  client: null,
  currentUser: null,
  currentPerfil: null,

  // Verifica se o Supabase foi configurado pelo usuário
  isConfigured() {
    return Boolean(
      SUPABASE_CONFIG.url &&
      SUPABASE_CONFIG.anonKey &&
      !SUPABASE_CONFIG.url.includes('SEU_PROJETO') &&
      typeof window !== 'undefined' &&
      window.supabase &&
      window.supabase.createClient
    );
  },

  // Inicializa a conexão
  init() {
    if (!this.isConfigured()) {
      console.info('ℹ️ Supabase não configurado. Operando em modo de dados local.');
      return null;
    }
    try {
      this.client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
      console.log('✅ Supabase conectado com sucesso!');
      this.setupRealtimeListeners();
      return this.client;
    } catch (err) {
      console.warn('⚠️ Erro ao inicializar o Supabase:', err);
      return null;
    }
  },

  // Escuta alterações em tempo real (Realtime)
  setupRealtimeListeners() {
    if (!this.client) return;
    try {
      this.client
        .channel('public:schema-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, () => {
          if (typeof renderProducts === 'function') renderProducts();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'movimentacoes' }, () => {
          if (typeof renderMovimentacoes === 'function') renderMovimentacoes();
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime listener indisponível:', e);
    }
  },

  // ===== AUTENTICAÇÃO =====
  async login(email, password) {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Busca o perfil e empresa do usuário logado
    const { data: perfil, error: perfilError } = await this.client
      .from('perfis')
      .select('*, empresas(*)')
      .eq('id', data.user.id)
      .single();

    if (perfilError) {
      console.warn('Perfil não encontrado para o usuário:', perfilError);
    }

    this.currentUser = data.user;
    this.currentPerfil = perfil;

    return {
      id: data.user.id,
      email: data.user.email,
      nome: perfil?.nome || data.user.email.split('@')[0],
      perfil: perfil?.perfil || 'Administrador',
      empresaId: perfil?.empresa_id,
      empresaNome: perfil?.empresas?.nome || 'Minha Empresa',
      avatar: perfil?.avatar || 'AD'
    };
  },

  async logout() {
    if (this.client) {
      await this.client.auth.signOut();
    }
    this.currentUser = null;
    this.currentPerfil = null;
  },

  // ===== PRODUTOS =====
  async getProdutos() {
    if (!this.client) return null;
    const { data, error } = await this.client
      .from('produtos')
      .select('*')
      .order('nome', { ascending: true });
    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return null;
    }
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
  },

  async saveProduto(prod) {
    if (!this.client || !this.currentPerfil?.empresa_id) return null;
    const payload = {
      id: prod.id,
      empresa_id: this.currentPerfil.empresa_id,
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
    const { data, error } = await this.client.from('produtos').upsert(payload);
    if (error) throw error;
    return data;
  },

  async deleteProduto(id) {
    if (!this.client) return null;
    const { error } = await this.client.from('produtos').delete().eq('id', id);
    if (error) throw error;
    return true;
  },

  // ===== MOVIMENTAÇÕES =====
  async getMovimentacoes() {
    if (!this.client) return null;
    const { data, error } = await this.client
      .from('movimentacoes')
      .select('*')
      .order('data', { ascending: false });
    if (error) return null;
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
  },

  async addMovimentacao(mov) {
    if (!this.client || !this.currentPerfil?.empresa_id) return null;
    const payload = {
      empresa_id: this.currentPerfil.empresa_id,
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
    const { data, error } = await this.client.from('movimentacoes').insert(payload);
    if (error) throw error;
    return data;
  },

  // ===== FORNECEDORES =====
  async getFornecedores() {
    if (!this.client) return null;
    const { data, error } = await this.client
      .from('fornecedores')
      .select('*')
      .order('nome', { ascending: true });
    if (error) return null;
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
  },

  async saveFornecedor(forn) {
    if (!this.client || !this.currentPerfil?.empresa_id) return null;
    const payload = {
      empresa_id: this.currentPerfil.empresa_id,
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
    const { data, error } = await this.client.from('fornecedores').upsert(payload);
    if (error) throw error;
    return data;
  }
};

// Inicializa a ponte Supabase
if (typeof window !== 'undefined') {
  window.SupabaseBridge = SupabaseBridge;
  document.addEventListener('DOMContentLoaded', () => {
    SupabaseBridge.init();
  });
}
