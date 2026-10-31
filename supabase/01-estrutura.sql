-- =====================================================================
-- Sucesso de um Dia · banco de dados (Supabase)
--
-- Como usar: no Supabase, abra SQL Editor > New query, cole este arquivo
-- inteiro e clique em Run. Pode rodar de novo sem perder dados.
--
-- Antes de rodar, troque o código do time na linha marcada com  <<<
-- (é o código que cada pessoa digita no primeiro acesso).
--
-- Segurança: as tabelas ficam fechadas (RLS ligado e sem políticas).
-- O app só conversa com o banco pelas funções do fim deste arquivo,
-- e cada função confere a sessão de quem está chamando.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table if not exists public.config (
  id          int primary key default 1 check (id = 1),
  inicio      date not null,
  dias        int  not null check (dias between 1 and 366),
  codigo_time text not null
);

insert into public.config (id, inicio, dias, codigo_time)
values (1, '2026-10-06', 74, 'autentica74')   -- <<< troque o código do time aqui
on conflict (id) do nothing;

create table if not exists public.pessoas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (char_length(nome) between 2 and 60),
  slug          text not null unique,
  pin_hash      text not null,
  admin         boolean not null default false,
  placar        boolean not null default true,
  falhas        int not null default 0,
  bloqueado_ate timestamptz,
  criado_em     timestamptz not null default now()
);

create table if not exists public.sessoes (
  token_hash text primary key,
  pessoa_id  uuid not null references public.pessoas(id) on delete cascade,
  expira_em  timestamptz not null default now() + interval '120 days',
  criado_em  timestamptz not null default now()
);

create table if not exists public.dias (
  pessoa_id     uuid not null references public.pessoas(id) on delete cascade,
  dia           date not null,
  itens         text[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  primary key (pessoa_id, dia)
);

create table if not exists public.espelho (
  id        uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  dia       date not null,
  txt       text not null check (char_length(txt) between 1 and 280),
  min       int  not null check (min between 1 and 1440),
  criado_em timestamptz not null default now()
);
create index if not exists espelho_pessoa_idx on public.espelho (pessoa_id);

-- Progresso antigo esperando o cadastro da pessoa (ver 02-importar-*.sql)
create table if not exists public.importacao (
  slug  text primary key,
  admin boolean not null default false,
  dias  jsonb not null default '{}'::jsonb
);

alter table public.config     enable row level security;
alter table public.pessoas    enable row level security;
alter table public.sessoes    enable row level security;
alter table public.dias       enable row level security;
alter table public.espelho    enable row level security;
alter table public.importacao enable row level security;

revoke all on public.config, public.pessoas, public.sessoes, public.dias, public.espelho, public.importacao
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções internas (não ficam abertas para o app)
-- ---------------------------------------------------------------------

-- "Ana Letícia  Stori" -> "ana-leticia-stori"
create or replace function public._slug(p text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(p, ''),
      'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝáàâãäåéèêëíìîïóòôõöúùûüçñý',
      'AAAAAAEEEEIIIIOOOOOUUUUCNYaaaaaaeeeeiiiiooooouuuucny')),
    '[^a-z0-9]+', '-', 'g'))
$$;

-- Só os cinco itens do desafio, sem repetição
create or replace function public._itens(p text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x order by x), '{}')
  from (select distinct x from unnest(coalesce(p, '{}'::text[])) as x
        where x in ('dieta', 'treino', 'estudo', 'trabalho', 'oracao')) t
$$;

