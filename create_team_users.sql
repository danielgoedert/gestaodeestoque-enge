-- ==============================================================================
-- SCRIPT SQL: CRIAÇÃO E VINCULAÇÃO DOS 8 MEMBROS DA EQUIPE ENGEPRO
-- Execute este script no SQL Editor do seu painel Supabase
-- ==============================================================================

-- Garante que a extensão de criptografia pgcrypto está ativa
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Garante que a Empresa EngePro existe
INSERT INTO public.empresas (id, nome) 
VALUES ('11111111-1111-1111-1111-111111111111', 'EngePro Gestão de Estoque')
ON CONFLICT (id) DO NOTHING;

-- 2. Função auxiliar temporária para criar usuário no Supabase Auth com senha criptografada e e-mail confirmado
DO $$
DECLARE
  v_empresa_id UUID := '11111111-1111-1111-1111-111111111111';
  
  -- Lista de Usuários: (Email, Senha, Nome, Perfil)
  users_data RECORD;
  v_user_id UUID;
BEGIN

  FOR users_data IN 
    SELECT * FROM (VALUES
      ('lucas.novakoski@engeproconsultoria.com.br', 'lucas123', 'Lucas Novakoski', 'Operador'),
      ('cecilia.monteiro@engeproconsultoria.com.br', 'cecilia123', 'Cecília Monteiro', 'Operador'),
      ('bruno.chagas@engeproconsultoria.com.br', 'bruno123', 'Bruno Chagas', 'Operador'),
      ('sofia.morgenstern@engeproconsultoria.com.br', 'sofia123', 'Sofia Morgenstern', 'Operador'),
      ('amanda.utiyama@engeproconsultoria.com.br', 'amanda123', 'Amanda Utiyama', 'Operador'),
      ('thales.dalpino@engeproconsultoria.com.br', 'thales123', 'Thales Dalpino', 'Operador'),
      ('matheus.goncalves@engeproconsultoria.com.br', 'matheus123', 'Matheus Gonçalves', 'Operador'),
      ('julia.leite@engeproconsultoria.com.br', 'julia123', 'Júlia Leite', 'Operador')
    ) AS t(email, pass, nome, perfil)
  LOOP

    -- Verifica se o usuário já existe no auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE email = users_data.email;

    IF v_user_id IS NULL THEN
      -- Gera novo ID e cria no auth.users com e-mail já confirmado
      v_user_id := gen_random_uuid();
      
      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        users_data.email,
        crypt(users_data.pass, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        json_build_object('name', users_data.nome),
        now(),
        now()
      );
    ELSE
      -- Atualiza senha e confirmação se já existia
      UPDATE auth.users
      SET encrypted_password = crypt(users_data.pass, gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          raw_user_meta_data = json_build_object('name', users_data.nome),
          updated_at = now()
      WHERE id = v_user_id;
    END IF;

    -- Vincula ou atualiza na tabela pública de perfis da empresa
    INSERT INTO public.perfis (id, empresa_id, nome, email, perfil, avatar)
    VALUES (
      v_user_id,
      v_empresa_id,
      users_data.nome,
      users_data.email,
      users_data.perfil,
      UPPER(SUBSTRING(SPLIT_PART(users_data.nome, ' ', 1), 1, 1) || COALESCE(SUBSTRING(SPLIT_PART(users_data.nome, ' ', 2), 1, 1), ''))
    )
    ON CONFLICT (id) DO UPDATE 
    SET empresa_id = EXCLUDED.empresa_id,
        nome = EXCLUDED.nome,
        email = EXCLUDED.email,
        perfil = EXCLUDED.perfil,
        avatar = EXCLUDED.avatar;

  END LOOP;

END $$;
