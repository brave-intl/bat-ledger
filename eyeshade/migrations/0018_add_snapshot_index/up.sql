select execute($$

insert into migrations (id, description) values ('0018', 'add_snapshot_index');

CREATE INDEX balance_snapshots_created_at_idx
ON balance_snapshots (created_at);

$$) where not exists (select * from migrations where id = '0018');
