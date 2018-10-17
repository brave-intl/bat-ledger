select execute($$

insert into migrations (id, description) values ('0005', 'owners');

create table owners(
  owner text primary key,
  provider_key text,
  provider_suffix text,
  provider_value text,
  visible boolean,
  authorized boolean,
  authority text,
  provider text,
  altcurrency text,
  parameters jsonb,
  default_currency text,
  info jsonb
)

$$) where not exists (select * from migrations where id = '0005');
