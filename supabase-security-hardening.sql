-- Execute uma única vez no SQL Editor do Supabase antes da publicação.
-- Esta migração substitui as políticas permissivas por autorização no banco.

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis
    WHERE id = auth.uid() AND ativo = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis
    WHERE id = auth.uid() AND ativo = TRUE AND perfil = 'Administrador'
  );
$$;

DROP POLICY IF EXISTS "Acesso à própria empresa" ON public.empresas;
DROP POLICY IF EXISTS "Acesso a perfis da mesma empresa" ON public.perfis;
DROP POLICY IF EXISTS "Isolamento de categorias" ON public.categorias;
DROP POLICY IF EXISTS "Isolamento de fornecedores" ON public.fornecedores;
DROP POLICY IF EXISTS "Isolamento de produtos" ON public.produtos;
DROP POLICY IF EXISTS "Isolamento de movimentacoes" ON public.movimentacoes;
DROP POLICY IF EXISTS "Isolamento de pedidos_compra" ON public.pedidos_compra;
DROP POLICY IF EXISTS "Isolamento de logs de auditoria" ON public.audit_logs;

CREATE POLICY "empresa_propria_leitura" ON public.empresas
  FOR SELECT TO authenticated
  USING (id = public.get_auth_empresa_id());

CREATE POLICY "perfil_proprio_leitura" ON public.perfis
  FOR SELECT TO authenticated
  USING (id = auth.uid() AND ativo = TRUE);

CREATE POLICY "categorias_leitura_empresa" ON public.categorias
  FOR SELECT TO authenticated USING (empresa_id = public.get_auth_empresa_id());
CREATE POLICY "categorias_admin" ON public.categorias
  FOR ALL TO authenticated
  USING (empresa_id = public.get_auth_empresa_id() AND public.is_admin())
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_admin());

CREATE POLICY "fornecedores_leitura_empresa" ON public.fornecedores
  FOR SELECT TO authenticated USING (empresa_id = public.get_auth_empresa_id());
CREATE POLICY "fornecedores_admin" ON public.fornecedores
  FOR ALL TO authenticated
  USING (empresa_id = public.get_auth_empresa_id() AND public.is_admin())
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_admin());

CREATE POLICY "produtos_leitura_empresa" ON public.produtos
  FOR SELECT TO authenticated USING (empresa_id = public.get_auth_empresa_id());
CREATE POLICY "produtos_criar" ON public.produtos
  FOR INSERT TO authenticated
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_active_user());
CREATE POLICY "produtos_atualizar" ON public.produtos
  FOR UPDATE TO authenticated
  USING (empresa_id = public.get_auth_empresa_id() AND public.is_active_user())
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_active_user());
CREATE POLICY "produtos_excluir_admin" ON public.produtos
  FOR DELETE TO authenticated
  USING (empresa_id = public.get_auth_empresa_id() AND public.is_admin());

CREATE POLICY "movimentacoes_leitura_empresa" ON public.movimentacoes
  FOR SELECT TO authenticated USING (empresa_id = public.get_auth_empresa_id());
CREATE POLICY "movimentacoes_criar" ON public.movimentacoes
  FOR INSERT TO authenticated
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_active_user());

CREATE POLICY "pedidos_leitura_empresa" ON public.pedidos_compra
  FOR SELECT TO authenticated USING (empresa_id = public.get_auth_empresa_id());
CREATE POLICY "pedidos_criar" ON public.pedidos_compra
  FOR INSERT TO authenticated
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_active_user());
CREATE POLICY "pedidos_atualizar" ON public.pedidos_compra
  FOR UPDATE TO authenticated
  USING (empresa_id = public.get_auth_empresa_id() AND public.is_active_user())
  WITH CHECK (empresa_id = public.get_auth_empresa_id() AND public.is_active_user());

CREATE POLICY "auditoria_admin_leitura" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (empresa_id = public.get_auth_empresa_id() AND public.is_admin());

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
