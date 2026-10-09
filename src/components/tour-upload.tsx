"use client";

import { useRef, useState, useTransition } from "react";
import {
  MAX_ROOM_NAME,
  MAX_TOUR_IMAGE_BYTES,
  NOT_360_MESSAGE,
  TOUR_IMAGE_ACCEPT,
  TOUR_THUMB_HEIGHT,
  TOUR_THUMB_WIDTH,
  downscaleTarget,
  isEquirectangular,
} from "@/lib/tours";
import type { ActionState } from "@/lib/validation";
import { FormMessage } from "./form";

type AddRoomAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

function toJpeg(img: HTMLImageElement, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality));
}

/**
 * Prepares a panorama in the browser: checks it is 2:1, downscales anything wider than 6144 px
 * to 6144×3072 JPEG (q 0.85) and makes a 512×256 JPEG thumbnail. The server re-checks everything.
 */
async function preparePanorama(file: File): Promise<{ image: Blob; name: string; thumb: Blob } | { error: string }> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { error: "This file isn't a photo this browser can open (use JPG, PNG or WebP)" };
  }
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!isEquirectangular(w, h)) return { error: NOT_360_MESSAGE };
    const target = downscaleTarget(w, h);
    let image: Blob = file;
    let name = file.name;
    if (target || file.size > MAX_TOUR_IMAGE_BYTES) {
      const t = target ?? { width: w, height: h };
      image = await toJpeg(img, t.width, t.height, 0.85);
      name = name.replace(/\.[^.]*$/, "") + ".jpg";
    }
    const thumb = await toJpeg(img, TOUR_THUMB_WIDTH, TOUR_THUMB_HEIGHT, 0.8);
    return { image, name, thumb };
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

/** "Add room": name + 360° photo. */
export function AddRoomForm({ action }: { action: AddRoomAction }) {
  const [state, setState] = useState<ActionState>({});
  const [step, setStep] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = pending || step !== null;
  const nameError = state.fieldErrors?.name?.[0];
  const imageError = state.fieldErrors?.image?.[0];

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        const name = String(fd.get("name") ?? "");
        const file = fd.get("photo");
        const errors: Record<string, string[]> = {};
        if (!name.trim()) errors.name = ["Enter a room name"];
        if (!(file instanceof File) || file.size === 0) errors.image = ["Choose a 360° photo to upload"];
        let prepared: Awaited<ReturnType<typeof preparePanorama>> | null = null;
        if (!errors.image && file instanceof File) {
          setStep("Preparing photo…");
          prepared = await preparePanorama(file);
          setStep(null);
          if ("error" in prepared) errors.image = [prepared.error];
        }
        if (Object.keys(errors).length || !prepared || "error" in prepared) {
          setState({ ok: false, message: "Please fix the highlighted fields.", fieldErrors: errors, values: { name } });
          return;
        }
        const out = new FormData();
        out.set("name", name);
        out.set("image", prepared.image, prepared.name);
        out.set("thumb", prepared.thumb, "thumb.jpg");
        setStep("Uploading…");
        startTransition(async () => {
          try {
            const res = await action({}, out);
            setState(res);
            if (res.ok) formRef.current?.reset();
          } catch {
            setState({ ok: false, message: "Upload failed. Try again." });
          } finally {
            setStep(null);
          }
        });
      }}
    >
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="room-name" className="label">
            Room name
          </label>
          <input
            id="room-name"
            name="name"
            maxLength={MAX_ROOM_NAME}
            placeholder="e.g. Living room"
            defaultValue={state.ok ? "" : state.values?.name}
            key={state.ok ? "reset" : "keep"}
            aria-invalid={nameError ? true : undefined}
            className="input"
          />
          {nameError && <p className="mt-1.5 text-xs font-medium text-rose-600">{nameError}</p>}
        </div>
        <div>
          <label htmlFor="room-photo" className="label">
            360° photo
          </label>
          <input
            id="room-photo"
            name="photo"
            type="file"
            accept={TOUR_IMAGE_ACCEPT}
            aria-invalid={imageError ? true : undefined}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
          {imageError ? (
            <p className="mt-1.5 text-xs font-medium text-rose-600">{imageError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">A panorama twice as wide as it is tall (phone &quot;360°&quot; or &quot;photo sphere&quot; mode). JPG, PNG or WebP.</p>
          )}
        </div>
      </div>
      <button type="submit" disabled={busy} className="btn btn-primary">
        {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
        {step ?? "Add room"}
      </button>
    </form>
  );
}
