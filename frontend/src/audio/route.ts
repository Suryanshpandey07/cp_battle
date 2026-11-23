/** Which music plays where: the title theme on the front door, the lounge in menus, the arena's own track in battle. */
import { useEffect } from "react";
import { music } from "./music";

export function useMusicRoute(path: string): void {
  useEffect(() => {
    // battles and replays pick their arena's track; the Locker previews arena tracks itself
    if (path.startsWith("/battle/") || path.startsWith("/replay/")) return;
    if (path.startsWith("/result/")) {
      music.play(null); // let the victory or defeat fanfare ring out first
      const id = window.setTimeout(() => {
        music.setIntensity(0);
        music.play("menu");
      }, 3500);
      return () => window.clearTimeout(id);
    }
    const front = path === "/" || path.startsWith("/login") || path.startsWith("/signup");
    music.setIntensity(path.startsWith("/queue") ? 2 : 1);
    if (!path.startsWith("/locker")) music.play(front ? "title" : "menu");
  }, [path]);
}