create or replace function public._sessao(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.pessoa_id from public.sessoes s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expira_em > now()
$$;

create or replace function public._nova_sessao(p_pessoa uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.sessoes where expira_em < now();
  insert into public.sessoes (token_hash, pessoa_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_pessoa);
  return v_token;
end $$;

create or replace function public._eh_admin(p_pessoa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select admin from public.pessoas where id = p_pessoa), false)
$$;

create or replace function public._dados(p_pessoa uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'ok', true,
    'pessoa', json_build_object('id', p.id, 'nome', p.nome, 'admin', p.admin, 'placar', p.placar),
    'config', (select json_build_object('inicio', c.inicio, 'dias', c.dias,
                                        'codigo', case when p.admin then c.codigo_time end)
               from public.config c where c.id = 1),
    'dias', coalesce((select json_object_agg(d.dia::text, d.itens)
                      from public.dias d where d.pessoa_id = p.id), '{}'::json),
    'espelho', coalesce((select json_agg(json_build_object(
                           'id', e.id, 'dia', e.dia, 'txt', e.txt, 'min', e.min,
                           't', (extract(epoch from e.criado_em) * 1000)::bigint)
                         order by e.criado_em desc)
                         from public.espelho e where e.pessoa_id = p.id), '[]'::json)
  )
  from public.pessoas p where p.id = p_pessoa
$$;

-- ---------------------------------------------------------------------
-- Entrar, cadastrar e sair
-- ---------------------------------------------------------------------

create or replace function public.cadastrar(p_nome text, p_pin text, p_codigo text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_slug text := public._slug(p_nome);
  v_id   uuid;
  imp    public.importacao%rowtype;
begin
  if char_length(v_nome) < 2 or char_length(v_nome) > 60 or v_slug = '' then
    return json_build_object('ok', false, 'erro', 'nome_invalido');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return json_build_object('ok', false, 'erro', 'pin_invalido');
  end if;
  if not exists (select 1 from public.config c
                 where c.id = 1 and lower(trim(c.codigo_time)) = lower(trim(coalesce(p_codigo, '')))) then
    return json_build_object('ok', false, 'erro', 'codigo_invalido');
  end if;
  if exists (select 1 from public.pessoas where slug = v_slug) then
    return json_build_object('ok', false, 'erro', 'nome_em_uso');
  end if;

  select * into imp from public.importacao where slug = v_slug;

  insert into public.pessoas (nome, slug, pin_hash, admin)
  values (v_nome, v_slug, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), coalesce(imp.admin, false))
  returning id into v_id;

  if imp.slug is not null then
    insert into public.dias (pessoa_id, dia, itens)
    select v_id, j.key::date, public._itens(array(select jsonb_array_elements_text(j.value)))
    from jsonb_each(imp.dias) j
    on conflict (pessoa_id, dia) do nothing;
    delete from public.dias where pessoa_id = v_id and cardinality(itens) = 0;
    delete from public.importacao where slug = v_slug;
  end if;

  return json_build_object('ok', true, 'token', public._nova_sessao(v_id), 'importado', imp.slug is not null);
end $$;

create or replace function public.entrar(p_nome text, p_pin text) returns json
language plpgsql security definer set search_path = '' as $$
declare p public.pessoas%rowtype;
begin
  select * into p from public.pessoas where slug = public._slug(p_nome);
  if p.id is null then
    return json_build_object('ok', false, 'erro', 'nao_encontrado');
  end if;
  if p.bloqueado_ate is not null and p.bloqueado_ate > now() then
    return json_build_object('ok', false, 'erro', 'bloqueado',
                             'minutos', ceil(extract(epoch from p.bloqueado_ate - now()) / 60));
  end if;
  if extensions.crypt(coalesce(p_pin, ''), p.pin_hash) = p.pin_hash then
    update public.pessoas set falhas = 0, bloqueado_ate = null where id = p.id;
    return json_build_object('ok', true, 'token', public._nova_sessao(p.id));
  end if;
  -- 5 PINs errados seguidos bloqueiam por 15 minutos
  update public.pessoas
     set falhas        = case when falhas + 1 >= 5 then 0 else falhas + 1 end,
         bloqueado_ate = case when falhas + 1 >= 5 then now() + interval '15 minutes' else null end
   where id = p.id;
  return json_build_object('ok', false, 'erro', 'pin_errado');
end $$;

create or replace function public.sair(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.sessoes
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return json_build_object('ok', true);
end $$;

create or replace function public.trocar_pin(p_token text, p_atual text, p_novo text) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token); h text;
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if coalesce(p_novo, '') !~ '^[0-9]{4}$' then return json_build_object('ok', false, 'erro', 'pin_invalido'); end if;
  select pin_hash into h from public.pessoas where id = v;
  if extensions.crypt(coalesce(p_atual, ''), h) <> h then
    return json_build_object('ok', false, 'erro', 'pin_errado');
  end if;
  update public.pessoas set pin_hash = extensions.crypt(p_novo, extensions.gen_salt('bf', 8)) where id = v;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Dados de quem está logado
-- ---------------------------------------------------------------------

create or replace function public.meus_dados(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  return public._dados(v);
end $$;

create or replace function public.salvar_dia(p_token text, p_dia date, p_itens jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v  uuid := public._sessao(p_token);
  c  public.config%rowtype;
  it text[];
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if jsonb_typeof(p_itens) <> 'array' then return json_build_object('ok', false, 'erro', 'itens_invalidos'); end if;
  it := public._itens(array(select jsonb_array_elements_text(p_itens)));
  select * into c from public.config where id = 1;
  -- só dias do desafio, e no máximo "amanhã" em UTC (cobre quem está à frente do Brasil no fuso)
  if p_dia is null or p_dia < c.inicio or p_dia > c.inicio + c.dias - 1
     or p_dia > (now() at time zone 'utc')::date + 1 then
    return json_build_object('ok', false, 'erro', 'dia_invalido');
  end if;
  if cardinality(it) = 0 then
    delete from public.dias where pessoa_id = v and dia = p_dia;
  else
    insert into public.dias (pessoa_id, dia, itens) values (v, p_dia, it)
    on conflict (pessoa_id, dia) do update set itens = excluded.itens, atualizado_em = now();
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.anotar_espelho(p_token text, p_dia date, p_txt text, p_min int) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token); t text := trim(coalesce(p_txt, '')); r public.espelho%rowtype;
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if p_dia is null or char_length(t) < 1 or char_length(t) > 280 or p_min is null or p_min < 1 or p_min > 1440 then
    return json_build_object('ok', false, 'erro', 'anotacao_invalida');
  end if;
  if (select count(*) from public.espelho where pessoa_id = v) >= 2000 then
    return json_build_object('ok', false, 'erro', 'limite');
  end if;
  insert into public.espelho (pessoa_id, dia, txt, min) values (v, p_dia, t, p_min) returning * into r;
  return json_build_object('ok', true, 'id', r.id, 't', (extract(epoch from r.criado_em) * 1000)::bigint);
end $$;

create or replace function public.apagar_espelho(p_token text, p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  delete from public.espelho where id = p_id and pessoa_id = v;
  return json_build_object('ok', true);
end $$;

create or replace function public.definir_placar(p_token text, p_on boolean) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  update public.pessoas set placar = coalesce(p_on, true) where id = v;
  return json_build_object('ok', true);
end $$;

-- Placar: só quantos dos 5 itens cada um marcou por dia, nunca quais
create or replace function public.placar(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  return json_build_object('ok', true, 'pessoas', coalesce((
    select json_agg(json_build_object(
             'id', p.id, 'nome', p.nome, 'eu', p.id = v,
             'd', (select coalesce(json_object_agg(d.dia::text, cardinality(d.itens)), '{}'::json)
                   from public.dias d where d.pessoa_id = p.id))
           order by p.nome)
    from public.pessoas p
    where p.placar and exists (select 1 from public.dias d where d.pessoa_id = p.id)
  ), '[]'::json));
end $$;

-- ---------------------------------------------------------------------
-- Só para administradores
-- ---------------------------------------------------------------------

create or replace function public.ajustar_desafio(p_token text, p_inicio date, p_dias int, p_codigo text) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if not public._eh_admin(v) then return json_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  if p_inicio is null or p_dias is null or p_dias < 1 or p_dias > 366
     or char_length(trim(coalesce(p_codigo, ''))) < 3 or char_length(trim(p_codigo)) > 40 then
    return json_build_object('ok', false, 'erro', 'ajuste_invalido');
  end if;
  update public.config set inicio = p_inicio, dias = p_dias, codigo_time = trim(p_codigo) where id = 1;
  return json_build_object('ok', true);
end $$;

create or replace function public.equipe(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if not public._eh_admin(v) then return json_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  return json_build_object('ok', true, 'pessoas', coalesce((
    select json_agg(json_build_object('id', p.id, 'nome', p.nome, 'admin', p.admin, 'eu', p.id = v,
                                      'bloqueado', p.bloqueado_ate is not null and p.bloqueado_ate > now())
                    order by p.nome)
    from public.pessoas p), '[]'::json));
end $$;

create or replace function public.zerar_pin(p_token text, p_pessoa uuid, p_novo text) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if not public._eh_admin(v) then return json_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  if coalesce(p_novo, '') !~ '^[0-9]{4}$' then return json_build_object('ok', false, 'erro', 'pin_invalido'); end if;
  update public.pessoas
     set pin_hash = extensions.crypt(p_novo, extensions.gen_salt('bf', 8)), falhas = 0, bloqueado_ate = null
   where id = p_pessoa;
  if not found then return json_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  delete from public.sessoes where pessoa_id = p_pessoa;
  return json_build_object('ok', true);
end $$;

create or replace function public.remover_pessoa(p_token text, p_pessoa uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v uuid := public._sessao(p_token);
begin
  if v is null then return json_build_object('ok', false, 'erro', 'sessao'); end if;
  if not public._eh_admin(v) then return json_build_object('ok', false, 'erro', 'sem_permissao'); end if;
  if p_pessoa = v then return json_build_object('ok', false, 'erro', 'nao_pode_remover_a_si'); end if;
  delete from public.pessoas where id = p_pessoa;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Quem pode chamar o quê
-- ---------------------------------------------------------------------

revoke execute on function
  public._slug(text), public._itens(text[]), public._sessao(text), public._nova_sessao(uuid),
  public._eh_admin(uuid), public._dados(uuid)
from public, anon, authenticated;

revoke execute on function
  public.cadastrar(text, text, text), public.entrar(text, text), public.sair(text),
  public.trocar_pin(text, text, text), public.meus_dados(text), public.salvar_dia(text, date, jsonb),
  public.anotar_espelho(text, date, text, int), public.apagar_espelho(text, uuid),
  public.definir_placar(text, boolean), public.placar(text), public.ajustar_desafio(text, date, int, text),
  public.equipe(text), public.zerar_pin(text, uuid, text), public.remover_pessoa(text, uuid)
from public;

grant execute on function
  public.cadastrar(text, text, text), public.entrar(text, text), public.sair(text),
  public.trocar_pin(text, text, text), public.meus_dados(text), public.salvar_dia(text, date, jsonb),
  public.anotar_espelho(text, date, text, int), public.apagar_espelho(text, uuid),
  public.definir_placar(text, boolean), public.placar(text), public.ajustar_desafio(text, date, int, text),
  public.equipe(text), public.zerar_pin(text, uuid, text), public.remover_pessoa(text, uuid)
to anon, authenticated;
