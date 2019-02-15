select execute($$

delete from migrations where id = '0004';

alter table transactions drop constraint check_transaction_type;
alter table transactions add constraint check_transaction_type
  check (transaction_type in ('contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual', 'ad', 'ad_settlement'));

$$) where exists (select * from migrations where id = '0004');
