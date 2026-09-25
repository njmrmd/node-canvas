-- 0001_init: the whole node-canvas schema (spec §5). Fresh database; no data migrated.

create extension if not exists citext;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  -- scrypt verifier, scrypt$N$r$p$<salt b64>$<hash b64>. Never reversible.
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Server-side sessions so sign-out and deletion really revoke. Only the
-- SHA-256 of the cookie token is stored: a database read yields no cookie.
create table sessions (
  token_hash  bytea primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index sessions_user_id_idx on sessions(user_id);
create index sessions_expires_at_idx on sessions(expires_at);

-- One Anthropic key per user. ciphertext/iv/tag are AES-256-GCM under
-- KEY_VAULT_ENCRYPTION_KEY (server env only), AAD "<user_id>:anthropic".
create table provider_keys (
  user_id     uuid primary key references users(id) on delete cascade,
  ciphertext  bytea not null,
  iv          bytea not null,
  tag         bytea not null,
  last4       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One exchange per row. ids are minted by the browser.
create table nodes (
  id              uuid primary key,
  user_id         uuid not null references users(id) on delete cascade,
  parent_id       uuid,
  prompt          text not null,
  response        text not null default '',
  thinking        text not null default '',
  status          text not null check (status in ('draft','streaming','complete','interrupted','error')),
  error           jsonb,
  usage           jsonb,
  model           text,
  x               real not null,
  y               real not null,
  position_mode   text not null check (position_mode in ('auto','manual')),
  width           real,
  height          real,
  collapsed       boolean not null default false,
  body_collapsed  boolean not null default false,
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  unique (id, user_id),
  -- A node can only hang off a node owned by the same user; deleting a node
  -- deletes its subtree.
  foreign key (parent_id, user_id) references nodes(id, user_id) on delete cascade
);
create index nodes_user_id_idx on nodes(user_id);
create index nodes_parent_id_idx on nodes(parent_id);

create table canvas_view (
  user_id         uuid primary key references users(id) on delete cascade,
  viewport        jsonb not null,
  target_node_id  uuid references nodes(id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- Fixed-window counters; stale windows are deleted by the app on rollover.
create table rate_limits (
  bucket        text not null,
  subject       text not null,
  window_start  timestamptz not null,
  count         integer not null,
  primary key (bucket, subject, window_start)
);
