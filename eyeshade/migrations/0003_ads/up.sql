select execute($$

insert into migrations (id, description) values ('0003', 'ads');

ALTER TYPE account_type ADD value 'payment_id';
ALTER TYPE transaction_type ADD value 'ad';
ALTER TYPE transaction_type ADD value 'ad_settlement';

REFRESH MATERIALIZED VIEW account_balances;

$$) where not exists (select * from migrations where id = '0003');
