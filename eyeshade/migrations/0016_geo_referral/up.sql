select execute($$

insert into migrations (id, description) values ('0016', 'geo_referral');

CREATE UNIQUE INDEX IF NOT EXISTS geo_referral_countries_unique_idx ON geo_referral_countries(country_code, created_at);

$$) where not exists (select * from migrations where id = '0016');
