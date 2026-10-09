"use client";

/**
 * Interactive 360° tour viewer (Photo Sphere Viewer, MIT), shared by the admin editor, the
 * admin "Open tour" page and the public /t/ page. The library is imported dynamically in an
 * effect, so it never runs on the server and only loads on tour pages; its CSS is bundled
 * locally (no CDN).
 *
 * Drag / swipe to look around, pinch or buttons to zoom, fullscreen, gyroscope (phones),
 * arrows on hotspots and a thumbnail strip to walk between rooms. The first room slowly
 * rotates until the visitor interacts (view mode only).
 */
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";
import clsx from "clsx";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { TourViewerRoom } from "@/lib/tours";

export type TourViewerApi = { getYaw(): number | null };
type Point = { yaw: number; pitch: number };

/* Library types, kept loose so this file doesn't depend on their exact declarations. */
type PsvViewer = {
  addEventListener(type: string, cb: (e: { data?: { yaw: number; pitch: number; rightclick?: boolean } }) => void): void;
  getPlugin(id: string): unknown;
  getPosition(): Point;
  destroy(): void;
};
type PsvTour = {
  setNodes(nodes: unknown[], startNodeId?: string): void;
  updateNode(node: { id: string } & Record<string, unknown>): void;
  setCurrentNode(id: string): Promise<boolean>;
  getCurrentNode(): { id: string } | null;
  addEventListener(type: string, cb: (e: { node: { id: string } }) => void): void;
};
type PsvMarkers = {
  addMarker(m: Record<string, unknown>): void;
  removeMarker(id: string): void;
  clearMarkers(): void;
};
type PsvAutorotate = { stop(): void };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function toNodes(rooms: TourViewerRoom[]) {
  const ids = new Set(rooms.map((r) => r.id));
  return rooms.map((r) => ({
    id: r.id,
    panorama: r.image,
    thumbnail: r.thumb,
    name: esc(r.name),
    caption: esc(r.name),
    data: { initialYaw: r.initialYaw },
    links: r.links
      .filter((l) => ids.has(l.toRoom) && l.toRoom !== r.id)
      .map((l) => ({ nodeId: l.toRoom, position: { yaw: l.yaw, pitch: l.pitch }, data: { linkId: l.id } })),
  }));
}

const PENDING_MARKER = "pending-link";

