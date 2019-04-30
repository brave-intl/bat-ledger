select execute($$

insert into migrations (id, description) values ('0007', 'potential_payments_ads');

create table potential_payments_ads(
  id               uuid primary key default uuid_generate_v4(),
  payout_report_id uuid not null references payout_reports_ads(id),
  payment_id       uuid not null,
  provider_id      uuid not null,
  amount           numeric(28, 18) not null check (amount > 0.0),
  created_at timestamp with time zone not null default current_timestamp
)
$$) where not exists (select * from migrations where id = '0007');
