-- ==============================================================================
-- SISTEMA DE GESTÃO DE ESTOQUE - SCHEMA MULTI-TENANT PARA SUPABASE
-- ==============================================================================
-- Este script cria todas as tabelas, índices e regras de segurança (RLS).
-- Como usar: Abra o Supabase > SQL Editor > Cole este script > Clique em "Run".
-- ==============================================================================

-- 1. Habilitar extensão de UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. TABELAS PRINCIPAIS
-- ==============================================================================

-- Tabela de Empresas (Cada cliente pagante é uma empresa)
CREATE TABLE IF NOT EXISTS public.empresas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(150) NOT NULL,
    cnpj VARCHAR(20),
    telefone VARCHAR(30),
    email_contato VARCHAR(100),
    status VARCHAR(30) DEFAULT 'ativo', -- 'ativo', 'suspenso', 'cancelado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Perfis de Usuários (Vinculada à autenticação do Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.perfis (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    perfil VARCHAR(30) NOT NULL DEFAULT 'Operador', -- 'Administrador' ou 'Operador'
    avatar VARCHAR(10) DEFAULT 'US',
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Categorias de Produtos
CREATE TABLE IF NOT EXISTS public.categorias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nome VARCHAR(60) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(empresa_id, nome)
);

-- Tabela de Fornecedores
CREATE TABLE IF NOT EXISTS public.fornecedores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    cnpj VARCHAR(20),
    contato VARCHAR(100),
    email VARCHAR(100),
    telefone VARCHAR(30),
    total_comprado NUMERIC(12,2) DEFAULT 0,
    avaliacao NUMERIC(3,1) DEFAULT 5.0,
    entregas_prazo NUMERIC(5,2) DEFAULT 100.0,
    qualidade NUMERIC(5,2) DEFAULT 100.0,
    situacao VARCHAR(30) DEFAULT 'Aprovado', -- 'Aprovado', 'Em avaliação', 'Bloqueado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Produtos do Estoque
CREATE TABLE IF NOT EXISTS public.produtos (
    id VARCHAR(60) NOT NULL, -- Código SKU/ID do produto (ex: PROD-001)
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    descricao TEXT DEFAULT '',
    categoria VARCHAR(60) DEFAULT 'Outros',
    unidade VARCHAR(10) DEFAULT 'un',
    estoque_atual NUMERIC(12,2) DEFAULT 0,
    estoque_min NUMERIC(12,2) DEFAULT 0,
    estoque_max NUMERIC(12,2) DEFAULT 0,
    custo NUMERIC(12,2) DEFAULT 0,
    fornecedor VARCHAR(150) DEFAULT '',
    localizacao VARCHAR(100) DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (empresa_id, id)
);

-- Tabela de Movimentações de Estoque (Entradas, Saídas, Balcão, NF-e)
CREATE TABLE IF NOT EXISTS public.movimentacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    produto_id VARCHAR(60) NOT NULL,
    produto_nome VARCHAR(150) NOT NULL,
    tipo VARCHAR(20) NOT NULL, -- 'Entrada', 'Saída', 'Ajuste'
    quantidade NUMERIC(12,2) NOT NULL,
    saldo_apos NUMERIC(12,2) NOT NULL,
    local VARCHAR(100) DEFAULT 'Almoxarifado',
    responsavel VARCHAR(100) NOT NULL,
    descricao TEXT DEFAULT '',
    data TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Pedidos de Compras
CREATE TABLE IF NOT EXISTS public.pedidos_compra (
    id VARCHAR(60) NOT NULL,
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    data TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fornecedor VARCHAR(150) NOT NULL,
    itens JSONB NOT NULL DEFAULT '[]'::jsonb,
    total NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(30) DEFAULT 'Pendente', -- 'Pendente', 'Aprovado', 'Entregue', 'Cancelado'
    previsao_entrega VARCHAR(30),
    responsavel VARCHAR(100),
    PRIMARY KEY (empresa_id, id)
);

-- Tabela de Trilha de Auditoria e Segurança
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    user_name VARCHAR(100),
    user_email VARCHAR(100),
    user_perfil VARCHAR(30),
    action VARCHAR(80) NOT NULL,
    details TEXT,
    status VARCHAR(20) DEFAULT 'SUCCESS',
    ip VARCHAR(50),
    device VARCHAR(100),
    user_agent VARCHAR(150),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================================================
-- 3. FUNÇÃO AUXILIAR: IDENTIFICAR A EMPRESA DO USUÁRIO LOGADO
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_auth_empresa_id() 
RETURNS UUID AS $$
  SELECT empresa_id FROM public.perfis WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) - SEGURANÇA E ISOLAMENTO MULTI-TENANT
-- Garante que o Cliente A NUNCA veja nem altere os dados do Cliente B.
-- ==============================================================================

-- Habilita RLS em todas as tabelas
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Políticas para 'empresas'
CREATE POLICY "Acesso à própria empresa" ON public.empresas
    FOR SELECT USING (id = public.get_auth_empresa_id());

-- Políticas para 'perfis'
CREATE POLICY "Acesso a perfis da mesma empresa" ON public.perfis
    FOR ALL USING (empresa_id = public.get_auth_empresa_id());

-- Políticas para 'categorias'
CREATE POLICY "Isolamento de categorias" ON public.categorias
    FOR ALL USING (empresa_id = public.get_auth_empresa_id())
    WITH CHECK (empresa_id = public.get_auth_empresa_id());

-- Políticas para 'fornecedores'
CREATE POLICY "Isolamento de fornecedores" ON public.fornecedores
    FOR ALL USING (empresa_id = public.get_auth_empresa_id())
    WITH CHECK (empresa_id = public.get_auth_empresa_id());

-- Políticas para 'produtos'
CREATE POLICY "Isolamento de produtos" ON public.produtos
    FOR ALL USING (empresa_id = public.get_auth_empresa_id())
    WITH CHECK (empresa_id = public.get_auth_empresa_id());

-- Políticas para 'movimentacoes'
CREATE POLICY "Isolamento de movimentacoes" ON public.movimentacoes
    FOR ALL USING (empresa_id = public.get_auth_empresa_id())
    WITH CHECK (empresa_id = public.get_auth_empresa_id());

-- Políticas para 'pedidos_compra'
CREATE POLICY "Isolamento de pedidos_compra" ON public.pedidos_compra
    FOR ALL USING (empresa_id = public.get_auth_empresa_id())
    WITH CHECK (empresa_id = public.get_auth_empresa_id());

-- Políticas para 'audit_logs'
CREATE POLICY "Isolamento de logs de auditoria" ON public.audit_logs
    FOR ALL USING (empresa_id = public.get_auth_empresa_id())
    WITH CHECK (empresa_id = public.get_auth_empresa_id());

-- ==============================================================================
-- 5. REALTIME (Sincronização em tempo real entre operadores e dispositivos)
-- ==============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.produtos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.movimentacoes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fornecedores;