export function TourViewer({
  rooms,
  startRoomId,
  currentRoomId,
  onRoomChange,
  mode = "view",
  picking = false,
  onPick,
  pendingPoint,
  apiRef,
  className,
  showThumbnails = true,
}: {
  rooms: TourViewerRoom[];
  startRoomId: string | null;
  /** Controlled current room (editor). */
  currentRoomId?: string | null;
  onRoomChange?: (roomId: string) => void;
  mode?: "view" | "edit";
  /** Edit mode: the next click in the panorama reports its position via onPick. */
  picking?: boolean;
  onPick?: (p: Point) => void;
  pendingPoint?: Point | null;
  apiRef?: MutableRefObject<TourViewerApi | null>;
  className?: string;
  showThumbnails?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PsvViewer | null>(null);
  const tourRef = useRef<PsvTour | null>(null);
  const markersRef = useRef<PsvMarkers | null>(null);
  const roomIdsRef = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState<string | null>(startRoomId ?? rooms[0]?.id ?? null);

  // Latest callbacks/state for the library's event handlers.
  const live = useRef({ picking, onPick, onRoomChange, pendingPoint });
  live.current = { picking, onPick, onRoomChange, pendingPoint };

  /* Create the viewer once. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || rooms.length === 0) return;
    let cancelled = false;
    let viewer: PsvViewer | null = null;
    (async () => {
      try {
        const [core, markersMod, tourMod, gyroMod, autoMod] = await Promise.all([
          import("@photo-sphere-viewer/core"),
          import("@photo-sphere-viewer/markers-plugin"),
          import("@photo-sphere-viewer/virtual-tour-plugin"),
          import("@photo-sphere-viewer/gyroscope-plugin"),
          import("@photo-sphere-viewer/autorotate-plugin"),
        ]);
        if (cancelled) return;
        const start = startRoomId && rooms.some((r) => r.id === startRoomId) ? startRoomId : rooms[0].id;
        const plugins: unknown[] = [
          markersMod.MarkersPlugin,
          [
            tourMod.VirtualTourPlugin,
            {
              renderMode: "2d",
              nodes: toNodes(rooms),
              startNodeId: start,
              preload: true,
              arrowStyle: { size: { width: 64, height: 64 } },
              // Name + thumbnail only (the caption repeats the name).
              getLinkTooltip: (content: string) => content.replace(/<p>[\s\S]*<\/p>$/, ""),
              // Every room opens on its saved starting view.
              transitionOptions: (toNode: { data?: { initialYaw?: number } }) => ({
                showLoader: true,
                effect: "fade",
                speed: 900,
                rotation: false,
                rotateTo: { yaw: toNode.data?.initialYaw ?? 0, pitch: 0 },
              }),
            },
          ],
          [gyroMod.GyroscopePlugin, { touchmove: true }],
        ];
        if (mode === "view") {
          plugins.push([autoMod.AutorotatePlugin, { autostartDelay: 800, autostartOnIdle: false, autorotateSpeed: "1.2rpm", autorotatePitch: 0 }]);
        }
        viewer = new core.Viewer({
          container: el,
          plugins: plugins as never,
          navbar: ["zoom", "move", "gyroscope", "caption", "fullscreen"],
          loadingTxt: "Loading…",
          touchmoveTwoFingers: false,
          mousewheelCtrlKey: mode === "view",
          defaultZoomLvl: 30,
          lang: { twoFingers: "Use two fingers to move", ctrlZoom: "Use Ctrl + scroll to zoom" },
        }) as unknown as PsvViewer;
        viewerRef.current = viewer;
        const tour = viewer.getPlugin("virtual-tour") as PsvTour;
        tourRef.current = tour;
        markersRef.current = viewer.getPlugin("markers") as PsvMarkers;
        roomIdsRef.current = rooms.map((r) => r.id).join(",");
        let first = true;
        tour.addEventListener("node-changed", (e) => {
          setCurrent(e.node.id);
          live.current.onRoomChange?.(e.node.id);
          if (!first) (viewer?.getPlugin("autorotate") as PsvAutorotate | null)?.stop();
          first = false;
          const p = live.current.pendingPoint;
          if (p) markersRef.current?.addMarker(pendingMarker(p));
        });
        viewer.addEventListener("click", (e) => {
          if (!e.data || e.data.rightclick || !live.current.picking) return;
          live.current.onPick?.({ yaw: e.data.yaw, pitch: e.data.pitch });
        });
        if (apiRef) apiRef.current = { getYaw: () => viewerRef.current?.getPosition().yaw ?? null };
        setReady(true);
      } catch (err) {
        console.error(err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      viewerRef.current = null;
      tourRef.current = null;
      markersRef.current = null;
      if (apiRef) apiRef.current = null;
      try {
        viewer?.destroy();
      } catch {
        /* already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; updates below
  }, [rooms.length === 0]);

  /* Rooms changed (rename, links, add/remove): update without reloading the current photo. */
  useEffect(() => {
    const tour = tourRef.current;
    if (!ready || !tour || rooms.length === 0) return;
    const ids = rooms.map((r) => r.id).join(",");
    const nodes = toNodes(rooms);
    try {
      if (ids !== roomIdsRef.current) {
        roomIdsRef.current = ids;
        const keep = tour.getCurrentNode()?.id;
        tour.setNodes(nodes, keep && rooms.some((r) => r.id === keep) ? keep : (startRoomId ?? undefined));
      } else {
        for (const n of nodes) tour.updateNode({ id: n.id, name: n.name, caption: n.caption, links: n.links, data: n.data });
      }
    } catch (err) {
      console.error(err);
    }
  }, [rooms, ready, startRoomId]);

  /* Controlled room selection. */
  useEffect(() => {
    const tour = tourRef.current;
    if (!ready || !tour || !currentRoomId) return;
    // While the first room is still loading there is no current node; switching then would
    // abort that load, so wait for it (the start room is the initial selection anyway).
    const now = tour.getCurrentNode()?.id;
    if (now && now !== currentRoomId) void tour.setCurrentNode(currentRoomId).catch(() => {});
  }, [currentRoomId, ready]);

  /* Pending link point (edit mode). */
  useEffect(() => {
    const markers = markersRef.current;
    if (!ready || !markers) return;
    try {
      markers.removeMarker(PENDING_MARKER);
    } catch {
      /* not there */
    }
    if (pendingPoint) markers.addMarker(pendingMarker(pendingPoint));
  }, [pendingPoint, ready]);

  if (rooms.length === 0) return null;

  return (
    <div className={clsx("space-y-3", className)}>
      <div
        className={clsx(
          "relative overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-900/10",
          picking && "ring-4 ring-brand-500",
        )}
      >
        <div ref={containerRef} className={clsx("h-[60vh] max-h-[680px] min-h-[300px] w-full", picking && "cursor-crosshair")} />
        {picking && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
            <span className="rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
              Click the spot for the link (e.g. a door)
            </span>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-200">
            The 360° viewer couldn&apos;t start in this browser.
          </div>
        )}
      </div>
      {showThumbnails && rooms.length > 1 && (
        <nav aria-label="Rooms" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setCurrent(r.id);
                void tourRef.current?.setCurrentNode(r.id).catch(() => {});
                onRoomChange?.(r.id);
              }}
              aria-current={current === r.id ? "true" : undefined}
              className={clsx(
                "group w-32 shrink-0 overflow-hidden rounded-xl bg-white text-left ring-1 transition sm:w-36",
                current === r.id ? "ring-2 ring-brand-600" : "ring-slate-200 hover:ring-slate-300",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served by an authenticated or token-checked route */}
              <img src={r.thumb} alt="" className="aspect-[2/1] w-full object-cover" loading="lazy" />
              <span className="block truncate px-2 py-1.5 text-xs font-medium text-slate-800">{r.name}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function pendingMarker(p: Point) {
  return {
    id: PENDING_MARKER,
    position: { yaw: p.yaw, pitch: p.pitch },
    html: '<span style="display:block;width:28px;height:28px;border-radius:9999px;background:rgba(79,70,229,.85);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4)"></span>',
    size: { width: 28, height: 28 },
    anchor: "center center",
    tooltip: "New link here",
  };
}
