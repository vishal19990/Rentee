---
title: 'Rentee — 360° virtual tour per property'
type: 'feature'
created: '2026-10-09'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The landlord wants prospective tenants (and themselves) to explore a house remotely — a "3D tour" — instead of arranging a visit for every enquiry.

**Approach:** Add a 360° virtual tour to each property in the existing Next.js 15 + Tailwind v4 + Mongoose app: rooms are equirectangular 360° photos stored in GridFS, shown in an interactive panorama viewer with clickable hotspots to move between rooms, plus an optional external tour embed, and a public signed share link for enquirers. Human delegated all design decisions.

**Decisions:**
- **Viewer:** `@photo-sphere-viewer/core` + `@photo-sphere-viewer/virtual-tour-plugin` + `markers-plugin` (+ `gyroscope-plugin` for phones), MIT, loaded only on tour pages (client component, dynamic import, no SSR). Controls: drag/swipe to look, zoom, fullscreen, gyroscope toggle on mobile, autorotate on the first room until interaction. Its CSS imported locally (no CDN).
- **Model** `TourRoom` {property, name (required, ≤40), order (int), image (GridFS file id, bucket `tours`), thumbnail (GridFS id, small JPEG), width, height, initialYaw (radians, default 0), links: [{toRoom, yaw, pitch}] , timestamps}. Property gets `tour` {enabled (share link on/off), shareVersion (int, bump to revoke old links), externalUrl (optional), startRoom (optional ref)}.
- **Upload:** admin "Add room" with name + file (JPEG/PNG/WEBP). In the browser, the image is decoded and, if wider than 6144px, downscaled to 6144×3072 and re-encoded JPEG q≈0.85; a 512×256 thumbnail is also produced client-side. Server validates magic bytes, size ≤ 12 MB (image) / 300 KB (thumb), and aspect ratio 2:1 ± 3% (equirectangular); non-2:1 → field error "This isn't a 360° photo (it must be twice as wide as it is tall)". Raise server-action/middleware body limits only if needed (currently 16 MB).
- **Editing (admin only), on `/properties/[id]/tour`:** list of rooms (rename, reorder up/down, delete, set as start room); viewer in edit mode: "Set starting view" stores current yaw as initialYaw; "Add link" → click a point in the panorama → choose target room → saves a hotspot {toRoom, yaw, pitch}; existing hotspots shown as arrow markers with a remove action. Optionally "Add return link" automatically creates the reverse link in the target room (at yaw + π if unknown). Deleting a room deletes its GridFS files and any links pointing to it.
- **External tour:** optional URL field; allowed hosts only: `my.matterport.com`, `kuula.co`, `www.youtube.com`/`youtu.be` (converted to embed URL), `www.google.com/maps/embed`. Rendered in a sandboxed iframe (`allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"`). If both exist, tabs "360° rooms" / "External tour".
- **Admin viewing:** property detail page gets a "Virtual tour" card: cover thumbnail, room count, "Open tour", "Edit tour", share toggle, copy link, "Send on WhatsApp" (generic prefilled text). Images served via authenticated route `/api/tours/[roomId]/(image|thumb)`.
- **Public share:** `/t/<token>` (HMAC-signed via existing `src/lib/signed-links.ts`, payload {property id, shareVersion}, no expiry) — page renders only when property.tour.enabled and shareVersion matches; shows property name, city, bedrooms/bathrooms, current monthly rent, "Available" if vacant, room tour + external tour; noindex, no-referrer; no tenant data, no address line beyond city. Public image routes `/t/<token>/img/[roomId]` and `/thumb/[roomId]` check the token. "Disable sharing" or "Reset link" (bumps shareVersion) invalidates old links → 404. Middleware: add `/t/` to the public exclusions.
- **Enquiries integration:** on `/enquiries/[id]`, when the enquiry's property (or any property chosen) has an enabled tour, a "Send tour on WhatsApp" button (wa.me with text "Hi {name}, here's a 360° tour of {property}: {link}") that logs a `whatsapp` activity.
- **Landing page:** add one feature card "360° virtual tours" (keep grid even: 12 → replace nothing, grid may become 13 → also adjust the "12 modules" stat to the new count).

**Always:** all admin routes/actions `requireUser`; zod validation with field errors; responsive at 400px; viewer usable by touch; GridFS cleanup on room/property delete; never expose tenant data on `/t/`.

**Never:** no paid/hosted tour service, no CDN script tags, no server-side image processing dependency (no sharp), no reset/seed of the user's database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add room | 8000×4000 JPEG, name "Living room" | stored as 6144×3072 JPEG + thumbnail; room listed | missing name → field error |
| Not 360° | 4000×3000 photo | not saved | "This isn't a 360° photo (it must be twice as wide as it is tall)" |
| Fake image | .exe renamed .jpg | not saved | field error |
| Link rooms | click point in Living room → Bedroom 1 | hotspot saved with yaw/pitch; clicking it in viewer opens Bedroom 1 | target = same room → refused |
| Delete room | room with incoming links | room + files deleted, incoming links removed | N/A |
| Share link | sharing enabled | `/t/<token>` renders tour without login | N/A |
| Revoked link | sharing disabled, or link reset | old `/t/<token>` → 404 | N/A |
| Tampered token | altered token | 404 | N/A |
| External URL | `https://youtu.be/abc123` | stored/embedded as `https://www.youtube.com/embed/abc123` | non-allowed host → field error |
| Public privacy | property with active tenant | `/t/` shows no tenant name/phone, only "Occupied"/"Available" | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/photo-store.ts`, `src/lib/file-store.ts` -- GridFS patterns to reuse (new bucket `tours`).
- `src/lib/documents.ts` / `src/lib/uploads.ts` -- magic-byte checks to reuse.
- `src/lib/signed-links.ts`, `src/lib/share-links.ts`, `src/app/r/[token]` -- signed public link pattern (copy for `/t/`).
- `src/middleware.ts` -- public path exclusions (`/r/`, `/p/`; add `/t/`).
- `src/models/Property.ts` -- add `tour` subdocument; `src/models/TourRoom.ts` new.
- `src/app/(admin)/properties/[id]/page.tsx` -- one-component insertion (new `src/components/tour-card.tsx`).
- `src/app/(admin)/properties/actions.ts` -- property delete must also delete tour rooms/files.
- `src/app/(admin)/enquiries/[id]/` -- add tour WhatsApp button (small insertion).
- `src/app/page.tsx` -- landing feature card + stat.
- `next.config.ts` -- body size limits if needed.

## Tasks & Acceptance

**Execution:**
- [ ] deps (`@photo-sphere-viewer/*`), model, GridFS tour store, pure helpers (aspect check, external URL normalizer, link validation) + tests for every matrix row
- [ ] admin tour editor page + actions (rooms CRUD, reorder, start room, initial view, hotspots, external URL, share toggle/reset)
- [ ] viewer component (client, dynamic) shared by admin and public pages
- [ ] public `/t/[token]` page + image routes + middleware exclusion
- [ ] property tour card, enquiry WhatsApp tour button, landing card, README

**Acceptance Criteria:**
- Given a property with 3 linked rooms, when a logged-out visitor opens its share link on a phone, then they can look around by dragging and by moving the phone, and walk between rooms via arrows and thumbnails.
- Given an existing database, when the app loads, then existing properties show an empty "Virtual tour" card with "Create tour".

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)

**Manual checks:**
- Generate a synthetic 2:1 equirectangular test image (e.g. canvas/gradient grid) to exercise upload and viewer in a headless browser screenshot.
