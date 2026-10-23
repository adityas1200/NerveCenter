import { route, scoped } from '../lib/router.mjs';
import { httpError } from '../lib/util.mjs';
import { config } from '../config.mjs';

export function changeRoutes({ changeFeed }) {
  if (!changeFeed) return [];
  return scoped('project', [
    route('GET', '/api/changes/stream', ({ req, res, scope }) => {
      if (!scope || scope.all || scope.system || !scope.projectId) throw httpError(403, 'Choose one project to receive change hints.');
      const projectId = scope.projectId;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': config.corsOrigin });
      let closed = false;
      let heartbeat;
      let unsubscribe = () => {};
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
      };
      const send = (name, data) => {
        if (closed) return;
        try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); }
        catch { cleanup(); }
      };
      unsubscribe = changeFeed.subscribe(projectId, hint => send('change', hint));
      send('ready', { projectId, at: new Date().toISOString() });
      heartbeat = setInterval(() => {
        if (closed) return;
        try { res.write(': keepalive\n\n'); }
        catch { cleanup(); }
      }, 25_000);
      heartbeat.unref?.();
      req.on('aborted', cleanup);
      res.on('close', cleanup);
    }, '*'),
  ]);
}
