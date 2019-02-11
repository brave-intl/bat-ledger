select execute($$

delete from migrations where id = '0005';

alter table transactions drop constraint check_from_account_type;
alter table transactions drop constraint check_to_account_type;
alter table transactions drop constraint check_transaction_type;

alter table transactions add constraint check_from_account_type
  check (from_account_type in ('channel', 'owner', 'uphold', 'internal', 'payment_id'));
alter table transactions add constraint check_to_account_type
  check (to_account_type in ('channel', 'owner', 'uphold', 'internal', 'payment_id'));

alter table transactions add constraint check_transaction_type
  check (transaction_type in ('contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual', 'ad', 'ad_settlement', 'manual_settlement'));

$$) where exists (select * from migrations where id = '0005');
