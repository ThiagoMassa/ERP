-- Incremental central module. Historical audit rows remain immutable.
-- These commands affect the identity globally, even when invoked from a company view.
create function erp_control.account_audit_context() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.action in ('user.status','user.revoke') then
  new.company_id:=null;
  new.entity:=new.subject_id::text;
 end if;
 return new;
end $$;
revoke all on function erp_control.account_audit_context() from public,anon,authenticated;
create trigger account_audit_context before insert on erp_control.audit
for each row execute function erp_control.account_audit_context();
