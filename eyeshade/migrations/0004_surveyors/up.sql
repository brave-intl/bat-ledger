select execute($$

insert into migrations (id, description) values ('0004', 'surveyors');

create type surveyor_type as enum ('contribution')

create table surveyors(
  surveyor_id text primary key,
  surveyor_type surveyor_type,
  votes int,
  counts int,
  altcurrency text,
  probi numeric(28) not null check (probi > 0.0),
  frozen boolean,
  mature boolean,
  rejectedVotes int,
  inputs numeric(28) not null check (inputs > 0.0),
  fee numeric(28) not null check (fee > 0.0),
  quantum int
)

$$) where not exists (select * from migrations where id = '0004');
