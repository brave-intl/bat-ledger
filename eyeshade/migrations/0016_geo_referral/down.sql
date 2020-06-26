select execute($$

DROP INDEX IF EXISTS geo_referral_countries_unique_idx;

delete from migrations where id = '0016';

$$) where exists (select * from migrations where id = '0016');
