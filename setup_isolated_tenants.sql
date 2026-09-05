-- ==============================================================================
-- SCRIPT: ISOLAMENTO TOTAL DE BASE DE DADOS POR CONTA (MULTI-TENANT INDEPENDENTE)
-- Execute este script no SQL Editor do Supabase para criar um banco isolado para cada usuário
-- ==============================================================================

-- 1. Gatilho automático para criar uma base isolada para qualquer usuário futuro
CREATE OR REPLACE FUNCTION public.handle_new_user_isolated()
RETURNS trigger AS $$
DECLARE
  v_empresa_id UUID;
  v_nome TEXT;
BEGIN
  v_empresa_id := gen_random_uuid();
  v_nome := INITCAP(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '));

  INSERT INTO public.empresas (id, nome)
  VALUES (v_empresa_id, v_nome || ' - Gestão de Estoque');

  INSERT INTO public.perfis (id, empresa_id, nome, email, perfil, avatar)
  VALUES (
    NEW.id,
    v_empresa_id,
    v_nome,
    NEW.email,
    'Operador',
    UPPER(SUBSTRING(SPLIT_PART(NEW.email, '.', 1), 1, 1) || COALESCE(SUBSTRING(SPLIT_PART(SPLIT_PART(NEW.email, '@', 1), '.', 2), 1, 1), ''))
  )
  ON CONFLICT (id) DO UPDATE
  SET empresa_id = EXCLUDED.empresa_id,
      nome = EXCLUDED.nome,
      email = EXCLUDED.email,
      perfil = 'Operador';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_isolated();

-- 2. Configura a base isolada individual para todos os 9 usuários atuais
DO $$
DECLARE
  u RECORD;
  v_empresa_id UUID;
  v_nome TEXT;
BEGIN
  FOR u IN SELECT id, email FROM auth.users LOOP
    v_nome := INITCAP(REPLACE(SPLIT_PART(u.email, '@', 1), '.', ' '));
    
    IF u.email = 'daniel.fernandes@engeproconsultoria.com.br' THEN
      v_empresa_id := '11111111-1111-1111-1111-111111111111';
      INSERT INTO public.empresas (id, nome) 
      VALUES (v_empresa_id, 'Daniel Fernandes - Estoque EngePro')
      ON CONFLICT (id) DO NOTHING;
    ELSE
      v_empresa_id := gen_random_uuid();
      INSERT INTO public.empresas (id, nome) 
      VALUES (v_empresa_id, v_nome || ' - Gestão de Estoque')
      ON CONFLICT (id) DO NOTHING;
    END IF;

    INSERT INTO public.perfis (id, empresa_id, nome, email, perfil, avatar)
    VALUES (
      u.id,
      v_empresa_id,
      v_nome,
      u.email,
      CASE WHEN u.email = 'daniel.fernandes@engeproconsultoria.com.br' THEN 'Administrador' ELSE 'Operador' END,
      UPPER(SUBSTRING(SPLIT_PART(u.email, '.', 1), 1, 1) || COALESCE(SUBSTRING(SPLIT_PART(SPLIT_PART(u.email, '@', 1), '.', 2), 1, 1), ''))
    )
    ON CONFLICT (id) DO UPDATE 
    SET empresa_id = EXCLUDED.empresa_id,
        nome = EXCLUDED.nome,
        email = EXCLUDED.email,
        perfil = CASE WHEN u.email = 'daniel.fernandes@engeproconsultoria.com.br' THEN 'Administrador' ELSE 'Operador' END;
  END LOOP;
END $$;
