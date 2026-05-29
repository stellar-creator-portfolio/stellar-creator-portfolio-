# New Features

## Rich-Text Block Editor (Issue #512)

Creators can now write fully formatted project descriptions using a TipTap-powered block editor.

**What's included:**
- Toolbar with Bold, Italic, Strikethrough, H2/H3, Bullet & Ordered lists, Blockquote, Code block
- Link insertion and YouTube/Loom video embeds
- All output is DOMPurify-sanitized before saving to the database

**Files:**
- `components/ui/rich-text.tsx` — `RichTextEditor` (editable) + `RichTextContent` (read-only renderer)
- `components/forms/project-create.tsx` — Full project creation form using the editor

---

## Suspense Boundaries & Streaming UI (Issue #513)

Pages now stream content progressively using React 18 Suspense + Next.js App Router, so users see skeleton placeholders instantly instead of blank screens.

**What's included:**
- `CreatorProfileSkeleton` and `BountiesPageSkeleton` matching the exact page layouts
- `/creators/[id]` — async Server Component with nested Suspense (profile shell streams first, projects grid streams independently)
- `/bounties` — Suspense-wrapped client page with filtering (difficulty + category) and an Apply modal backed by escrow

**Files:**
- `components/ui/skeleton-group.tsx` — Page-level skeleton components
- `app/creators/[id]/page.tsx` — Streaming creator profile page
- `app/bounties/page.tsx` + `app/bounties/BountiesClient.tsx` — Streaming bounties page with interactive filtering and apply flow
