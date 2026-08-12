/**
 * This stream transform will buffer the data it receives until it has enough to form
 * a chunk of the specified size, then pass on the data in chunks of the specified size.
 */
export class TransformChunkSizes extends TransformStream<Uint8Array, Uint8Array> {
  constructor(private readonly outChunkSize: number) {
    // We'll keep one internal buffer holding the partial chunk, plus a current "offset" telling us
    // how many bytes are in it. The buffer starts out empty and grows (up to outChunkSize) as data
    // arrives, so that a stream much smaller than outChunkSize doesn't allocate the full chunk size.
    let buffer = new Uint8Array(0);
    let offset = 0;

    super({
      transform(chunk, controller) {
        let pos = 0;
        while (pos < chunk.length) {
          // How many bytes remain to fill the buffer?
          const needed = outChunkSize - offset;
          // How many bytes we can copy from the incoming chunk this iteration
          const toCopy = Math.min(needed, chunk.length - pos);

          if (buffer.length < offset + toCopy) {
            // Grow the buffer, doubling its size each time so that repeatedly appending small
            // chunks doesn't mean repeatedly copying the whole buffer.
            const bigger = new Uint8Array(
              Math.min(outChunkSize, Math.max(offset + toCopy, buffer.length * 2, 64 * 1024)),
            );
            bigger.set(buffer.subarray(0, offset));
            buffer = bigger;
          }

          // Copy from chunk into our internal buffer
          buffer.set(chunk.subarray(pos, pos + toCopy), offset);
          pos += toCopy;
          offset += toCopy;

          // If we've filled a chunk, push it to the output, then reset
          if (offset === outChunkSize) {
            controller.enqueue(buffer);
            // We must not reuse that buffer, because it's still being read by the controller.
            buffer = new Uint8Array(0);
            offset = 0;
          }
        }
      },
      flush(controller) {
        // If anything remains in the buffer at the end, enqueue it.
        if (offset > 0) {
          controller.enqueue(buffer.subarray(0, offset));
        }
      },
    });
  }
}
