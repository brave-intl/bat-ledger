select execute($$
insert into migrations (id, description) values ('0012', 'balance_snapshots');

create table balance_snapshots(
  id         uuid primary key,
  total      numeric(28, 18) default 0.0 check (total >= 0.0),
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp,
  completed  boolean default false
);

create table balance_snapshot_accounts(
  id           uuid primary key,
  created_at   timestamp with time zone not null default current_timestamp,
  snapshot_id  uuid not null references balance_snapshots(id),
  account_id   text not null,
  account_type text not null,
  balance      numeric(28, 18) not null check (balance > 0.0)
);

create index on balance_snapshot_accounts(snapshot_id, account_id, account_type);

$$) where not exists (select * from migrations where id = '0012');
