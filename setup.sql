-- ============================================================
-- Catalogue Paris — Schéma de base de données
-- À exécuter dans Supabase : SQL Editor → New query → Run
-- ============================================================

-- Table des catégories
create table if not exists categories (
  id text primary key,
  name text not null,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Table des produits
create table if not exists products (
  id text primary key,
  ref text not null,
  name text not null,
  price numeric(10,2) not null default 0,
  category_id text references categories(id) on delete set null,
  image text,                          -- image encodée en base64 (data URL)
  unit_step int not null default 1,    -- incrément de quantité (1 = à l'unité, 12 = par paquet de 12)
  unit_label text default '',          -- ex: "paquet de 12", laissé vide pour vente à l'unité
  sort_order int default 0,
  created_at timestamptz default now()
);

-- Table des commandes
create table if not exists orders (
  id bigint generated always as identity primary key,
  order_number text not null,          -- ex: "128"
  client_name text,
  items jsonb not null,                -- [{ref, name, qty, price}, ...]
  total numeric(10,2) not null default 0,
  status text not null default 'nouvelle', -- nouvelle | en_cours | terminee
  created_at timestamptz default now()
);

-- Table des réglages (un seul rang, id fixe)
create table if not exists settings (
  id int primary key default 1,
  shop_name text default 'Souvenirs de Paris',
  whatsapp text default '',
  email text default '',
  admin_pin text default '1234',
  next_order_number int default 1,
  updated_at timestamptz default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- Row Level Security : accès public en lecture/écriture
-- (app à usage interne, protégée par code admin côté application)
-- ============================================================
alter table categories enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table settings enable row level security;

create policy "categories_all" on categories for all using (true) with check (true);
create policy "products_all" on products for all using (true) with check (true);
create policy "orders_all" on orders for all using (true) with check (true);
create policy "settings_all" on settings for all using (true) with check (true);

-- ============================================================
-- Données initiales (catalogue de départ)
-- ============================================================
insert into categories (id, name, sort_order) values
  ('cat-magnets', 'Magnets résine', 1)
on conflict (id) do nothing;

insert into products (id, ref, name, price, category_id, image, unit_step, unit_label, sort_order) values
  ('MAT221', 'MAT221', 'Magnet baguette — sac Paris bordeaux', 1.00, 'cat-magnets', '', 1, '', 1),
  ('MAT222', 'MAT222', 'Magnet baguette — sac Restaurant Paris', 1.00, 'cat-magnets', '', 1, '', 2),
  ('MAT223', 'MAT223', 'Magnet baguette — sac Paris vichy', 1.00, 'cat-magnets', '', 1, '', 3),
  ('MAT228', 'MAT228', 'Magnet planche à découper Paris', 1.00, 'cat-magnets', '', 1, '', 4),
  ('MAT239', 'MAT239', 'Magnet panier garni Paris', 1.00, 'cat-magnets', '', 1, '', 5),
  ('MAT240', 'MAT240', 'Magnet cagette de provisions Paris', 1.00, 'cat-magnets', '', 1, '', 6),
  ('MAT241', 'MAT241', 'Magnet panier fleuri Paris', 1.00, 'cat-magnets', '', 1, '', 7)
on conflict (id) do nothing;
