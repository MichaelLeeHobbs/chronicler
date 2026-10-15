import { describe, expect, it } from 'vitest';

import { ChroniclerError } from '../../src/core/errors';
import { setup } from '../helpers/fixtures';

describe('Fork System', () => {
  describe('fork id generation', () => {
    it('assigns forkId "0" to the root chronicle', () => {
      const { mock, chronicle } = setup();
      chronicle.admin.heartbeat();
      expect(mock.getLastPayload()?.forkId).toBe('0');
    });

    it('assigns sequential ids to forks from root', () => {
      const { mock, chronicle } = setup();
      const fork1 = chronicle.fork({ task: 'A' });
      const fork2 = chronicle.fork({ task: 'B' });
      fork1.admin.heartbeat();
      fork2.admin.heartbeat();
      expect(mock.getPayloads().map((p) => p.forkId)).toEqual(['1', '2']);
    });

    it('creates hierarchical ids for nested forks', () => {
      const { mock, chronicle } = setup();
      const fork1 = chronicle.fork();
      const fork11 = fork1.fork();
      const fork12 = fork1.fork();
      const fork121 = fork12.fork();
      fork1.admin.heartbeat();
      fork11.admin.heartbeat();
      fork12.admin.heartbeat();
      fork121.admin.heartbeat();
      expect(mock.getPayloads().map((p) => p.forkId)).toEqual(['1', '1.1', '1.2', '1.2.1']);
    });

    it('maintains separate fork counters per chronicle', () => {
      const a = setup();
      const b = setup();
      a.chronicle.fork();
      a.chronicle.fork().admin.heartbeat();
      b.chronicle.fork().admin.heartbeat();
      expect(a.mock.getLastPayload()?.forkId).toBe('2');
      expect(b.mock.getLastPayload()?.forkId).toBe('1');
    });

    it('handles deeply nested fork hierarchies', () => {
      const { mock, chronicle } = setup();
      let current = chronicle;
      current.admin.heartbeat();
      for (let i = 0; i < 4; i++) {
        current = current.fork({ depth: i });
        current.admin.heartbeat();
      }
      expect(mock.getPayloads().map((p) => p.forkId)).toEqual([
        '0',
        '1',
        '1.1',
        '1.1.1',
        '1.1.1.1',
      ]);
    });
  });

  describe('fork trees', () => {
    it('exposes the whole catalog, scope methods and keys on a fork', () => {
      const { mock, chronicle } = setup();
      const fork = chronicle.fork();
      const { admin } = fork;
      admin.login({ userId: 'u', success: true });
      expect(fork.admin.login.key).toBe('admin.login');
      expect(fork.http.request.key).toBe('http.request');
      expect(typeof fork.run).toBe('function');
      expect(mock.getLastPayload()?.forkId).toBe('1');
    });

    it('binds a fork to its own scope regardless of the ambient scope', () => {
      const { mock, chronicle } = setup();
      const fork = chronicle.fork();
      chronicle.http.request.run((req) => {
        fork.admin.heartbeat();
        req.complete();
      });
      expect(mock.findByKey('admin.heartbeat')).toMatchObject({ forkId: '1', correlationId: '' });
    });
  });

  describe('fork context', () => {
    it('inherits parent context', () => {
      const { mock, chronicle } = setup({ metadata: { svc: 'api' } });
      chronicle.addContext({ userId: 'u1' });
      chronicle.fork({ task: 'A' }).admin.heartbeat();
      expect(mock.getLastPayload()?.metadata).toEqual({ svc: 'api', userId: 'u1', task: 'A' });
    });

    it('does not propagate context changes upward or sideways', () => {
      const { mock, chronicle } = setup();
      const a = chronicle.fork({ branch: 'a' });
      const b = chronicle.fork({ branch: 'b' });
      a.addContext({ onlyA: true });
      chronicle.admin.heartbeat();
      b.admin.heartbeat();
      a.admin.heartbeat();
      expect(mock.getPayloads().map((p) => p.metadata)).toEqual([
        {},
        { branch: 'b' },
        { branch: 'a', onlyA: true },
      ]);
    });

    it('snapshots parent context at fork time', () => {
      const { mock, chronicle } = setup();
      const fork = chronicle.fork();
      chronicle.addContext({ later: true });
      fork.admin.heartbeat();
      expect(mock.getLastPayload()?.metadata).toEqual({});
    });

    it('lets nested forks inherit from intermediate forks', () => {
      const { mock, chronicle } = setup();
      chronicle.fork({ level1: 'a' }).fork({ level2: 'b' }).admin.heartbeat();
      expect(mock.getLastPayload()?.metadata).toEqual({ level1: 'a', level2: 'b' });
    });

    it('lets child context override inherited values', () => {
      const { mock, chronicle } = setup({ metadata: { env: 'prod', svc: 'api' } });
      const child = chronicle.fork({ env: 'canary' });
      child.fork({ svc: 'worker' }).admin.heartbeat();
      chronicle.admin.heartbeat();
      expect(mock.getPayloads().map((p) => p.metadata)).toEqual([
        { env: 'canary', svc: 'worker' },
        { env: 'prod', svc: 'api' },
      ]);
    });

    it('keeps first-write-wins for addContext within a fork', () => {
      const { mock, chronicle } = setup();
      const fork = chronicle.fork({ userId: '123' });
      const result = fork.addContext({ userId: '456' });
      fork.admin.heartbeat();
      expect(result.collisionDetails).toEqual([
        { key: 'userId', existingValue: '123', attemptedValue: '456' },
      ]);
      expect(mock.getLastPayload()?.metadata.userId).toBe('123');
    });

    it('drops reserved keys passed to fork()', () => {
      const { mock, chronicle } = setup();
      chronicle.fork({ correlationId: 'x', ok: 1 }).admin.heartbeat();
      expect(mock.getLastPayload()).toMatchObject({ correlationId: '', metadata: { ok: 1 } });
    });
  });

  describe('forks of correlations', () => {
    it('shares the correlation id and gets its own fork id', () => {
      const { mock, chronicle } = setup();
      const req = chronicle.http.request.begin();
      const fork = req.fork({ parallel: 'task1' });
      req.ping();
      fork.ping();
      fork.received({ path: '/x' });
      expect(fork.correlationId).toBe(req.correlationId);
      expect(mock.getPayloads().map((p) => [p.forkId, p.correlationId])).toEqual([
        ['0', 'c1'],
        ['0', 'c1'],
        ['1', 'c1'],
        ['1', 'c1'],
      ]);
      req.complete();
    });

    it('has the correlation events but no lifecycle methods', () => {
      const { chronicle } = setup();
      const req = chronicle.http.request.begin();
      const fork = req.fork();
      expect(fork.phase.parsed.key).toBe('http.request.phase.parsed');
      expect(fork).not.toHaveProperty('complete');
      expect(fork).not.toHaveProperty('fail');
      expect(fork).not.toHaveProperty('admin');
      req.complete();
    });

    it('inherits correlation context and adds its own', () => {
      const { mock, chronicle } = setup();
      const req = chronicle.http.request.begin({ workflowId: 'wf1' });
      req.fork({ parallelTask: 'task1' }).ping();
      expect(mock.getLastPayload()?.metadata).toEqual({ workflowId: 'wf1', parallelTask: 'task1' });
      req.complete();
    });

    it('nests forks of correlation forks', () => {
      const { mock, chronicle } = setup();
      const req = chronicle.http.request.begin();
      req.fork().fork().ping();
      req.fork().ping();
      expect(mock.findAllByKey('http.request.ping').map((p) => p.forkId)).toEqual(['1.1', '2']);
      req.complete();
    });

    it('preserves the fork id of the scope a correlation started in', () => {
      const { mock, chronicle } = setup();
      const req = chronicle.fork().fork().http.request.begin();
      req.ping();
      req.fork().ping();
      expect(mock.getPayloads().map((p) => p.forkId)).toEqual(['1.1', '1.1', '1.1.1']);
      req.complete();
    });
  });

  describe('fork depth limits', () => {
    it('throws FORK_DEPTH_EXCEEDED at the configured limit', () => {
      const { chronicle } = setup({ limits: { maxForkDepth: 2 } });
      const deepest = chronicle.fork().fork();
      expect(() => deepest.fork()).toThrow(ChroniclerError);
      try {
        deepest.fork();
      } catch (err: unknown) {
        expect((err as ChroniclerError).code).toBe('FORK_DEPTH_EXCEEDED');
        expect((err as ChroniclerError).message).toContain('maximum allowed depth of 2');
      }
    });

    it('allows forks within the default depth limit of 10', () => {
      const { mock, chronicle } = setup();
      let current = chronicle;
      for (let i = 0; i < 10; i++) current = current.fork();
      current.admin.heartbeat();
      expect(mock.getLastPayload()?.forkId).toBe('1.1.1.1.1.1.1.1.1.1');
      expect(() => current.fork()).toThrow(ChroniclerError);
    });

    it('throws from correlation forks too', () => {
      const { chronicle } = setup({ limits: { maxForkDepth: 1 } });
      const req = chronicle.http.request.begin();
      const fork = req.fork();
      expect(() => fork.fork()).toThrow(ChroniclerError);
      req.complete();
    });

    it('throws from an ambient fork() inside a correlation', () => {
      const { chronicle } = setup({ limits: { maxForkDepth: 0 } });
      chronicle.http.request.run((req) => {
        expect(() => chronicle.fork()).toThrow(ChroniclerError);
        req.complete();
      });
    });
  });
});
