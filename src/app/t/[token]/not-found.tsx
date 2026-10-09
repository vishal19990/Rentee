/** Shown (with HTTP 404) for an invalid, tampered, reset or disabled tour link. No links into the admin app. */
export default function TourNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Tour not available</h1>
        <p className="mt-2 text-sm text-slate-500">This tour link is not valid any more. Ask the landlord for a new link.</p>
      </div>
    </main>
  );
}
