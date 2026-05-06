# DL-HUB Redesign — Implementation Spec

> Handoff document for Claude Code. Source mockup: `DL-HUB Redesign.html` (interactive prototype, design_canvas with 4 artboards). Target stack: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind**, deployed to Cloudflare Workers/Pages.

---

## 0. Design system foundations

### 0.1 Visual language
- **Aesthetic**: terminal/dev — mono primary, technical metadata visible (paths, sizes, perms-style rows), blinking cursor accents, code-style command bars.
- **Primary font**: `JetBrains Mono` (weights 400/500/600/700). Use for all UI chrome, file names, labels, numeric values.
- **Body font** (descriptions, marketing copy only): `Inter` (weights 400/500/600/700).
- **Display**: same as mono — `JetBrains Mono` 700 with `letter-spacing: -0.02em` for headings.
- **No emoji**. Iconography via inline SVG only — see `shared.jsx` `Icon.*` for the set used.

### 0.2 Color tokens
Implement as CSS variables on `:root` (light) and `.theme-dark`. Full source: `tokens.css` in the prototype project.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fafaf9` | `#0a0a0b` | App background |
| `--bg-elev` | `#ffffff` | `#131316` | Cards, modals, table |
| `--bg-sunken` | `#f4f4f3` | `#07070a` | Sub-bars, table foot |
| `--bg-hover` | `#f0efed` | `#1c1c20` | Row hover |
| `--bg-code` | `#1a1a1d` | `#000000` | Command bar bg |
| `--fg` | `#0a0a0a` | `#f5f5f4` | Primary text |
| `--fg-muted` | `#6b6b6b` | `#a1a1a1` | Secondary text |
| `--fg-subtle` | `#9a9a9a` | `#6a6a6a` | Captions, separators |
| `--line` | `#e5e5e3` | `#26262a` | Borders |
| `--line-strong` | `#d0d0cd` | `#3a3a3f` | Hover borders |
| `--line-faint` | `#ededeb` | `#1c1c20` | Row dividers |
| `--accent` | `#7c3aed` | `#a78bfa` | Purple — links, primary CTA |
| `--accent-hover` | `#6d28d9` | `#c4b5fd` | CTA hover |
| `--accent-soft` | `#f4eeff` | `#1f1530` | Accent backgrounds |
| `--success` | `#16a34a` | `#4ade80` | Published badge, success |
| `--warning` | `#d97706` | `#fbbf24` | — |
| `--danger` | `#dc2626` | `#f87171` | Delete actions |
| `--r2` | `#ea580c` | `#fb923c` | R2 source badge |
| `--dropbox` | `#2563eb` | `#60a5fa` | Dropbox source badge |
| `--local` | `#6b7280` | `#9ca3af` | Local source badge |

Each colored source/status also has a `*-soft` variant for badge backgrounds.

### 0.3 Spacing / radii / shadows
- `--radius-xs: 4px` (chips, small buttons)
- `--radius-sm: 6px` (inputs, cards, buttons)
- `--radius-md: 8px` (panels, stat cards)
- `--radius-lg: 12px` (modals)
- Shadows: `--shadow-sm/md/lg`. Avoid heavy shadows; rely on borders for depth.

### 0.4 Theme + i18n
- **Theme**: `light` | `dark`. Persist in `localStorage('dl.theme')` and apply via `class="theme-light"` / `class="theme-dark"` on `<html>`. Respect `prefers-color-scheme` on first load.
- **Language**: `vi` | `en`. Persist in `localStorage('dl.lang')` and via `?lang=vi|en` query param. Strings live in `i18n/{vi,en}.ts` — see `shared.jsx` `COPY` for the canonical string set.

---

## 1. Routes & data model

