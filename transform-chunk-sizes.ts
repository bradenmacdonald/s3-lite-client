/**
 * This stream transform will buffer the data it receives until it has enough to form
 * a chunk of the specified size, then pass on the data in chunks of the specified size.
 */
export class TransformChunkSizes extends TransformStream<Uint8Array, Uint8Array> {
  constructor(private readonly outChunkSize: number) {
    // We'll keep one internal buffer of size outChunkSize,
    // plus a current "offset" telling us how many bytes are in it.
    let buffer = new Uint8Array(outChunkSize);
    let offset = 0;

    super({
      transform(chunk, controller) {
        let pos = 0;
        while (pos < chunk.length) {
          // How many bytes remain to fill the buffer?
          const needed = outChunkSize - offset;
          // How many bytes we can copy from the incoming chunk this iteration
          const toCopy = Math.min(needed, chunk.length - pos);

          // Copy from chunk into our internal buffer
          buffer.set(chunk.subarray(pos, pos + toCopy), offset);
          pos += toCopy;
          offset += toCopy;

          // If we've filled a chunk, push it to the output, then reset
          if (offset === outChunkSize) {
            controller.enqueue(buffer);
            // We must not reuse that buffer, because it's still being read by the controller.
            buffer = new Uint8Array(outChunkSize);
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
