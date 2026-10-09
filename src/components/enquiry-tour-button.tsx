"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { logEnquiryWhatsApp } from "@/app/(admin)/enquiries/actions";
import { enquiryTourMessage } from "@/lib/tours";
import { NO_PHONE_TOOLTIP, whatsappUrl } from "@/lib/whatsapp";

export type TourOption = { propertyId: string; name: string; url: string };

/**
 * "Send tour on WhatsApp" on an enquiry: wa.me with "Hi {name}, here's a 360° tour of
 * {property}: {link}", logged as a `whatsapp` activity. Offers the enquiry's property first and
 * any other property with a shared tour.
 */
export function EnquiryTourButton({
  enquiryId,
  enquiryName,
  phoneDigits,
  options,
}: {
  enquiryId: string;
  enquiryName: string;
  phoneDigits: string | null;
  options: TourOption[];
}) {
  const [selected, setSelected] = useState(options[0]?.propertyId ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const option = options.find((o) => o.propertyId === selected) ?? options[0];
  if (!option) return null;
  const message = enquiryTourMessage(enquiryName, option.name, option.url);
  const classes = clsx(
    "btn btn-sm",
    "border border-emerald-600/20 bg-emerald-50 text-emerald-800 shadow-xs hover:bg-emerald-100 focus-visible:ring-emerald-500/30",
  );

  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      {options.length > 1 && (
        <div>
          <label htmlFor={`tour-${enquiryId}`} className="label">
            Tour to send
          </label>
          <select id={`tour-${enquiryId}`} value={selected} onChange={(e) => setSelected(e.currentTarget.value)} className="input pr-8">
            {options.map((o) => (
              <option key={o.propertyId} value={o.propertyId}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {phoneDigits ? (
          <a
            href={whatsappUrl(phoneDigits, message)}
            target="_blank"
            rel="noopener noreferrer"
            className={classes}
            aria-busy={pending || undefined}
            onClick={() =>
              start(async () => {
                try {
                  const res = await logEnquiryWhatsApp(enquiryId, message);
                  setStatus({ ok: res.ok, text: res.ok ? "Logged in the timeline." : (res.message ?? "Could not log.") });
                } catch {
                  setStatus({ ok: false, text: "Could not log." });
                }
              })
            }
          >
            Send tour on WhatsApp
          </a>
        ) : (
          <span title={NO_PHONE_TOOLTIP} className="inline-flex">
            <button type="button" disabled className={classes}>
              Send tour on WhatsApp
            </button>
          </span>
        )}
        {status && <span className={clsx("text-xs", status.ok ? "text-slate-500" : "font-medium text-rose-600")}>{status.text}</span>}
      </div>
    </div>
  );
}
