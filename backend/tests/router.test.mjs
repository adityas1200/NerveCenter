import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT, dispatch, reply, route } from '../src/lib/router.mjs';

const run = async (routes, m, pathname) => {
  const sent = [];
  const res = { writeHead: (status) => sent.push(status), end: body => sent.push(JSON.parse(body)) };
  const handled = await dispatch(routes, { req: null, res, m, p: pathname.split('/').filter(Boolean) });
  return { handled, sent };
};

test('router: first match wins, literals before params, :params decoded and $params raw', async () => {
  const routes = [
    route('GET', '/api/things/special', () => ({ which: 'literal' })),
    route('GET', '/api/things/:id', ({ params }) => ({ id: params.id })),
    route('GET|POST', '/api/raw/$id', ({ params }) => reply(201, { id: params.id })),
  ];
  assert.deepEqual((await run(routes, 'GET', '/api/things/special')).sent[1], { which: 'literal' });
  assert.deepEqual((await run(routes, 'GET', '/api/things/a%20b')).sent[1], { id: 'a b' });
  assert.deepEqual((await run(routes, 'POST', '/api/raw/a%20b')).sent, [201, { id: 'a%20b' }]);
});

test('router: no match, wrong method or wrong depth is not handled; NEXT carries on; a trailing * takes any rest', async () => {
  const routes = [
    route('*', '/api/guarded/*', ({ m }) => (m === 'DELETE' ? reply(403, { error: 'no' }) : NEXT)),
    route('GET', '/api/guarded/item', () => ({ ok: true })),
  ];
  assert.equal((await run(routes, 'POST', '/api/guarded/item')).handled, false);
  assert.equal((await run(routes, 'GET', '/api/guarded/item/extra')).handled, false);
  assert.equal((await run(routes, 'GET', '/api/other')).handled, false);
  assert.deepEqual((await run(routes, 'GET', '/api/guarded/item')).sent[1], { ok: true });
  assert.deepEqual((await run(routes, 'DELETE', '/api/guarded')).sent, [403, { error: 'no', code: 'FORBIDDEN' }]);
  assert.deepEqual((await run(routes, 'GET', '//api//guarded/item/')).sent[1], { ok: true });
});
