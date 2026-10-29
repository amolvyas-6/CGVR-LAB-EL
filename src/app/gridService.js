function abortError(message = 'Grid computation was cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function defaultWorkerFactory() {
  return new Worker(new URL('../workers/porkchop.worker.js', import.meta.url), {
    type: 'module',
  });
}

function workerError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  const message = typeof error?.message === 'string' && error.message
    ? error.message
    : fallbackMessage;
  const result = new Error(message);
  if (typeof error?.name === 'string') result.name = error.name;
  return result;
}

function validateGrid(grid) {
  if (!grid || typeof grid !== 'object'
    || !grid.config || typeof grid.config !== 'object'
    || !Number.isInteger(grid.departureCount) || grid.departureCount < 2
    || !Number.isInteger(grid.tofCount) || grid.tofCount < 2
    || !(grid.costs instanceof Float32Array)
    || !(grid.c3 instanceof Float32Array)
    || !(grid.departureEpochs instanceof Float64Array)
    || !(grid.tofDays instanceof Float64Array)
    || grid.costs.length !== grid.departureCount * grid.tofCount
    || grid.c3.length !== grid.costs.length
    || grid.departureEpochs.length !== grid.departureCount
    || grid.tofDays.length !== grid.tofCount) {
    throw new TypeError('Worker returned an invalid porkchop grid.');
  }

  const buffers = [
    grid.costs.buffer,
    grid.c3.buffer,
    grid.departureEpochs.buffer,
    grid.tofDays.buffer,
  ];
  if (new Set(buffers).size !== buffers.length) {
    throw new TypeError('Worker grid arrays must have distinct transferable buffers.');
  }
}

/** Run each porkchop computation in its own replaceable module worker. */
export function createGridService({ workerFactory = defaultWorkerFactory } = {}) {
  if (typeof workerFactory !== 'function') {
    throw new TypeError('workerFactory must be a function');
  }

  let activeJob = null;
  let nextId = 1;
  let destroyed = false;

  function cleanup(job, terminate) {
    const worker = job.worker;
    if (!worker) return;

    if (worker.onmessage === job.onmessage) worker.onmessage = null;
    if (worker.onerror === job.onerror) worker.onerror = null;
    if (worker.onmessageerror === job.onmessageerror) worker.onmessageerror = null;
    if (terminate) {
      try {
        worker.terminate();
      } catch {
        // Worker teardown is best-effort; promise state is still settled below.
      }
    }
    job.worker = null;
  }

  function settle(job, { error, grid } = {}) {
    if (job.settled) return;
    job.settled = true;
    if (activeJob === job) activeJob = null;
    cleanup(job, true);
    if (error) job.reject(error);
    else job.resolve(grid);
  }

  function cancelActive(message) {
    if (!activeJob) return;
    settle(activeJob, { error: abortError(message) });
  }

  function compute(config) {
    if (destroyed) return Promise.reject(new Error('Grid service has been destroyed.'));
    cancelActive('Grid computation was superseded by a newer request.');

    return new Promise((resolve, reject) => {
      const job = {
        id: nextId,
        worker: null,
        resolve,
        reject,
        settled: false,
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      };
      nextId += 1;
      activeJob = job;

      try {
        job.worker = workerFactory();
        if (!job.worker || typeof job.worker.postMessage !== 'function'
          || typeof job.worker.terminate !== 'function') {
          throw new TypeError('workerFactory must return a Worker-like object.');
        }

        job.onmessage = (event) => {
          if (activeJob !== job || job.settled) return;
          const message = event?.data;
          if (!message || message.id !== job.id) {
            settle(job, { error: new Error('Worker returned a mismatched grid response id.') });
            return;
          }
          if (message.error) {
            settle(job, { error: workerError(message.error, 'Grid worker computation failed.') });
            return;
          }
          try {
            validateGrid(message.grid);
            // Structured cloning preserves values and typed arrays, not the
            // immutable configuration metadata returned by generatePorkchop.
            Object.freeze(message.grid.config);
          } catch (error) {
            settle(job, { error });
            return;
          }
          settle(job, { grid: message.grid });
        };
        job.onerror = (event) => {
          if (activeJob !== job || job.settled) return;
          event?.preventDefault?.();
          settle(job, {
            error: workerError(event?.error, event?.message || 'Grid worker encountered an error.'),
          });
        };
        job.onmessageerror = () => {
          if (activeJob !== job || job.settled) return;
          settle(job, { error: new Error('Grid worker sent an unreadable response.') });
        };

        job.worker.onmessage = job.onmessage;
        job.worker.onerror = job.onerror;
        job.worker.onmessageerror = job.onmessageerror;
        job.worker.postMessage({ id: job.id, config });
      } catch (error) {
        settle(job, { error: workerError(error, 'Could not start the grid worker.') });
      }
    });
  }

  return {
    compute,
    cancel() {
      cancelActive();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelActive('Grid service was destroyed.');
    },
  };
}
