select execute($$

insert into migrations (id, description) values ('0006', 'grants');

create table grants(
  id uuid primary key,
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp,
  cohort text not null,
  channel text not null,
  type text not null,
  promotion_id uuid not null,
  amount numeric(28, 18) check (amount > 0.0)
);
alter table grants add constraint check_grant_type
  check (type in ('auto-contribute', 'recurring-tip', 'oneoff-tip'));

$$) where not exists (select * from migrations where id = '0006');
