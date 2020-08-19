select execute($$

drop table balance_snapshots;
drop table payout_reports;

delete from migrations where id = '0012';

$$) where exists (select * from migrations where id = '0012');
