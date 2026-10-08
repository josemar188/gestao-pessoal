-- Gastos: esquema da base de dados (Supabase / Postgres)
-- Colar tudo no SQL Editor do Supabase e carregar em "Run". Pode ser executado mais de uma vez.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  emoji text not null default '📦',
  color text not null default '#6b7772',
  budget numeric(12,2),
  keywords text[] not null default '{}',
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  merchant text not null default '',
  category_id uuid references public.categories(id) on delete set null,
  card text,
  note text,
  spent_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual', 'apple_pay')),
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_spent_idx on public.expenses (user_id, spent_at desc);

-- Token pessoal usado pelo Atalho do iPhone para registar pagamentos sem login.
create table if not exists public.ingest_tokens (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.ingest_tokens enable row level security;

drop policy if exists "categories_own" on public.categories;
create policy "categories_own" on public.categories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "expenses_own" on public.expenses;
create policy "expenses_own" on public.expenses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "ingest_tokens_own" on public.ingest_tokens;
create policy "ingest_tokens_own" on public.ingest_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.categories, public.expenses, public.ingest_tokens to authenticated;

-- Chamado pelo Atalho: POST /rest/v1/rpc/ingest_expense
-- Aceita o montante como texto ("12,50 €", "€1.234,56", "12.5") e escolhe a categoria
-- pelo último gasto no mesmo comerciante ou pelas palavras-chave das categorias.
create or replace function public.ingest_expense(
  p_token text,
  p_amount text,
  p_merchant text default null,
  p_card text default null,
  p_note text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_clean text;
  v_parts text[];
  v_amount numeric;
  v_merchant text := btrim(coalesce(p_merchant, ''));
  v_cat uuid;
  v_id uuid;
begin
  select user_id into v_user from ingest_tokens where token = p_token;
  if v_user is null then
    raise exception 'Token inválido';
  end if;

  v_clean := regexp_replace(coalesce(p_amount, ''), '[^0-9,.]', '', 'g');
  v_parts := regexp_match(v_clean, '^(.*)[,.]([0-9]{1,2})$');
  if v_parts is not null then
    v_amount := (coalesce(nullif(regexp_replace(v_parts[1], '[,.]', '', 'g'), ''), '0') || '.' || v_parts[2])::numeric;
  else
    v_amount := nullif(regexp_replace(v_clean, '[,.]', '', 'g'), '')::numeric;
  end if;
  if v_amount is null then
    raise exception 'Montante inválido: %', p_amount;
  end if;

  if v_merchant <> '' then
    select category_id into v_cat from expenses
      where user_id = v_user and category_id is not null and lower(merchant) = lower(v_merchant)
      order by spent_at desc limit 1;
    if v_cat is null then
      select c.id into v_cat from categories c
        where c.user_id = v_user
          and exists (select 1 from unnest(c.keywords) k where k <> '' and lower(v_merchant) like '%' || lower(k) || '%')
        order by c.position limit 1;
    end if;
  end if;

  insert into expenses (user_id, amount, merchant, category_id, card, note, source)
  values (v_user, v_amount, v_merchant, v_cat, nullif(btrim(coalesce(p_card, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), 'apple_pay')
  returning id into v_id;

  return json_build_object('id', v_id, 'amount', v_amount, 'category_id', v_cat);
end;
$$;

revoke all on function public.ingest_expense(text, text, text, text, text) from public;
grant execute on function public.ingest_expense(text, text, text, text, text) to anon, authenticated;