### 1.1 Routes (Next.js App Router)
```
app/
  layout.tsx              ── theme provider + lang provider + Inter/JetBrains Mono
  page.tsx                ── homepage (chosen variant)
  admin/
    layout.tsx            ── auth guard + admin shell
    storage/page.tsx      ── storage management (this redesign)
    analytics/page.tsx    ── (future) download stats
    settings/page.tsx     ── (future) Turnstile, R2, Dropbox config
  api/
    files/route.ts        ── GET list (public, filtered by published=true)
    files/[id]/route.ts   ── PATCH publish/unpublish, DELETE, PUT rename
    files/upload/route.ts ── POST multipart, returns presigned URL or stream
    download/[id]/route.ts── POST { turnstileToken } → 302 to presigned URL
    stats/route.ts        ── GET admin overview stats
```

### 1.2 File entity
```ts
interface FileRecord {
  id: string;             // ULID
  name: string;           // display name (after slug or original)
  ext: string;            // 'pdf' | 'mp4' | ... (lowercase, no dot)
  size: number;           // bytes
  modified: string;       // ISO 8601
  source: 'r2' | 'dropbox' | 'local';
  path: string;           // R2 key, Dropbox path, or local relative path
  published: boolean;
  downloads: number;
  desc: string | null;    // short caption shown on homepage
  // not displayed in this redesign but kept for parity:
  uploader?: string;
  contentType?: string;
}
```

### 1.3 Category mapping (used for filter chips)
```ts
function categoryFor(ext: string): 'documents' | 'archives' | 'media' | 'code' | 'other' {
  if (['pdf','md','docx','doc','txt'].includes(ext)) return 'documents';
  if (['zip','tar','gz','7z','rar'].includes(ext)) return 'archives';
  if (['mp4','mp3','mov','avi','png','jpg','jpeg','gif','webp','svg'].includes(ext)) return 'media';
  if (['json','js','ts','jsx','tsx','csv','yaml','toml','sh'].includes(ext)) return 'code';
  return 'other';
}
```

### 1.4 Formatting helpers
Port from `shared.jsx`:
- `fmtBytes(n)` — `B` / `KB` / `MB` / `GB`, 1 decimal
- `fmtDate(iso, lang)` — `dd/mm/yyyy` (vi) / `yyyy-mm-dd` (en)
- `fmtRelative(iso, lang)` — "5 phút trước" / "5m ago"
- `fmtCount(n, lang)` — `1.2k` / `1.5M`

---

## 2. Homepage — V1 (Editorial dense list) — CHOSEN

> **Decision: ship V1.** V2 (Terminal/CLI) and V3 (Master-detail split) live in the prototype as alternates only — do not implement them. Reference source: `homepage-v1.jsx`.

### 2.0 Layout summary
1. **Sticky top bar** — brand dot + `DOWNLOAD HUB / Public files` · theme toggle · lang toggle (VI/EN) · admin link.
2. **Hero** (full-bleed, above the toolbar)
   - Meta line: `● live` + breadcrumb `~/downloads/public`.
   - H1: page title with blinking purple cursor (`_`).
   - Tagline (1 line, fg-muted).
   - Stats row: `{N} files · {totalSize} total · {downloads}`.
3. **Sticky toolbar** (sticks below top bar)
   - Search input (slash-to-focus, `kbd` hint).
   - Filter chips: all · documents · archives · media · code (with counts).
   - Sort `<select>`: recent / popular / size / name.
4. **Table** — 6 columns:
   `name (icon + main + desc + source badge) · type · size · modified · downloads · download button`.
5. **Footer** — `dl-hub v{version} · cloudflare workers · turnstile protected`.

Max content width: **1080px**, gutters 24px.

### 2.1 Shared homepage requirements (all variants)
- Sticky top bar: brand · search · lang toggle · theme toggle · admin link.
- **Search**: client-side fuzzy match across `name`, `desc`, `ext`. Press `/` to focus (V1) or `⌘K` / `Ctrl+K` (V3).
- **Filter chips**: `all` · `documents` · `archives` · `media` · `code` — counts shown next to each. Filter is client-side over the published list.
- **Sort**: `recent` (default, by modified desc) · `popular` (downloads desc) · `size` (desc) · `name` (A-Z).
- **List item**: must show `name`, `ext`, `size`, `modified` (relative), `downloads`, `source` badge. Description shown if present (V1, V2 only — V3 shows in detail pane).
- **Source badges**: 3 mutually exclusive — `R2` (orange), `Dropbox` (blue), `Local` (gray). All-caps mono, 9.5px, padding `1px 6px`, soft background.
- **Empty state**: `# No files matched` (mono, fg-subtle).
- **Footer**: `dl-hub v{version}` · `cloudflare workers` · `turnstile protected`.

