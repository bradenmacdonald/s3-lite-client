import { Buffer } from "@std/streams/buffer";

/**
 * This stream transform will buffer the data it receives until it has enough to form
 * a chunk of the specified size, then pass on the data in chunks of the specified size.
 */
export class TransformChunkSizes extends TransformStream<Uint8Array, Uint8Array> {
  constructor(outChunkSize: number) {
    // This large buffer holds all the incoming data we receive until we reach at least outChunkSize, which we then pass on.
    const buffer = new Buffer();
    buffer.grow(outChunkSize);
    const bufferWriter = buffer.writable.getWriter();
    const bufferReader = buffer.readable.getReader({ mode: "byob" });

    super({
      start() {}, // required
      async transform(chunk, controller) {
        await bufferWriter.write(chunk);

        while (buffer.length >= outChunkSize) {
          const outChunk = new Uint8Array(outChunkSize);
          const readResult = await bufferReader.read(outChunk);
          if (readResult.value === undefined || readResult.value?.length !== outChunkSize) {
            throw new Error(
              `Unexpectedly read ${
                readResult.value?.length ?? 0
              } bytes from transform buffer when trying to read ${outChunkSize} bytes.`,
            );
          }
          // Now "readResult.value" holds the next chunk of data (outChunk) - pass it on to the output:
          controller.enqueue(readResult.value);
        }
      },
      flush(controller) {
        if (buffer.length) {
          // The buffer still contains some data, send it now even though it's smaller than the desired chunk size.
          controller.enqueue(buffer.bytes());
        }
      },
    });
  }
}
