// Entry point: node src/index.js (npm start).

import { start } from './app.js';
import { log } from './log.js';

const running = await start().catch((e) => {
  log.error('start-up failed', { error: String(e && e.stack ? e.stack : e) });
  process.exit(1);
});

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal: sig });
    await running.stop().catch(() => {});
    process.exit(0);
  });
}