### 2.2 Download flow (all variants)
1. User clicks "Download" on a row.
2. Open modal `<DownloadModal>`:
   - File icon + name + size + ext + source.
   - "Verify to download" headline.
   - Cloudflare Turnstile widget (use `@marsidev/react-turnstile` or the official script).
   - Cancel button (closes modal) + `Proceed` button (disabled until Turnstile resolves).
3. On Proceed: `POST /api/download/{id}` with `{ turnstileToken }`.
4. Server validates token with Cloudflare siteverify, generates presigned URL (R2: AWS SDK v3 `getSignedUrl`; Dropbox: temporary link; Local: signed query string), returns `{ url }`.
5. Client triggers download via `<a href={url} download={file.name}>` programmatic click + closes modal.

---

## 3. Admin Panel — Storage Management

### 3.1 Layout
Sticky top bar with: back-to-home, brand, **section nav** (`Storage` · `Analytics` · `Settings`), lang/theme toggles, user menu.

Below it, single-column main with these blocks in order:
1. **Page heading** — breadcrumb (`/ admin / storage`) · H1 · description · CTAs (`Refresh` · `Sync index` · `Upload R2`).
2. **Stats strip** (4 cards, equal columns):
   - **Files count** + delta pill (`+3 this week`).
   - **Total size** + stacked bar segmented by source (R2 / Dropbox / Local).
   - **Downloads (last 30d)** + sparkline (30 daily values) + delta `+18.4%`.
   - **Published / total** + progress bar + percentage.
3. **Upload zone** (collapsible — toggled by `Upload R2` button or auto-expands on drag-over of the page).
4. **Toolbar**: search input · source segment (all/R2/Dropbox/Local) · status segment (all/published/draft).
5. **Bulk action bar** (only when ≥1 row selected): count · `Bulk publish` · `Unpublish` · `Bulk delete` (danger) · clear-selection `×`.
6. **Table card** with header row showing icon + title + total count pill.
7. **Table foot**: `{filtered}/{all} files` · total filtered size.

### 3.2 Table columns (left → right)
| Col | Width | Content |
|---|---|---|
| Checkbox | 32px | `accent-color: var(--accent)` |
| **PATH / KEY** | flex | source tag (R2/Dropbox/Local) + monospace path |
| SIZE | 80px | `fmtBytes(size)`, tabular-nums |
| MODIFIED | 90px | `fmtDate(modified, lang)`, tabular-nums |
| DL | 60px | `fmtCount(downloads, lang)` |
| PUB | 50px | ✓ green if published else `—` |
| ACTIONS | 200px | Edit (icon) · Publish/Unpublish (text toggle) · Delete (trash) — right-aligned |

Selected row: `--accent-soft` background. Hover: `--bg-hover`.

### 3.3 Upload zone
- Dashed border, expands to highlight `--accent` on `dragover`.
- Tabs at top: `R2` / `Local` / `Dropbox` — selects upload destination.
- Drop area with upload icon + "Drop files here or click to browse" + `PDF, MP4, ZIP — max 5 GB / file`.
- Active uploads list below drop area: name · progress bar · size + percentage · status (spinner while uploading, ✓ when done).
- Implementation: use `react-dropzone` for the file input. Stream multipart to `/api/files/upload` with a progress callback. R2 uploads should use **multipart upload** for files > 100 MB.

### 3.4 Bulk operations endpoints
- `POST /api/files/bulk` with `{ ids: string[], action: 'publish'|'unpublish'|'delete' }`.
- Optimistic UI: update local state first, roll back on error.

### 3.5 Sparkline
30 daily download counts. Render as inline SVG: filled area (`--accent-soft`) + line (`--accent`, 1.5px stroke, round caps). Width 120 × height 28. See `Sparkline` component in `admin-panel.jsx`.

---

## 4. Components to build

