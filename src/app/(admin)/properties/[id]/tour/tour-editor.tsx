"use client";

import clsx from "clsx";
import { useRef, useState, useTransition } from "react";
import type { TourViewerRoom } from "@/lib/tours";
import type { ActionState } from "@/lib/validation";
import { ActionForm, ConfirmAction, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui";
import { TourViewer, type TourViewerApi } from "@/components/tour-viewer";
import {
  addTourLink,
  deleteTourRoom,
  moveTourRoom,
  removeTourLink,
  renameTourRoom,
  setRoomInitialYaw,
  setTourStartRoom,
} from "./actions";

type Point = { yaw: number; pitch: number };

function useRun() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      try {
        setResult(await fn());
      } catch {
        setResult({ ok: false, message: "Something went wrong. Try again." });
      }
    });
  return { pending, result, run, clear: () => setResult(null) };
}

const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`;

/** Admin tour editor: viewer in edit mode + room list (rename, reorder, delete, start room). */
export function TourEditor({ propertyId, rooms, startRoomId }: { propertyId: string; rooms: TourViewerRoom[]; startRoomId: string | null }) {
  const [currentId, setCurrentId] = useState<string | null>(startRoomId ?? rooms[0]?.id ?? null);
  const current = rooms.find((r) => r.id === currentId) ?? rooms[0] ?? null;
  const [picking, setPicking] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const apiRef = useRef<TourViewerApi | null>(null);
  const view = useRun();

  if (!current) return null;
  const others = rooms.filter((r) => r.id !== current.id);
  const nameOf = (id: string) => rooms.find((r) => r.id === id)?.name ?? "(deleted room)";

  function cancelLink() {
    setPicking(false);
    setPoint(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <TourViewer
          rooms={rooms}
          startRoomId={startRoomId}
          currentRoomId={current.id}
          onRoomChange={(id) => {
            setCurrentId(id);
            cancelLink();
            view.clear();
          }}
          mode="edit"
          picking={picking}
          onPick={(p) => {
            setPoint(p);
            setPicking(false);
          }}
          pendingPoint={point}
          apiRef={apiRef}
        />

        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
              {current.name}
              {current.sample && <Badge tone="violet">Sample</Badge>}
              {current.id === startRoomId && <Badge tone="brand">Start room</Badge>}
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={view.pending}
                onClick={() => {
                  const yaw = apiRef.current?.getYaw();
                  if (yaw == null) return;
                  view.run(() => setRoomInitialYaw(propertyId, current.id, yaw));
                }}
              >
                Set starting view
              </button>
              {others.length > 0 && !picking && !point && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicking(true)}>
                  Add link
                </button>
              )}
              {(picking || point) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelLink}>
                  Cancel link
                </button>
              )}
            </div>
          </div>
          {current.sample && <p className="mt-2 text-xs text-slate-500">Demo photo. Replace it with your own 360° photo: add a room and delete this one.</p>}
          {view.result?.message && (
            <p className={clsx("mt-2 text-xs font-medium", view.result.ok ? "text-emerald-700" : "text-rose-600")}>{view.result.message}</p>
          )}
          {others.length === 0 && <p className="mt-2 text-sm text-slate-500">Add another room to link rooms together.</p>}

          {point && (
            <div className="mt-4 rounded-xl bg-brand-50/60 p-4 ring-1 ring-brand-100">
              <ActionForm
                key={`${current.id}-${point.yaw}-${point.pitch}`}
                action={async (prev, fd) => {
                  const res = await addTourLink(propertyId, current.id, prev, fd);
                  if (res.ok) cancelLink();
                  return res;
                }}
                className="space-y-3"
              >
                <input type="hidden" name="yaw" value={String(point.yaw)} />
                <input type="hidden" name="pitch" value={String(point.pitch)} />
                <LinkTargetSelect rooms={others} />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="returnLink" defaultChecked className="size-4 accent-brand-600" />
                  Also add a link back to {current.name}
                </label>
                <SubmitButton size="sm">Save link</SubmitButton>
              </ActionForm>
            </div>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Links from this room</h3>
            {current.links.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No links yet. Use “Add link” and click a door in the panorama.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {current.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-sm text-slate-800">
                      → {nameOf(l.toRoom)} <span className="text-xs text-slate-400">at {deg(l.yaw)}</span>
                    </span>
                    <ConfirmAction
                      action={() => removeTourLink(propertyId, current.id, l.id)}
                      label="Remove"
                      prompt="Remove link?"
                      confirmLabel="Remove"
                      variant="ghost"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="card min-w-0 self-start">
        <header className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Rooms</h2>
          <p className="mt-0.5 text-sm text-slate-500">The tour shows them in this order.</p>
        </header>
        <ul className="divide-y divide-slate-100">
          {rooms.map((r, i) => (
            <RoomRow
              key={r.id}
              propertyId={propertyId}
              room={r}
              first={i === 0}
              last={i === rooms.length - 1}
              isStart={r.id === startRoomId}
              selected={r.id === current.id}
              onSelect={() => {
                setCurrentId(r.id);
                cancelLink();
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function LinkTargetSelect({ rooms }: { rooms: TourViewerRoom[] }) {
  return (
    <div>
      <label htmlFor="link-target" className="label">
        This spot opens
      </label>
      <select id="link-target" name="toRoom" className="input pr-8" defaultValue={rooms[0]?.id}>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function RoomRow({
  propertyId,
  room,
  first,
  last,
  isStart,
  selected,
  onSelect,
}: {
  propertyId: string;
  room: TourViewerRoom;
  first: boolean;
  last: boolean;
  isStart: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const move = useRun();
  return (
    <li className={clsx("px-4 py-3", selected && "bg-brand-50/50")}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onSelect} className="shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200" aria-label={`Show ${room.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route */}
          <img src={room.thumb} alt="" className="h-10 w-20 object-cover" />
        </button>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-slate-900">{room.name}</span>
          <span className="mt-0.5 flex flex-wrap gap-1">
            {isStart && <Badge tone="brand">Start</Badge>}
            {room.sample && <Badge tone="violet">Sample</Badge>}
            <span className="text-xs text-slate-500">
              {room.links.length} link{room.links.length === 1 ? "" : "s"}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm px-2"
            disabled={first || move.pending}
            aria-label={`Move ${room.name} up`}
            onClick={() => move.run(() => moveTourRoom(propertyId, room.id, -1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm px-2"
            disabled={last || move.pending}
            aria-label={`Move ${room.name} down`}
            onClick={() => move.run(() => moveTourRoom(propertyId, room.id, 1))}
          >
            ↓
          </button>
        </div>
      </div>
      {room.sample && <p className="mt-1.5 text-xs text-slate-500">Replace with your own photo.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming((v) => !v)}>
          {renaming ? "Cancel" : "Rename"}
        </button>
        {!isStart && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={move.pending} onClick={() => move.run(() => setTourStartRoom(propertyId, room.id))}>
            Set as start
          </button>
        )}
        <ConfirmAction
          action={() => deleteTourRoom(propertyId, room.id)}
          label="Delete"
          prompt="Delete room and its links?"
          confirmLabel="Delete"
          variant="danger"
        />
      </div>
      {move.result?.message && !move.result.ok && <p className="mt-1 text-xs font-medium text-rose-600">{move.result.message}</p>}
      {renaming && (
        <ActionForm
          action={async (prev, fd) => {
            const res = await renameTourRoom(propertyId, room.id, prev, fd);
            if (res.ok) setRenaming(false);
            return res;
          }}
          className="mt-2 flex items-end gap-2"
          showMessage={false}
        >
          <TextField name="name" label="New name" defaultValue={room.name} className="flex-1" />
          <SubmitButton size="sm">Save</SubmitButton>
        </ActionForm>
      )}
    </li>
  );
}
