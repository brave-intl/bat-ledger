insert into migrations (id, description) values ('0004', 'manual_settlements');
alter table transactions drop constraint check_transaction_type;
alter table transactions add constraint check_transaction_type
  check (transaction_type in ('contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual', 'ad', 'ad_settlement', 'manual_settlement'));
