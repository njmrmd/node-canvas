-- Check the parent link at commit, not per row, so one save may carry a
-- child before its parent. Cascade deletes still happen immediately.
alter table nodes alter constraint nodes_parent_id_user_id_fkey deferrable initially deferred;
