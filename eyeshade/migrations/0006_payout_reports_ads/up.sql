select execute($$

create extension if not exists "uuid-ossp";

insert into migrations (id, description) values ('0006', 'payout_reports_ads');

create table payout_reports_ads(
  id         uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone not null default current_timestamp
)
$$) where not exists (select * from migrations where id = '0006');
