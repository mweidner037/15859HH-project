import memwatch from "@airbnb/node-memwatch";

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getMemoryUsed(): Promise<number> {
  // Force the event loop to turn over fully, so that
  // all pending "stats" events are dispatched (I'm guessing
  // during the IO events queue portion of the event loop).
  // Otherwise the first "stats" event we capture may be
  // for an old memory measurement.
  //
  // Basing this on the description of the event loop here:
  // https://miro.medium.com/max/2880/1*2yXbhvpf1kj5YT-m_fXgEQ.png
  // from the article:
  // https://blog.insiderattack.net/event-loop-and-the-big-picture-nodejs-event-loop-part-1-1cb67a182810
  //
  // Two sleep(0)'s works in my tests so far, while a single
  // sleep (even for a longer period, e.g., 5 ms) does not.
  // This suggests that setTimeout calls during the execution
  // of a previous setTimeout's function are queued for
  // the next big event loop iteration, instead of being
  // placed on the current setTimeout queue, although
  // I haven't read this officially.
  // It also worked when I tried a mix of a sleep(0) and
  // a Promise using setImmediate (either order).
  await sleep(0);
  await sleep(0);
  // @ts-ignore types forgot gc
  memwatch.gc();
  return new Promise<number>((resolve) => {
    // @ts-ignore types forgot once
    memwatch.once("stats", (stats: memwatch.GcStats) => {
      resolve(stats.used_heap_size);
    });
  });
}
