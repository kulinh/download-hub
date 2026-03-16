# Storage Strategy Guide

This document outlines the recommended storage strategy for `download-hub`.

## Recommendation: Cloudflare R2 for Production

For all production and serious staging environments, **Cloudflare R2 is the canonical storage backend.** The application is designed and optimized for this workflow.

Local disk storage is supported **only** for local development, testing, or as a transitional step during migration from a legacy file system.

## Comparison: R2 vs. Local Disk

| Feature | Cloudflare R2 (Recommended) | Local Disk (Legacy / Dev) |
| :--- | :--- | :--- |
| **Scalability** | Near-infinite, managed by Cloudflare. No server disk space concerns. | Limited to the server's attached disk size. Requires manual scaling. |
| **Statelessness** | ✅ **Enables stateless containers.** The app container holds no file data. | ❌ **Creates stateful containers.** Requires persistent volume mounts. |
| **Docker-Friendliness**| Excellent. Containers are ephemeral and can be replaced or scaled easily. | Poor. Complicates container management, backups, and horizontal scaling. |
| **Performance** | High-performance global object storage. Offloads delivery from the app server. | Limited by server's disk I/O and network bandwidth. App server is a bottleneck. |
| **Cost** | Typically very low cost ($0.015/GB/month) with zero egress fees. | "Free" upfront, but you pay for server disk space, bandwidth, and operational time. |
| **Backups** | Handled by Cloudflare's resilient infrastructure. Catalog (`files.json`) still needs backup. | Requires manual server-level or volume snapshot strategies. |
| **Admin UI** | Fully integrated with the `/admin/r2` panel for uploads, sync, and metadata. | Relies on legacy sync scripts and manual file placement via SSH/SFTP. |

## How to Configure

### Production Mode: Cloudflare R2 (Default)

Ensure these environment variables are set in your `.env` or Portainer stack:

```env
# Enable R2 mode
R2_ENABLED=true

# R2 Credentials
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=your-bucket-name
```

In this mode, no volume mount is needed for file storage, making the container fully stateless.

### Development/Legacy Mode: Local Disk

To use the local filesystem, explicitly disable R2 and mount the storage volume.

1.  **Environment Variables:**

    ```env
    # Disable R2 mode to fall back to local disk
    R2_ENABLED=false
    ```

2.  **Docker Compose (`docker-compose.yml`):**

    Ensure the `storage` volume is mounted.

    ```yaml
    services:
      app:
        # ...
        volumes:
          - ./storage:/app/storage
    ```

**Warning:** Running in local disk mode in production is **not recommended** and defeats many of the benefits of using a containerized, stateless application architecture.