Map each prototype block to a Next.js component:

```
components/
  layout/
    TopBar.tsx              ── shared brand bar (homepage variant)
    AdminTopBar.tsx         ── admin variant with section nav
    LangToggle.tsx
    ThemeToggle.tsx
  homepage/
    SearchBar.tsx           ── input + slash-to-focus
    FilterChips.tsx         ── category filters with counts
    SortControl.tsx         ── select or button group
    FileList.tsx            ── orchestrator (filter+sort+render)
    FileRow.tsx             ── per-variant subcomponent
    DownloadModal.tsx       ── Turnstile + presigned redirect
  admin/
    StatsStrip.tsx          ── 4-card overview
    Sparkline.tsx           ── inline SVG
    UploadZone.tsx          ── dropzone + progress list
    StorageToolbar.tsx      ── search + filters
    BulkActionBar.tsx       ── shows when selection.size > 0
    StorageTable.tsx        ── table + row + cells
  shared/
    SourceBadge.tsx         ── R2 / Dropbox / Local
    FileIcon.tsx            ── ext → category icon
    Icon.tsx                ── inline SVG set (port from shared.jsx)
```

State:
- Filter/search/sort/selection: `useState` (admin selection in a `Set<string>`).
- File list: server-fetched via `app/page.tsx` server component → hydrated to client filter component.
- Theme/lang: React context provider in `layout.tsx`.

---

## 5. Backend / infra notes

- **Cloudflare Workers** (or Pages Functions) for the API routes. Bind R2 bucket + KV for download counters + Turnstile secret.
- **Download counter**: increment via `KV.put` after presigned URL issued. Batch-flush to D1 every N writes if you need durability.
- **Turnstile**: site-verify endpoint `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Reject duplicate token reuse (keep token IDs in KV with 5min TTL).
- **Dropbox**: refresh access token via app-key flow; cache for 4 hours in KV.
- **Local files**: served from `/public/dl/...` only after a signed-URL handshake (HMAC of `id+expiry+nonce` in query string, validated by middleware).
- **Index sync**: `Sync index` button triggers a job that reconciles R2 + Dropbox listings into the metadata DB (D1 or KV-as-DB). Schedule it on cron too — every 15 min.

---

## 6. Acceptance checklist

- [ ] Homepage filters + sort + search work without page reload.
- [ ] Download flow shows Turnstile and only redirects after verification.
- [ ] Admin table supports multi-select (shift-click to range-select bonus).
- [ ] Bulk actions show optimistic UI then reconcile on response.
- [ ] Upload zone: drag-drop accepts files, shows progress per file, fails gracefully on >5GB.
- [ ] Stats strip values match `/api/stats` response (no client-side computation drift).
- [ ] Theme toggle: instant, no FOUC. Persisted across reloads.
- [ ] Lang toggle: instant, all strings swap. URL `?lang=` honored.
- [ ] Mobile (≤640px): table collapses to stacked cards; bulk bar becomes a sticky bottom sheet.
- [ ] Lighthouse: ≥95 perf, ≥95 a11y. Color contrast verified in both themes.

---

## 7. Files to copy from prototype as reference

- `tokens.css` — drop in as `app/globals.css` after a Tailwind preflight import.
- `shared.jsx` — port `MOCK_FILES` to a seed file, port `fmt*` helpers to `lib/format.ts`, port `Icon` to `components/shared/Icon.tsx`, port `COPY` to `i18n/{vi,en}.ts`.
- `homepage-v1.jsx` (or your picked variant) — translate JSX + CSS to TSX + Tailwind/CSS modules.
- `admin-panel.jsx` — same.
- Component CSS in the prototype is co-located inside `<style>` tags; lift selectors verbatim or convert to Tailwind `@apply` in a CSS module.

---

## 8. Open questions for product

1. Should anonymous users see download counts, or only admins?
2. Is rate-limiting per-IP needed in addition to Turnstile? (Recommend: yes, 30 dl / hour / IP.)
3. Localized file descriptions — store one or per-language?
4. Soft-delete vs hard-delete on admin "Delete"?
5. Audit log requirement (who published/unpublished what)?
