if (!("ReadableStream" in globalThis) || !("TransformStream" in globalThis) || !("WritableStream" in globalThis)) {
  (async () => {
    const { ReadableStream, TransformStream, WritableStream } = await import("node:stream/web");
    Object.defineProperties(globalThis, {
      "ReadableStream": {
        value: ReadableStream,
        writable: true,
        enumerable: false,
        configurable: true,
      },
      "TransformStream": {
        value: TransformStream,
        writable: true,
        enumerable: false,
        configurable: true,
      },
      "WritableStream": {
        value: WritableStream,
        writable: true,
        enumerable: false,
        configurable: true,
      },
    });
  })();
}
