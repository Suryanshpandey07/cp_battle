/** Full-screen mode for the whole app (button in the header, F key, Esc to leave). */
import { useCallback, useEffect, useState } from "react";

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenSupported(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (isFullscreen()) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else await d.webkitExitFullscreen?.();
    } else {
      const el = document.documentElement as FsEl;
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else await el.webkitRequestFullscreen?.();
    }
  } catch {
    /* the browser refused (no user gesture, or an iframe without permission) */
  }
}

/** True when a key press belongs to a text field or the code editor. */
export function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || !!el.closest?.(".monaco-editor");
}

export function useFullscreen(): { on: boolean; supported: boolean; toggle: () => void } {
  const [on, setOn] = useState(isFullscreen());
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  const toggle = useCallback(() => void toggleFullscreen(), []);
  return { on, supported: fullscreenSupported(), toggle };
}

/** F toggles full screen anywhere except while typing. Install once at the app root. */
export function useFullscreenShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
