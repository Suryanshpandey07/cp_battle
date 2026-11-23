/** A still picture of an arena (the real scenery, drawn small) for cards and pickers. */
import { useEffect, useRef } from "react";
import type { ArenaSkin } from "../../skins/registry";
import { drawThumb } from "../../vfx/backdrops";

export function ArenaThumb({ arena, className = "", w = 320, h = 180 }: { arena: ArenaSkin; className?: string; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    // draw at logical size: drawThumb reads the canvas size, so draw into a scaled twin
    const twin = document.createElement("canvas");
    twin.width = w;
    twin.height = h;
    drawThumb(twin, arena);
    g.imageSmoothingEnabled = true;
    g.drawImage(twin, 0, 0, w, h);
  }, [arena, w, h]);
  return <canvas ref={ref} className={`block h-full w-full object-cover ${className}`} style={{ aspectRatio: `${w} / ${h}` }} aria-hidden />;
}
