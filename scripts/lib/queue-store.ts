/**
 * scripts/lib/queue-store.ts
 *
 * Shared queue persistence for the Brief pipeline.
 *
 * On Vercel serverless every cron stage runs in its own function invocation
 * with an isolated, read-only filesystem, so the stages cannot hand state to
 * each other through disk: the 3 AM ingest writes a file, the 5:30 AM AI stage
 * boots on an empty filesystem, the chain breaks. This module routes every
 * queue read and write through Vercel KV (managed Redis) in production and
 * falls back to the local filesystem for offline dev (npm run brief:* without
 * KV env vars set).
 *
 * Callers:
 *   brief-ingest.ts          write 'ingested'
 *   brief-ai.ts              read 'ingested', write 'audited'
 *   brief-publish.ts         read 'audited' + 'decisions', write 'published'
 *   api/brief/candidates.ts  read 'audited' for the dashboard
 *
 * KV keys: brief:queue:<date>:<kind>  (e.g. brief:queue:2026-07-09:ingested)
 * TTL: 30 days on every write so stale editions auto-expire.
 *
 * Env (auto-wired by Vercel when a KV store is attached): KV_REST_API_URL,
 * KV_REST_API_TOKEN. @vercel/kv's default client speaks the REST protocol, so
 * those two are the real switch. KV_URL (redis:// string) is also present in
 * production but is not what this client consumes.
 */

import { writeFile, readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ============ TYPES ============

/** The four queue payloads the pipeline hands between stages. */
export type QueueKind = 'ingested' | 'audited' | 'decisions' | 'published';

/** Optional per-call override of the local-dev queue directory. Ignored in KV mode. */
interface StoreOpts {
  baseDir?: string;
}

// ============ CONFIG ============

/** Seconds in 30 days. Applied as the KV TTL so old queues auto-expire. */
const TTL_SECONDS = 60 * 60 * 24 * 30;

// ============ MODE DETECTION ============

/** True when Vercel KV is wired. The default @vercel/kv client needs the REST
 *  vars to connect, so KV_URL alone (redis protocol) is not sufficient. */
export function kvEnabled(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** Lazy import so the filesystem path never loads the KV package. Mirrors how
 *  brief-ai.ts lazy-imports the Anthropic SDK. */
async function getKv() {
  const { kv } = await import('@vercel/kv');
  return kv;
}

// ============ KEY / PATH HELPERS ============

function kvKey(date: string, kind: QueueKind): string {
  return `brief:queue:${date}:${kind}`;
}

function fsPath(date: string, kind: QueueKind, opts?: StoreOpts): string {
  const dir = opts?.baseDir ?? path.join(process.cwd(), 'scripts', 'queue');
  return path.join(dir, `${date}-${kind}.json`);
}

// ============ PUBLIC API ============

/** Write a queue payload. Vercel KV in production, filesystem for local dev. */
export async function putQueue(date: string, kind: QueueKind, data: unknown, opts?: StoreOpts): Promise<void> {
  if (kvEnabled()) {
    const kv = await getKv();
    await kv.set(kvKey(date, kind), data, { ex: TTL_SECONDS });
    return;
  }
  const target = fsPath(date, kind, opts);
  const dir = path.dirname(target);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(target, JSON.stringify(data, null, 2), 'utf-8');
}

/** Read a queue payload. Returns null when nothing is stored for that key. */
export async function getQueue<T = unknown>(date: string, kind: QueueKind, opts?: StoreOpts): Promise<T | null> {
  if (kvEnabled()) {
    const kv = await getKv();
    const value = await kv.get<T>(kvKey(date, kind));
    return value ?? null;
  }
  const target = fsPath(date, kind, opts);
  if (!existsSync(target)) return null;
  const raw = await readFile(target, 'utf-8');
  return JSON.parse(raw) as T;
}

/** List every date that has a queue of the given kind, newest first. */
export async function listQueueDates(kind: QueueKind, opts?: StoreOpts): Promise<string[]> {
  if (kvEnabled()) {
    const kv = await getKv();
    const keys = await kv.keys(`brief:queue:*:${kind}`);
    const dates = keys.map((k) => k.split(':')[2]).filter(Boolean);
    return Array.from(new Set(dates)).sort().reverse();
  }
  const dir = opts?.baseDir ?? path.join(process.cwd(), 'scripts', 'queue');
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const suffix = `-${kind}.json`;
  const dates = files.filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length));
  return Array.from(new Set(dates)).sort().reverse();
}

/** Delete a stored queue. Used by tests and manual cleanup. */
export async function deleteQueue(date: string, kind: QueueKind, opts?: StoreOpts): Promise<void> {
  if (kvEnabled()) {
    const kv = await getKv();
    await kv.del(kvKey(date, kind));
    return;
  }
  const target = fsPath(date, kind, opts);
  if (existsSync(target)) await unlink(target);
}
