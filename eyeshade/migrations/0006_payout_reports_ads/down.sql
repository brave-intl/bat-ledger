select execute($$

drop table payout_reports_ads;
delete from migrations where id = '0006';

$$) where exists (select * from migrations where id = '0006');
