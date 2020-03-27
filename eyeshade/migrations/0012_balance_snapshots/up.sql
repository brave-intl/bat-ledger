select execute($$
insert into migrations (id, description) values ('0012', 'balance_snapshots');

create table payout_reports(
  id                    uuid primary key,
  created_at            timestamp with time zone not null default current_timestamp,
  updated_at            timestamp with time zone not null default current_timestamp,
  latest_transaction_at timestamp with time zone,
  completed             boolean default false
);

create table balance_snapshots(
  id           uuid primary key default uuid_generate_v4(),
  created_at   timestamp with time zone not null default current_timestamp,
  snapshot_id  uuid not null references payout_reports(id) on delete cascade,
  account_id   text not null,
  account_type text not null,
  balance      numeric(28, 18) not null
);

create index payout_report_accounts_idx on balance_snapshots(snapshot_id, account_id);
create index payout_report_id_idx on balance_snapshots(snapshot_id);

$$) where not exists (select * from migrations where id = '0012');
