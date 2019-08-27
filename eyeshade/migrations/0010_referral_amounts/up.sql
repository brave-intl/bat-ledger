select execute($$

create table geo_referral_amounts(
  country_code text not null unique,
  created_at timestamp with time zone not null default current_timestamp,
  currency text not null,
  -- numeric(precision, scale), precision is total sig figs, scale is fractional digits - after decimal point
  -- for BAT the scale is 18, there are 2 billion (2,000,000,000) tokens so precision should be 18 + 10 = 28
  amount numeric(28, 18) not null check (amount > 0.0)
);

create index on geo_referral_amounts(country_code);

$$) where not exists (select * from migrations where id = '0010');
