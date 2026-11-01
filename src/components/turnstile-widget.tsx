"use client";

import { useEffect, useRef } from "react";
import { useActionResult } from "./form";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
    __renteeTurnstileLoad?: Promise<void>;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  window.__renteeTurnstileLoad ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return window.__renteeTurnstileLoad;
}

/**
 * Cloudflare Turnstile widget for a form inside <ActionForm>. It adds the hidden
 * `cf-turnstile-response` field itself, and resets after every submit result (tokens are single use).
 */
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const result = useActionResult();

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile || widget.current) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "login",
          theme: "light",
          size: "flexible",
        });
      })
      .catch(() => {
        /* the server will report the missing token */
      });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  // A token can be used once: get a fresh one after each sign-in attempt.
  useEffect(() => {
    if (result.message && widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [result]);

  return <div ref={box} className="min-h-[65px]" />;
}
