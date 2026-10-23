import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from './helpers.mjs';
import { FileJobStore, PostgresJobStore } from '../src/jobs/job-store.mjs';

const tmp = await tempDir('nc-jobs-');
const input = (projectId='p1', slot='2026-10-11T00:00:00Z') => ({ projectId, source:'poll', slot, dueAt:'2026-10-11T00:00:00Z', payload:{scope:'fake'} });

test('ADR-0011: file queue deduplicates project/source/slot and records skipped slots', async () => {
  const store=new FileJobStore(path.join(tmp,'dedupe')); await store.init();
  const first=await store.enqueue(input()); const duplicate=await store.enqueue(input());
  assert.equal(first.created,true); assert.equal(duplicate.created,false); assert.equal(duplicate.job.id,first.job.id);
  assert.equal((await store.latest('p1','poll')).slot,first.job.slot);
  const skipped=await store.markSkipped({...input('p1','older-slot'),slot:'older-slot'});
  assert.equal(skipped.job.state,'skipped'); assert.equal((await store.get(skipped.job.id)).history[0].state,'skipped');
});

test('ADR-0011: latest job uses slot order when due times are equal', async () => {
  const store = new FileJobStore(path.join(tmp, 'latest-slot')); await store.init();
  await store.enqueue(input('p1', '1'));
  await store.enqueue(input('p1', '2'));
  assert.equal((await store.latest('p1', 'poll')).slot, '2');
});

test('ADR-0011: file claims serialize per project, allow parallel projects, and reclaim expired leases', async () => {
  const store=new FileJobStore(path.join(tmp,'claims')); await store.init();
  const a=(await store.enqueue(input('p1','a'))).job, b=(await store.enqueue(input('p1','b'))).job, c=(await store.enqueue(input('p2','c'))).job;
  const at='2026-10-11T01:00:00.000Z';
  const [one,two]=await Promise.all([store.claim({workerId:'w1',leaseMs:1000,at}),store.claim({workerId:'w2',leaseMs:1000,at})]);
  assert.equal([one,two].filter(Boolean).length,2); assert.notEqual(one.projectId,two.projectId);
  const p1=one.projectId==='p1'?one:two;
  assert.equal((await store.claim({workerId:'w3',at})),null);
  const expired=await store.claim({workerId:'w4',leaseMs:1000,at:'2026-10-11T01:00:02.000Z'});
  assert.equal(expired.projectId,p1.projectId); assert.notEqual(expired.leaseToken,p1.leaseToken);
  assert.equal(await store.complete({id:p1.id,leaseToken:p1.leaseToken}),null);
  assert.equal((await store.complete({id:expired.id,leaseToken:expired.leaseToken})).state,'succeeded');
  assert.ok(a && b && c);
});

test('ADR-0011: retries stop at three attempts, and pruning is bounded to terminal history', async () => {
  const store=new FileJobStore(path.join(tmp,'retry')); await store.init(); const job=(await store.enqueue({...input('p3','retry'),maxAttempts:9})).job;
  let claim=await store.claim({at:'2026-10-11T02:00:00Z'});
  for(let attempt=1;attempt<=3;attempt++) {
    const failed=await store.fail({id:claim.id,leaseToken:claim.leaseToken,error:'temporary',retryDelayMs:1,at:`2026-10-11T02:00:0${attempt}Z`});
    assert.equal(failed.state,attempt<3?'retry':'failed');
    if(attempt<3)claim=await store.claim({at:`2026-10-11T02:00:0${attempt+1}Z`});
  }
  assert.equal((await store.claim({at:'2026-10-11T03:00:00Z'})),null);
  assert.equal(await store.prune({before:'2026-10-12T00:00:00Z',limit:0}),1); assert.equal(await store.get(job.id),null);
});

test('SPEC-platform-12 FR-2: a worker claims only sources for which it has a handler', async () => {
  const store = new FileJobStore(path.join(tmp, 'sources')); await store.init();
  await store.enqueue({ ...input('p1', 'old'), source: 'future-source' });
  assert.equal(await store.claim({ sources: ['github'], at: '2026-10-11T01:00:00Z' }), null);
  assert.equal((await store.claim({ sources: ['future-source'], at: '2026-10-11T01:00:00Z' })).source, 'future-source');
});

test('ADR-0011: postgres claim uses bounded atomic skip-locked selection and stale lease fencing', async () => {
  const seen=[]; const client={query:async(sql,values)=>{seen.push({sql,values});return {rows:[],rowCount:0};},release(){}};
  const pool={connect:async()=>client};
  const store=new PostgresJobStore(pool);
  await store.claim({workerId:'w',leaseMs:1e12,at:'2026-10-11T00:00:00Z'});
  const claim=seen.find(entry=>entry.sql.includes('WITH exhausted'));
  assert.match(claim.sql,/FOR UPDATE OF j SKIP LOCKED LIMIT 1/);
  assert.match(claim.sql,/lease_expires_at > \$1::timestamptz/);
  assert.equal(claim.values[3],15*60_000);
});
