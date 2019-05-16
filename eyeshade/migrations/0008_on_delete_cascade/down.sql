select execute($$

delete from migrations where id = '0008';

ALTER TABLE potential_payments_ads
  DROP CONSTRAINT cascade_payout_report_id;

ALTER TABLE potential_payments_ads
  ADD CONSTRAINT potential_payments_ads_payout_report_id_fkey
  FOREIGN KEY (payout_report_id)
  REFERENCES payout_reports_ads(id);

$$) where exists (select * from migrations where id = '0008');
