import { assertEquals } from "./deps-tests.ts";
import { TransformChunkSizes } from "./transform-chunk-sizes.ts";

/**
 * A readable stream that generates consecutive integers.
 *
 * If "bytesPerChunk" is 1, it generates 1 byte at a time: 1, then 2, then 3, ...
 * If "bytesPerChunk" is 2, it generates 2 bytes at a time: 1, 1, then 2, 2, then 3, 3, ...
 */
class NumberSource extends ReadableStream<Uint8Array> {
  constructor(delayMs: number, chunksCount: number, bytesPerChunk = 1) {
    let intervalTimer: ReturnType<typeof setTimeout>;
    let i = 0;
    super({
      start(controller) {
        // Enqueue a byte every 100ms
        intervalTimer = setInterval(() => {
          controller.enqueue(new Uint8Array(new Array(bytesPerChunk).fill(i)));
          i++;
          if (i === chunksCount) {
            clearInterval(intervalTimer);
            controller.close();
          }
        }, delayMs);
      },
      pull(_controller) {
        // unused
      },
      cancel() {
        clearInterval(intervalTimer);
      },
    });
  }
}

/**
 * A writeable stream that stores all the data chunks it receives in an array
 */
class DataSink extends WritableStream<Uint8Array> {
  readonly outputData: Uint8Array[];
  readonly done: Promise<void>;
  constructor() {
    const outputData: Uint8Array[] = [];
    let markDone: () => void;
    let markError: () => void;
    const donePromise = new Promise<void>((resolve, reject) => {
      markDone = resolve;
      markError = reject;
    });
    super({
      // deno-lint-ignore require-await
      async write(chunk) {
        outputData.push(new Uint8Array(chunk)); // Make a copy of chunk when we save it though
      },
      close() {
        markDone();
      },
      abort(err) {
        console.error("Sink error:", err);
        markError();
      },
    });
    this.outputData = outputData;
    this.done = donePromise;
  }
}

// Shortcut for building a single-element Uint8Array
const UA = (...number: number[]) => new Uint8Array(number);

Deno.test({
  name: "Make sure our test stream classes work: Generate 4 integers (0, 1, 2, 3), 10ms apart",
  fn: async () => {
    const inputStream = new NumberSource(10, 4);
    const outputStream = new DataSink();
    inputStream.pipeTo(outputStream);
    await outputStream.done;
    assertEquals(
      outputStream.outputData,
      [UA(0), UA(1), UA(2), UA(3)],
    );
  },
});

Deno.test({
  name: "Make sure our test stream classes work: Generate 4 integer triples (0,0,0, 1,1,1, 2,2,2, 3,3,3), 0ms apart",
  fn: async () => {
    const inputStream = new NumberSource(0, 4, 3);
    const outputStream = new DataSink();
    inputStream.pipeTo(outputStream);
    await outputStream.done;
    assertEquals(
      outputStream.outputData,
      [UA(0, 0, 0), UA(1, 1, 1), UA(2, 2, 2), UA(3, 3, 3)],
    );
  },
});

Deno.test({
  name: "TransformChunkSizes - chunk 6 single bytes to 3x 2 bytes",
  fn: async () => {
    // Generate 6 integers (0, 1, 2, 3, 4, 5), 10ms apart
    const inputStream = new NumberSource(10, 6);
    const outputStream = new DataSink();
    const transformer = new TransformChunkSizes(2);
    inputStream.pipeThrough(transformer).pipeTo(outputStream);
    await outputStream.done;
    assertEquals(
      outputStream.outputData,
      [UA(0, 1), UA(2, 3), UA(4, 5)],
    );
  },
});

Deno.test({
  name: "TransformChunkSizes - chunk 15 single bytes to 4x 4 bytes",
  fn: async () => {
    const inputStream = new NumberSource(0, 15);
    const outputStream = new DataSink();
    const transformer = new TransformChunkSizes(4);
    inputStream.pipeThrough(transformer).pipeTo(outputStream);
    await outputStream.done;
    assertEquals(
      outputStream.outputData,
      [
        UA(0, 1, 2, 3),
        UA(4, 5, 6, 7),
        UA(8, 9, 10, 11),
        UA(12, 13, 14 /* last one has only three bytes */),
      ],
    );
  },
});

Deno.test({
  name: "TransformChunkSizes - chunk 4x 8 bytes to chunks of 6 bytes",
  fn: async () => {
    const inputStream = new NumberSource(0, 4, 8);
    const outputStream = new DataSink();
    const transformer = new TransformChunkSizes(6);
    inputStream.pipeThrough(transformer).pipeTo(outputStream);
    await outputStream.done;
    assertEquals(
      outputStream.outputData,
      [
        UA(0, 0, 0, 0, 0, 0),
        UA(0, 0, 1, 1, 1, 1),
        UA(1, 1, 1, 1, 2, 2),
        UA(2, 2, 2, 2, 2, 2),
        UA(3, 3, 3, 3, 3, 3),
        UA(3, 3 /* last one has only two bytes */),
      ],
    );
  },
});
