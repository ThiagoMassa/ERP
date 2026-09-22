import postgres, { type Sql } from 'postgres';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tenantConnectionOptions, tenantIdentity, TenantConfigurationError } from './tenant-identity.ts';

export type TenantHealth = {
  company_id: string; database: string; runtime_role: string; session_role: string;
  identity_matches: boolean; runtime_restricted: boolean; migrations: {version: string; checksum: string}[];
  reconciled: boolean; engine_installed: boolean;
  operational_state?: 'preparing'|'active'|'maintenance';
};
export type Migration = {version: string; sql: string; checksum: string};
export async function kernelMigration(): Promise<Migration> {
  const sql = await readFile(join(process.cwd(), 'db', 'tenant', '001-kernel.sql'), 'utf8');
  return {version: '001-kernel', sql, checksum: createHash('sha256').update(sql).digest('hex')};
}
export async function tenantMigrations(): Promise<Migration[]> {
  const versions = ['001-kernel','001-request-context','002-operations','003-dispatch','004-maintenance','005-access-epoch','006-assets'];
  return Promise.all(versions.map(async version => {
    const sql = await readFile(join(process.cwd(), 'db', 'tenant', `${version}.sql`), 'utf8');
    return {version, sql, checksum: createHash('sha256').update(sql).digest('hex')};
  }));
}

/** Only server configuration is passed here. Callers must authorize the company first. */
export async function inspectTenant(connection: string, companyId: string, options: {allowLocalTest?: boolean; ca?: string} = {}): Promise<TenantHealth> {
  const expected = tenantIdentity(companyId);
  const sql = postgres(tenantConnectionOptions(connection, companyId, options));
  try {
    const result = await sql<{health: TenantHealth}[]>`select tenant.health() as health`;
    const health = result[0]?.health;
    if (!health?.identity_matches || health.company_id !== expected.company || health.database !== expected.database || health.runtime_role !== expected.runtime || health.session_role !== expected.runtime) {
      throw new TenantConfigurationError('IDENTITY_MISMATCH', 'A identidade do banco não corresponde à empresa.');
    }
    if (!health.runtime_restricted) throw new TenantConfigurationError('UNSAFE_RUNTIME', 'Revise os privilégios da credencial: ela deve acessar somente o banco desta empresa.');
    return health;
  } catch (error) {
    if (error instanceof TenantConfigurationError) throw error;
    // PostgreSQL errors can contain passwords, hosts or full connection details.
    throw new TenantConfigurationError('CONNECTION_FAILED', 'Não foi possível validar a conexão e a identidade do banco empresarial.');
  } finally { await sql.end({timeout: 2}); }
}

export function assertTenantStructure(health: TenantHealth, required: Migration[]) {
  if (!health.identity_matches || !health.runtime_restricted || !health.engine_installed || !required.length || health.migrations.length !== required.length ||
      required.some(m => !health.migrations.some(a => a.version === m.version && a.checksum === m.checksum))) {
    throw new TenantConfigurationError('MIGRATION_PENDING', 'Banco ainda não liberado: confira identidade, isolamento e migrações.');
  }
}
export function assertTenantReady(health: TenantHealth, required: Migration[]) {
  assertTenantStructure(health,required);
  if (!health.reconciled || health.operational_state!=='active')throw new TenantConfigurationError('MIGRATION_PENDING', 'Banco ainda não liberado: confira conciliação e ativação dos dados.');
}

type ProvisionOptions = {
  companyId: string;
  runtimePassword: string;
  /** Maintenance credentials are never used by request handlers. */
  maintenance: Sql;
  connectMaintenanceDatabase: (database: string) => Sql;
  migrations: Migration[];
};

