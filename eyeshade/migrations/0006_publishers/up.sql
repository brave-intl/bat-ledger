select execute($$

insert into migrations (id, description) values ('0006', 'publishers');

create table publishers (
  publishers text primary key,
  authority text,
  verified boolean,
  visible boolean,
  owner text,
  provider_name text,
  provider_suffix text,
  provider_value text,
  authorizer_email text,
  authorizer_name text,
  altcurrency text,
  info jsonb
)

$$) where not exists (select * from migrations where id = '0006');
