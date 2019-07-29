select execute($$

insert into migrations (id, description) values ('0009', 'unique_payment_ids');

alter table potential_payments_ads
  add constraint unique_payment_id_payout_report_id unique(payment_id, payout_report_id);

$$) where not exists (select * from migrations where id = '0009');