/** Repeatable infrastructure provisioning. Never adopts another owner's database. */
export async function provisionTenant(options: ProvisionOptions) {
  const identity = tenantIdentity(options.companyId);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(options.runtimePassword)) {
    throw new TenantConfigurationError('WEAK_SECRET', 'Use uma credencial aleatória de pelo menos 32 bytes.');
  }
  if (options.migrations[0]?.version !== '001-kernel' || new Set(options.migrations.map(m => m.version)).size !== options.migrations.length ||
      options.migrations.some(m => !/^[0-9]{3}-[a-z0-9-]+$/.test(m.version) || createHash('sha256').update(m.sql).digest('hex') !== m.checksum)) {
    throw new TenantConfigurationError('INVALID_MIGRATION', 'Pacote de migrações inválido.');
  }
  // CREATE DATABASE cannot run in a transaction. Reserve ONE session for the lock.
  const maintenance = await options.maintenance.reserve();
  let target: Sql | undefined;
  try {
    await maintenance`select pg_advisory_lock(hashtextextended(${identity.database},0))`;
    const creator = (await maintenance<{name: string}[]>`select current_user as name`)[0].name;
    const owner = await maintenance`select rolsuper,rolcanlogin,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=${identity.owner}`;
    if (!owner.length) {
      await maintenance.unsafe(`create role ${quoteIdentifier(identity.owner)} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit`);
      // PostgreSQL 16+ requires SET OPTION for a non-superuser creator to SET ROLE.
      await maintenance.unsafe(`grant ${quoteIdentifier(identity.owner)} to ${quoteIdentifier(creator)} with set true`);
    } else if (Object.values(owner[0]).some(Boolean)) {
      throw new TenantConfigurationError('UNSAFE_OWNER', 'O proprietário reservado possui privilégios inesperados.');
    }
    const role = await maintenance`select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolcanlogin from pg_roles where rolname=${identity.runtime}`;
    if (!role.length) {
      // Password was restricted to an injection-safe generated alphabet above.
      await maintenance.unsafe(`create role ${quoteIdentifier(identity.runtime)} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit connection limit 4 password '${options.runtimePassword}'`);
    } else if (role[0].rolsuper || role[0].rolcreatedb || role[0].rolcreaterole || role[0].rolreplication || role[0].rolbypassrls || role[0].rolinherit || !role[0].rolcanlogin) {
      throw new TenantConfigurationError('UNSAFE_RUNTIME', 'A credencial empresarial possui privilégios inesperados.');
    }
    if ((await maintenance`select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=${identity.runtime})`).length) {
      throw new TenantConfigurationError('UNSAFE_MEMBERSHIP', 'O usuário empresarial não pode pertencer a outros perfis de banco.');
    }
    const existing = await maintenance<{owner: string}[]>`select pg_get_userbyid(datdba) as owner from pg_database where datname=${identity.database}`;
    if (existing.length && existing[0].owner !== identity.owner) {
      throw new TenantConfigurationError('DATABASE_CONFLICT', 'Nome reservado já pertence a outro banco. Nenhum dado foi alterado.');
    }
    if (!existing.length) {
      await maintenance.unsafe(`create database ${quoteIdentifier(identity.database)} owner ${quoteIdentifier(identity.owner)} template template0 encoding 'UTF8'`);
    }
    await maintenance.unsafe(`revoke all on database ${quoteIdentifier(identity.database)} from public`);
    await maintenance.unsafe(`grant connect on database ${quoteIdentifier(identity.database)} to ${quoteIdentifier(identity.runtime)}`);
    target = options.connectMaintenanceDatabase(identity.database);
    await target.begin(async tx => {
      await tx.unsafe(`set local role ${quoteIdentifier(identity.owner)}`);
      await tx.unsafe('revoke all on schema public from public');
      // The reserved database must be empty, or already contain our exact marker.
      const installed = (await tx`select to_regclass('tenant.identity') is not null as present`)[0].present;
      if (installed) {
        const marker = await tx`select company_id,database_name,runtime_role from tenant.identity`;
        if (marker.length !== 1 || marker[0].company_id !== identity.company || marker[0].database_name !== identity.database || marker[0].runtime_role !== identity.runtime) {
          throw new TenantConfigurationError('IDENTITY_MISMATCH', 'Banco reservado pertence a outra empresa.');
        }
      } else {
        const relations = await tx`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' limit 1`;
        if (relations.length) throw new TenantConfigurationError('NONEMPTY_DATABASE', 'Banco sem identidade contém registros; a adoção automática foi recusada.');
      }
      for (const migration of options.migrations) {
        const prior = installed ? await tx`select checksum from tenant.migrations where version=${migration.version}` : [];
        if (prior.length) {
          if (prior[0].checksum !== migration.checksum) throw new TenantConfigurationError('MIGRATION_CHANGED', 'Uma migração já aplicada foi alterada. Crie uma migração incremental.');
          continue;
        }
        await tx.unsafe(migration.sql);
        if (migration.version === '001-kernel') {
          await tx`insert into tenant.identity(company_id,database_name,runtime_role) values(${identity.company},${identity.database},${identity.runtime})`;
        }
        await tx`insert into tenant.migrations(version,checksum) values(${migration.version},${migration.checksum})`;
      }
      await tx.unsafe(`grant usage on schema tenant to ${quoteIdentifier(identity.runtime)}`);
      await tx.unsafe(`grant execute on function tenant.health() to ${quoteIdentifier(identity.runtime)}`);
      if ((await tx`select to_regprocedure('tenant.dispatch(jsonb,text,text,jsonb,uuid)') is not null as installed`)[0].installed) {
        await tx.unsafe(`grant execute on function tenant.dispatch(jsonb,text,text,jsonb,uuid) to ${quoteIdentifier(identity.runtime)}`);
      }
      await tx.unsafe(`alter default privileges revoke execute on functions from public`);
    });
    return {companyId: identity.company, database: identity.database, credentialRef: identity.credentialRef, state: 'awaiting-engine-and-reconciliation' as const};
  } finally {
    await target?.end({timeout: 2});
    try { await maintenance`select pg_advisory_unlock(hashtextextended(${identity.database},0))`; }
    finally { maintenance.release(); }
  }
}

function quoteIdentifier(value: string) { return '"' + value.replaceAll('"', '""') + '"'; }
