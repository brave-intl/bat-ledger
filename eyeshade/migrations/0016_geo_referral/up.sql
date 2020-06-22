select execute($$

insert into migrations (id, description) values ('0016', 'geo_referral');

$$) where not exists (select * from migrations where id = '0016');
