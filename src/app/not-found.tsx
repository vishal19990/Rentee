import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The page you are looking for doesn&apos;t exist or was removed.</p>
        <Link href="/dashboard" className="btn btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
