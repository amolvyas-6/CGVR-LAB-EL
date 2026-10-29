import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePorkchop } from '../../src/physics/porkchop.js';
import { createGridService } from '../../src/app/gridService.js';
import { handlePorkchopMessage } from '../../src/workers/porkchop.worker.js';

const GRID_CONFIG = Object.freeze({
  target: 'Mars',
  departureStartMs: Date.parse('2026-07-01T00:00:00Z'),
  departureEndMs: Date.parse('2026-07-03T00:00:00Z'),
  tofMinDays: 100,
  tofMaxDays: 104,
  departureCount: 3,
  tofCount: 3,
});

class FakeWorker {
  constructor() {
    this.postMessage = vi.fn();
    this.terminate = vi.fn(() => {
      this.terminated = true;
    });
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.terminated = false;
  }

  respond(data) {
    this.onmessage?.({ data });
  }

  fail(error) {
    this.onerror?.({ error, message: error.message, preventDefault: vi.fn() });
  }
}

function validGrid() {
  return generatePorkchop({ ...GRID_CONFIG, departureCount: 2, tofCount: 2 });
}

describe('porkchop worker protocol', () => {
  it('matches generatePorkchop and transfers each typed-array buffer exactly once', () => {
    const config = { ...GRID_CONFIG, target: 'Venus', tofMinDays: 0.01, tofMaxDays: 0.1 };
    const expected = generatePorkchop(config);
    const postMessage = vi.fn();

    handlePorkchopMessage({ id: 17, config }, postMessage);

    expect(postMessage).toHaveBeenCalledOnce();
    const [response, transfer] = postMessage.mock.calls[0];
    expect(response.id).toBe(17);
    expect(response.grid.config).toEqual(expected.config);
    expect(response.grid.departureCount).toBe(expected.departureCount);
    expect(response.grid.tofCount).toBe(expected.tofCount);
    expect(response.grid.costs).toEqual(expected.costs);
    expect(response.grid.c3).toEqual(expected.c3);
    expect(response.grid.departureEpochs).toEqual(expected.departureEpochs);
    expect(response.grid.tofDays).toEqual(expected.tofDays);
    expect(response.grid.invalidCount).toBeGreaterThan(0);
    expect([...response.grid.costs].some(Number.isNaN)).toBe(true);
    expect([...response.grid.c3].some(Number.isNaN)).toBe(true);
    expect(transfer).toHaveLength(4);
    expect(new Set(transfer).size).toBe(4);
    expect(transfer).toEqual([
      response.grid.costs.buffer,
      response.grid.c3.buffer,
      response.grid.departureEpochs.buffer,
      response.grid.tofDays.buffer,
    ]);
  });

  it('reports invalid grid configuration through the worker error envelope', () => {
    const postMessage = vi.fn();
    handlePorkchopMessage({ id: 4, config: { ...GRID_CONFIG, target: 'Earth' } }, postMessage);

    expect(postMessage).toHaveBeenCalledOnce();
    const [response, transfer] = postMessage.mock.calls[0];
    expect(response).toMatchObject({
      id: 4,
      error: { name: 'RangeError', message: 'unsupported target: Earth' },
    });
    expect(transfer).toBeUndefined();
  });
});

