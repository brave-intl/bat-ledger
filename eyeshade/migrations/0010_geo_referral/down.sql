select execute($$

drop table geo_referral_countries;
drop table geo_referral_groups;
delete from migrations where id = '0010';

$$) where exists (select * from migrations where id = '0010');