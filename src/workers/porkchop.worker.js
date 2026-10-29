import { generatePorkchop } from '../physics/porkchop.js';

/** Pure message handler so the worker protocol can be tested outside a Worker. */
export function handlePorkchopMessage(message, postMessage) {
  if (typeof postMessage !== 'function') {
    throw new TypeError('postMessage must be a function');
  }

  const id = message?.id;
  try {
    const grid = generatePorkchop(message?.config);
    postMessage({ id, grid }, [
      grid.costs.buffer,
      grid.c3.buffer,
      grid.departureEpochs.buffer,
      grid.tofDays.buffer,
    ]);
  } catch (error) {
    postMessage({
      id,
      error: {
        name: typeof error?.name === 'string' ? error.name : 'Error',
        message: typeof error?.message === 'string' ? error.message : String(error),
      },
    });
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event) => {
    handlePorkchopMessage(event.data, (message, transfer) => {
      self.postMessage(message, transfer);
    });
  });
}
