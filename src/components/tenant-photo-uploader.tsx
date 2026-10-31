"use client";

import { useRef, useState, useTransition } from "react";
import { removeTenantPhoto, uploadTenantPhoto } from "@/app/(admin)/tenants/photo-actions";
import { IconImage, IconTrash } from "./icons";
import { TenantAvatar } from "./tenant-avatar";

const SIZE = 512;

/** Centre-crops an image file to a square and resizes it to SIZE×SIZE JPEG in the browser. */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the image"))), "image/jpeg", 0.86),
  );
}

/** Tenant profile photo with Upload / Change / Remove (tenant page header). */
export function TenantPhotoUploader({ tenantId, name, photo }: { tenantId: string; name: string; photo: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    start(async () => {
      let upload: Blob = file;
      try {
        upload = await squareJpeg(file);
      } catch {
        // Very old browsers: send the original; the server still validates it.
      }
      const fd = new FormData();
      fd.set("photo", new File([upload], "photo.jpg", { type: upload.type || file.type }));
      const res = await uploadTenantPhoto(tenantId, {}, fd);
      if (!res.ok) setError(res.message ?? "Upload failed");
    });
  }

  function onRemove() {
    setError(null);
    start(async () => {
      const res = await removeTenantPhoto(tenantId);
      if (!res.ok) setError(res.message ?? "Couldn't remove the photo");
    });
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        className="group relative rounded-full focus-visible:ring-4 focus-visible:ring-brand-500/30 focus-visible:outline-none"
        aria-label={photo ? "Change profile photo" : "Upload profile photo"}
      >
        <TenantAvatar tenantId={tenantId} photo={photo} name={name} size="lg" className={pending ? "opacity-50" : ""} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-slate-900/50 text-white opacity-0 transition group-hover:opacity-100">
          <IconImage className="size-5" />
        </span>
        {pending && <span className="absolute inset-0 m-auto size-6 animate-spin rounded-full border-2 border-white border-r-transparent" aria-hidden />}
      </button>
      <div className="flex flex-col items-start gap-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={pending}>
            <IconImage className="size-3.5" /> {photo ? "Change photo" : "Upload photo"}
          </button>
          {photo && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} disabled={pending}>
              <IconTrash className="size-3.5" /> Remove
            </button>
          )}
        </div>
        {error ? <p role="alert" className="text-xs font-medium text-rose-600">{error}</p> : <p className="text-xs text-slate-500">JPEG, PNG or WebP, up to 5 MB</p>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
    </div>
  );
}