describe('createGridService', () => {
  let workers = [];
  afterEach(() => {
    workers.forEach((worker) => worker.terminate());
    workers = [];
  });

  function makeService(factory = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }) {
    return createGridService({ workerFactory: factory });
  }

  it('creates one worker per computation and resolves the transferred grid', async () => {
    const factory = vi.fn(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const service = makeService(factory);
    const pending = service.compute(GRID_CONFIG);
    const worker = workers[0];

    expect(factory).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, config: GRID_CONFIG });
    const grid = structuredClone(validGrid());
    expect(Object.isFrozen(grid.config)).toBe(false);
    worker.respond({ id: 1, grid });

    await expect(pending).resolves.toBe(grid);
    expect(Object.isFrozen(grid.config)).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    service.destroy();
  });

  it('aborts and terminates a superseded worker, ignoring its late reply', async () => {
    const service = makeService();
    const first = service.compute(GRID_CONFIG);
    const firstWorker = workers[0];
    const staleHandler = firstWorker.onmessage;
    const firstAssertion = expect(first).rejects.toMatchObject({ name: 'AbortError' });

    const second = service.compute({ ...GRID_CONFIG, target: 'Venus' });
    const secondWorker = workers[1];
    expect(firstWorker.terminated).toBe(true);
    staleHandler({ data: { id: 1, grid: validGrid() } });
    expect(secondWorker.terminated).toBe(false);
    secondWorker.respond({ id: 2, grid: validGrid() });

    await Promise.all([firstAssertion, expect(second).resolves.toBeDefined()]);
    expect(firstWorker.onmessage).toBeNull();
    service.destroy();
  });

  it('cancel and destroy reject pending work and detach all worker callbacks', async () => {
    const service = makeService();
    const pending = service.compute(GRID_CONFIG);
    const worker = workers[0];
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    service.cancel();
    await assertion;
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();

    const pendingOnDestroy = service.compute(GRID_CONFIG);
    const destroyWorker = workers[1];
    const destroyAssertion = expect(pendingOnDestroy).rejects.toMatchObject({ name: 'AbortError' });
    service.destroy();
    await destroyAssertion;
    expect(destroyWorker.terminated).toBe(true);
    await expect(service.compute(GRID_CONFIG)).rejects.toThrow('destroyed');
  });

  it('rejects worker errors and allows a later computation to retry', async () => {
    const service = makeService();
    const failed = service.compute(GRID_CONFIG);
    const failingWorker = workers[0];
    const failedAssertion = expect(failed).rejects.toThrow('calculation failed');
    failingWorker.respond({ id: 1, error: { name: 'RangeError', message: 'calculation failed' } });
    await failedAssertion;
    expect(failingWorker.terminated).toBe(true);

    const retry = service.compute(GRID_CONFIG);
    const retryWorker = workers[1];
    retryWorker.respond({ id: 2, grid: validGrid() });
    await expect(retry).resolves.toBeDefined();
    service.destroy();
  });

  it('cleans up on worker runtime, decode, protocol, and construction failures', async () => {
    const service = makeService();
    const runtimeFailure = service.compute(GRID_CONFIG);
    const runtimeWorker = workers[0];
    const runtimeAssertion = expect(runtimeFailure).rejects.toThrow('runtime broke');
    runtimeWorker.fail(new Error('runtime broke'));
    await runtimeAssertion;
    expect(runtimeWorker.terminated).toBe(true);

    const decodeFailure = service.compute(GRID_CONFIG);
    const decodeWorker = workers[1];
    const decodeAssertion = expect(decodeFailure).rejects.toThrow('unreadable');
    decodeWorker.onmessageerror?.({});
    await decodeAssertion;
    expect(decodeWorker.terminated).toBe(true);

    const protocolFailure = service.compute(GRID_CONFIG);
    const protocolWorker = workers[2];
    const protocolAssertion = expect(protocolFailure).rejects.toThrow('mismatched');
    protocolWorker.respond({ id: 999, grid: validGrid() });
    await protocolAssertion;
    expect(protocolWorker.terminated).toBe(true);
    service.destroy();

    let constructorAttempts = 0;
    const retryable = makeService(() => {
      constructorAttempts += 1;
      if (constructorAttempts === 1) throw new Error('constructor failed');
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    await expect(retryable.compute(GRID_CONFIG)).rejects.toThrow('constructor failed');
    const retry = retryable.compute(GRID_CONFIG);
    const retryWorker = workers.at(-1);
    retryWorker.respond({ id: 2, grid: validGrid() });
    await expect(retry).resolves.toBeDefined();
    retryable.destroy();
  });

  it('rejects malformed grids rather than resolving inconsistent buffers or axes', async () => {
    const service = makeService();
    const pending = service.compute(GRID_CONFIG);
    const worker = workers[0];
    const malformed = validGrid();
    malformed.tofDays = new Float64Array([1]);
    const assertion = expect(pending).rejects.toThrow('invalid porkchop grid');

    worker.respond({ id: 1, grid: malformed });
    await assertion;
    expect(worker.terminated).toBe(true);
    service.destroy();
  });
});
