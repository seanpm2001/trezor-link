import * as ByteBuffer from "bytebuffer";
import { MESSAGE_HEADER_BYTE } from "../../config";

/**
 * Reads meta information from buffer
 */
const readHeader = (buffer: ByteBuffer) => {
  const typeId = buffer.readUint16();
  const length = buffer.readUint32();

  return { typeId, length };
};

/**
 * Reads meta information from chunked buffer
 */
const readHeaderChunked = (buffer: ByteBuffer) => {
  const sharp1 = buffer.readByte();
  const sharp2 = buffer.readByte();
  const typeId = buffer.readUint16();
  const length = buffer.readUint32();

  return { sharp1, sharp2, typeId, length };
};

export const decode = (data: Buffer) => {
  const byteBuffer = ByteBuffer.concat([data]);

  const { typeId } = readHeader(byteBuffer);

  return {
    typeId,
    buffer: byteBuffer.toBuffer(),
  };
};

// Parses first raw input that comes from Trezor and returns some information about the whole message.
// todo: maybe also accept Buffer just like decode does. But this would require changes in lower levels
export const decodeChunked = (bytes: ArrayBuffer) => {
  // convert to ByteBuffer so it's easier to read
  const byteBuffer = ByteBuffer.wrap(bytes);

  const { sharp1, sharp2, typeId, length } = readHeaderChunked(byteBuffer);

  if (sharp1 !== MESSAGE_HEADER_BYTE || sharp2 !== MESSAGE_HEADER_BYTE) {
    throw new Error(`Didn't receive expected header signature.`);
  }

  return { length, typeId, restBuffer: byteBuffer };
};
