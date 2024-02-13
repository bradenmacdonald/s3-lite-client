
/**
 * This stream transform will buffer the data it receives until it has enough to form
 * a chunk of the specified size, then pass on the data in chunks of the specified size.
 */
export class TransformChunkSizes extends TransformStream<Uint8Array, Uint8Array> {
  constructor(outChunkSize: number) {
    const buffer = new Uint8Array(outChunkSize * 2); // Buffer size is twice the chunk size to ensure there's enough space
    let offset = 0; // Offset to keep track of the current position in the buffer

    super({
      start(_controller) {
        // No initialization needed here since we've already initialized buffer and offset in the constructor.
      },
      transform(chunk, controller) {
        let chunkOffset = 0;

        // If the incoming chunk won't fit in the remaining buffer space, we need to process what's in the buffer first
        while (offset + chunk.length - chunkOffset > outChunkSize) {
          // Calculate how much of the incoming chunk we can fit into the buffer
          const spaceLeft = outChunkSize - offset;
          buffer.set(chunk.subarray(chunkOffset, chunkOffset + spaceLeft), offset);
          controller.enqueue(buffer.subarray(0, outChunkSize));
          offset = 0;
          chunkOffset += spaceLeft;
        }

        // Put the remaining chunk into the buffer
        buffer.set(chunk.subarray(chunkOffset), offset);
        offset += chunk.length - chunkOffset;
      },
      flush(controller) {
        if (offset > 0) {
          // Send any remaining data in the buffer
          controller.enqueue(buffer.subarray(0, offset));
          offset = 0;
        }
      },
    });
  }
}
