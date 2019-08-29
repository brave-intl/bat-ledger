select execute($$

insert into migrations (id, description) values ('0012', 'snapshots');

create table snapshots(
  id               uuid primary key default uuid_generate_v4(),
  created_at       timestamp not null default current_timestamp,
  target_date      timestamp not null,
  top              jsonb not null,
  transactions     jsonb not null,
  votes            jsonb not null
);

$$) where not exists (select * from migrations where id = '0012');
