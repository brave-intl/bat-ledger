select execute($$

drop table payout_reports;
drop table balance_snapshots;

delete from migrations where id = '0012';

$$) where exists (select * from migrations where id = '0012');
