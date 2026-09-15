import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ records: [] as { _id: string }[], limitCalls: [] as number[] }));

function makePage(consumed: number, pageSize: number) {
  const pageItems = db.records.slice(consumed, consumed + pageSize);
  return {
    items: pageItems,
    hasNext: () => consumed + pageItems.length < db.records.length,
    next: async () => makePage(consumed + pageItems.length, pageSize),
  };
}

vi.mock('@wix/data', () => ({
  items: {
    query: vi.fn(() => {
      let limit = 50;
      const builder = {
        limit: (n: number) => {
          limit = n;
          db.limitCalls.push(n);
          return builder;
        },
        find: async () => makePage(0, limit),
      };
      return builder;
    }),
  },
  collections: { getDataCollection: vi.fn() },
  permissions: { getPermissions: vi.fn() },
}));

import { listRecordsPage } from '../../shared/configuration';

beforeEach(() => {
  db.records = Array.from({ length: 12 }, (_, i) => ({ _id: `r${i}` }));
  db.limitCalls = [];
});

it('resumes a follow-up page from the returned cursor instead of re-querying from the start', async () => {
  const first = await listRecordsPage<{ _id: string }>('coll', { pageSize: 5 });
  expect(first.items.map(r => r._id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  expect(first.hasNext).toBe(true);
  expect(first.nextCursor).toBeTruthy();

  const second = await listRecordsPage<{ _id: string }>('coll', { cursor: first.nextCursor, pageSize: 5 });
  expect(second.items.map(r => r._id)).toEqual(['r5', 'r6', 'r7', 'r8', 'r9']);
  expect(second.hasNext).toBe(true);
  expect(second.nextCursor).toBeTruthy();
  expect(second.nextCursor).not.toBe(first.nextCursor);

  // Only one query() call happened -- the second page came from the iterator's own
  // next(), not from re-running the query with a larger limit/offset.
  const { items } = await import('@wix/data');
  expect(vi.mocked(items.query)).toHaveBeenCalledTimes(1);
});

it('reports hasNext=false and no cursor on the final page', async () => {
  const first = await listRecordsPage<{ _id: string }>('coll', { pageSize: 5 });
  const second = await listRecordsPage<{ _id: string }>('coll', { cursor: first.nextCursor, pageSize: 5 });
  const third = await listRecordsPage<{ _id: string }>('coll', { cursor: second.nextCursor, pageSize: 5 });

  expect(third.items.map(r => r._id)).toEqual(['r10', 'r11']);
  expect(third.hasNext).toBe(false);
  expect(third.nextCursor).toBeUndefined();
});

it('caps an oversized page size instead of draining the whole collection in one call', async () => {
  const page = await listRecordsPage('coll', { pageSize: 10_000 });
  expect(db.limitCalls[0]).toBeLessThanOrEqual(100);
  expect(page.items).toHaveLength(12);
  expect(page.hasNext).toBe(false);
});

it('falls back to a fresh first page for an unrecognized or expired cursor', async () => {
  const result = await listRecordsPage<{ _id: string }>('coll', { cursor: 'stale-token-from-a-reload', pageSize: 5 });
  expect(result.items.map(r => r._id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
});

it('uses a sane default page size when none is requested', async () => {
  await listRecordsPage('coll', {});
  expect(db.limitCalls[0]).toBe(50);
});
