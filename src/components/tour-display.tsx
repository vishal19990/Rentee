"use client";

import clsx from "clsx";
import { useState } from "react";
import { EXTERNAL_IFRAME_ALLOW, EXTERNAL_IFRAME_SANDBOX, type TourViewerRoom } from "@/lib/tours";
import { TourViewer } from "./tour-viewer";

/** Sandboxed iframe for an allowed external tour (Matterport, Kuula, YouTube, Google Maps). */
export function ExternalTourFrame({ url, title }: { url: string; title: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-900/10">
      <iframe
        src={url}
        title={title}
        className="h-[60vh] max-h-[680px] min-h-[300px] w-full"
        sandbox={EXTERNAL_IFRAME_SANDBOX}
        allow={EXTERNAL_IFRAME_ALLOW}
        allowFullScreen
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  );
}

/** The tour for viewing: 360° rooms and/or the external tour, with tabs when both exist. */
export function TourDisplay({
  rooms,
  startRoomId,
  externalUrl,
  propertyName,
}: {
  rooms: TourViewerRoom[];
  startRoomId: string | null;
  externalUrl: string;
  propertyName: string;
}) {
  const hasRooms = rooms.length > 0;
  const [tab, setTab] = useState<"rooms" | "external">(hasRooms ? "rooms" : "external");
  if (!hasRooms && !externalUrl) return null;
  return (
    <div className="space-y-4">
      {hasRooms && externalUrl && (
        <div role="tablist" aria-label="Tour type" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
          {(
            [
              ["rooms", "360° rooms"],
              ["external", "External tour"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={clsx(
                "rounded-lg px-3 py-1.5 font-medium transition",
                tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Keep the viewer mounted while the external tab is shown, so it doesn't reload. */}
      {hasRooms && (
        <div hidden={tab !== "rooms"}>
          <TourViewer rooms={rooms} startRoomId={startRoomId} />
        </div>
      )}
      {externalUrl && tab === "external" && <ExternalTourFrame url={externalUrl} title={`${propertyName} — external tour`} />}
      {hasRooms && tab === "rooms" && (
        <p className="text-xs text-slate-500">Drag to look around · use the arrows or the room pictures to move between rooms.</p>
      )}
    </div>
  );
}
