# Supabase Setup (Produção)

## 1) Criar projeto no Supabase
- Crie um projeto em [Supabase](https://supabase.com/).
- Vá em **Project Settings > API** e copie:
  - `Project URL`
  - `anon public key`

## 2) Criar tabelas e policies
- Abra **SQL Editor** no Supabase.
- Execute o arquivo `supabase_schema.sql`.

## 3) Promover o primeiro administrador
1. No app, faça cadastro normal com seu e-mail.
2. No Supabase SQL Editor, rode:

```sql
update public.profiles
set role = 'admin', status = 'active'
where email = 'seu-email@dominio.com';
```

## 4) Configurar chaves no frontend
Adicione no `index.html` antes de `app.js`:

```html
<script>
  window.SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
  window.SUPABASE_ANON_KEY = "SUA_ANON_KEY";
</script>
```

## 5) Fluxo operacional
- Novo usuário cadastra conta -> entra como `pending`.
- Admin acessa **Painel Administrativo**:
  - libera (`active`) ou bloqueia (`blocked`);
  - promove/rebaixa perfil (`user/admin`);
  - envia reset de senha por e-mail.

## Segurança importante
- Nunca use `service_role` key no frontend.
- Com esse modelo, toda autorização crítica acontece via RLS no banco.
