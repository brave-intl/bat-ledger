select execute($$

drop index if exists transactions_document_id;

delete from migrations where id = '0020';

$$) where exists (select * from migrations where id = '0020');
