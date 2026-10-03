# Build and run on a Linux server/CI. Nothing is installed on the user's PC.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM postgres:17.11-bookworm AS operator
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /build/node_modules/postgres ./node_modules/postgres
COPY --from=dependencies /build/node_modules/zod ./node_modules/zod
COPY package.json ./
COPY lib/server/tenant-identity.ts lib/server/tenant-database.ts lib/server/tenant-backup.ts lib/server/tenant-maintenance.ts ./lib/server/
COPY lib/server/tenant-preflight.ts lib/server/operator-connection.ts ./lib/server/
COPY db/tenant/ ./db/tenant/
COPY scripts/run-maintenance.mjs ./scripts/
COPY scripts/preflight-tenant.mjs scripts/provision-tenant.mjs ./scripts/
RUN mkdir -p /backups /app/work && chown postgres:postgres /backups /app/work
ENV ERP_PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump \
    ERP_PG_RESTORE=/usr/lib/postgresql/17/bin/pg_restore \
    ERP_PSQL=/usr/lib/postgresql/17/bin/psql \
    ERP_BACKUP_DIRECTORY=/backups
USER postgres
# Overrides the postgres image entrypoint: this is an operator, not a DB server.
ENTRYPOINT ["node", "--experimental-strip-types", "scripts/run-maintenance.mjs"]
CMD ["--help"]

FROM operator AS verification
COPY --from=dependencies /build/node_modules ./node_modules
COPY lib/server/asset-content.ts ./lib/server/
COPY tests/tenant-backup.test.mjs tests/tenant-corrections.test.mjs tests/admin-records.test.mjs tests/linux-backup-runner.mjs ./tests/
COPY tests/tenant-preflight.test.mjs ./tests/
COPY tests/tenant-manual-provision.test.mjs ./tests/
COPY db/admin-control.sql db/tenant-routing.sql db/tenant-backup-control.sql db/admin-records.sql db/admin-corrections.sql ./db/
COPY tests/helpers/pg-tools.mjs ./tests/helpers/
ENTRYPOINT ["node", "--experimental-strip-types", "tests/linux-backup-runner.mjs"]
CMD []

FROM operator AS production
