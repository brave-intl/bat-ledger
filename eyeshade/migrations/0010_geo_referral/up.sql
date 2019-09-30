select execute($$

insert into migrations (id, description) values ('0010', 'geo_referral');

create table geo_referral_groups(
  id               uuid primary key default uuid_generate_v4(),
  created_at       timestamp with time zone not null default current_timestamp,
  active_at        timestamp with time zone not null default current_timestamp,
  currency         varchar(8) not null,
  name             varchar(64) not null,
  amount           numeric(28, 18) not null check (amount > 0.0)
);

create table geo_referral_countries(
  id               uuid primary key default uuid_generate_v4(),
  created_at       timestamp with time zone not null default current_timestamp,
  name             varchar(64) not null,
  group_id         uuid not null references geo_referral_groups(id) on delete restrict,
  country_code     varchar(8) not null
);

create index on geo_referral_countries(country_code);

$$) where not exists (select * from migrations where id = '0010');
