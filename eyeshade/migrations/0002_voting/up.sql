select execute($$

insert into migrations (id, description) values ('0002', 'voting');

create table votes(
  id uuid primary key,
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp,

  cohort text not null,

  amount numeric(28, 18) check (amount > 0.0),
  fees numeric(28, 18) check (fees > 0.0),

  tally integer not null check (tally > 0),

  excluded boolean not null,
  transacted boolean not null default false,

  channel text not null,
  surveyor_id text not null
);

create table surveyor_groups(
  id text primary key,
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp,

  price numeric(28, 18) not null check (price > 0.0),

  frozen boolean not null default false
);

$$) where not exists (select * from migrations where id = '0002');
