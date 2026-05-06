# Storage Strategy Guide

This document outlines the recommended storage strategy for `download-hub`.

## Recommendation: Cloudflare R2 for Production

For all production and serious staging environments, **Cloudflare R2 is the canonical storage backend.** The application is designed and optimized for this workflow.

Local disk storage is supported **only** for local development, testing, or as a transitional step during migration from a legacy file system.

## Comparison: R2 vs. Local Disk

| Feature | Cloudflare R2 (Recommended) | Local Disk (Legacy / Dev) |
| :--- | :--- | :--- |
| **Scalability** | Near-infinite, managed by Cloudflare. No server disk space concerns. | Limited to the server's attached disk size. Requires manual scaling. |
| **Statelessness** | ✅ Stateless app process — no file data on the host. | ❌ Stateful — app process depends on the host filesystem. |
| **Performance** | High-performance global object storage. Offloads delivery from the app server. | Limited by server's disk I/O and network bandwidth. App server is a bottleneck. |
| **Cost** | Typically very low cost ($0.015/GB/month) with zero egress fees. | "Free" upfront, but you pay for server disk space, bandwidth, and operational time. |
| **Backups** | Handled by Cloudflare's resilient infrastructure. Catalog (`files.json`) still needs backup. | Requires manual server-level or volume snapshot strategies. |
| **Admin UI** | Fully integrated with the `/admin/r2` panel for uploads, sync, and metadata. | Relies on legacy sync scripts and manual file placement via SSH/SFTP. |

## How to Configure

### Production Mode: Cloudflare R2 (Default)

Ensure these environment variables are set in your `.env`:

```env
# Enable R2 mode
R2_ENABLED=true

# R2 Credentials
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=your-bucket-name
```

In this mode the app process holds no file data — only the catalog and code.

### Development/Legacy Mode: Local Disk

To use the local filesystem, explicitly disable R2 and ensure `./storage/files/` exists and is writable by the process.

```env
# Disable R2 mode to fall back to local disk
R2_ENABLED=false
FILES_STORAGE_PATH=./storage/files
```

**Warning:** Running in local disk mode in production is **not recommended** because the app server becomes a delivery and storage bottleneck.
