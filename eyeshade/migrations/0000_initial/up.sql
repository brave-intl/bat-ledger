create or replace function execute(text) returns void as $$
begin execute $1; end;
$$ language plpgsql strict;

create or replace function table_exists(text, text) returns bool as $$
select exists(select 1 from information_schema.tables where (table_schema, table_name, table_type) = ($1, $2, 'BASE TABLE'));
$$ language sql strict;

select execute($$

create table migrations (
  id          text not null primary key,
  description text not null
);

insert into migrations (id, description) values ('0000', 'initial');

$$) where not table_exists('public', 'migrations');
