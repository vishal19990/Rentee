"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { resetTourShareLink, setTourSharing } from "@/app/(admin)/properties/[id]/tour/actions";
import { tourShareMessage } from "@/lib/tours";
import { CopyLinkButton } from "./copy-link-button";

/** Share toggle, copy link, "Send on WhatsApp" (generic text, no recipient) and "Reset link". */
export function TourShareControls({
  propertyId,
  propertyName,
  enabled,
  url,
}: {
  propertyId: string;
  propertyName: string;
  enabled: boolean;
  url: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>) =>
    start(async () => {
      try {
        const r = await fn();
        setMsg(r.message ? { ok: !!r.ok, text: r.message } : null);
      } catch {
        setMsg({ ok: false, text: "Something went wrong. Try again." });
      }
    });

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => run(() => setTourSharing(propertyId, e.currentTarget.checked))}
          className="mt-0.5 size-4 accent-brand-600"
        />
        <span className="text-sm">
          <span className="font-medium text-slate-800">Share link</span>
          <span className="block text-xs text-slate-500">Anyone with the link can view the tour without signing in. No tenant details are shown.</span>
        </span>
      </label>
      {enabled && (
        <>
          <input readOnly value={url} aria-label="Share link" className="input text-xs" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap items-center gap-2">
            <CopyLinkButton url={url} />
            <a
              href={`https://wa.me/?text=${encodeURIComponent(tourShareMessage(propertyName, url))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100"
            >
              Send on WhatsApp
            </a>
            {confirmReset ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600">Old links stop working.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={pending}
                  onClick={() => {
                    setConfirmReset(false);
                    run(() => resetTourShareLink(propertyId));
                  }}
                >
                  Reset link
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)}>
                Reset link
              </button>
            )}
          </div>
        </>
      )}
      {msg && <p className={clsx("text-xs font-medium", msg.ok ? "text-emerald-700" : "text-rose-600")}>{msg.text}</p>}
    </div>
  );
}
