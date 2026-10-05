/** Shown (with HTTP 404) for an invalid or tampered receipt link. No links into the admin app. */
export default function ReceiptNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Receipt not found</h1>
        <p className="mt-2 text-sm text-slate-500">This receipt link is not valid. Ask your landlord to send it again.</p>
      </div>
    </main>
  );
}
