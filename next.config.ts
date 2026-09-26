import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/erp': ['./db/tenant/*.sql'],
    '/api/erp/files': ['./db/tenant/*.sql'],
    '/api/admin/database': ['./db/tenant/*.sql'],
  },
};

export default nextConfig;
