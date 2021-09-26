/* @flow */

// Logic of sending data to trezor
//
// Logic of "call" is broken to two parts - sending and recieving

import * as ProtoBuf from "protobufjs-old-fixed-webpack";
import {ByteBuffer} from "protobufjs-old-fixed-webpack";
import type {Messages} from "./protobuf/messages.js";

const HEADER_SIZE = 1 + 1 + 4 + 2;
const MESSAGE_HEADER_BYTE: number = 0x23;
const BUFFER_SIZE: number = 63;

// Sends more buffers to device.
async function sendBuffers(
  sender: (data: ArrayBuffer) => Promise<void>,
  buffers: Array<ArrayBuffer>
): Promise<void> {
  // eslint-disable-next-line prefer-const
  for (let buffer of buffers) {
    await sender(buffer);
  }
}

// already built PB message
class BuiltMessage {
  message: ProtoBuf.Builder.Message;
  type: number;

  constructor(messages: Messages, // Builders, generated by reading config
    name: string, // Name of the message
    data: Object // data as "pure" object, from trezor.js
  ) {
    const Builder = messages.messagesByName[name];
    if (Builder == null) {
      throw new Error(`The message name ${name} is not found.`);
    }

    // cleans up stuff from angular and remove "null" that crashes in builder
    cleanupInput(data);

    if (data) {
      this.message = new Builder(data);
    } else {
      this.message = new Builder();
    }

    // protobuf lib doesn't know how to work with "(wire_type)" option.
    // NOTE: round brackets are valid protobuf syntax for custom user declared option
    // messages: `TxAckInput`, `TxAckOutput`, `TxAckPrevInput`, `TxAckPrevOutput`, `TxAckPrevMeta`, `TxAckPrevExtraData`
    if (typeof this.message.$type.options[`(wire_type)`] === `number`) {
      this.type = this.message.$type.options[`(wire_type)`];
    } else {
      this.type = messages.messageTypes[`MessageType_${name}`];
    }
  }

  // encodes into "raw" data, but it can be too long and needs to be split into
  // smaller buffers
  _encodeLong(addTrezorHeaders: boolean): Uint8Array {
    const headerSize: number = HEADER_SIZE; // should be 8
    const bytes: Uint8Array = new Uint8Array(this.message.encodeAB());
    const fullSize: number = (addTrezorHeaders ? headerSize : (headerSize - 2)) + bytes.length;

    const encodedByteBuffer = new ByteBuffer(fullSize);

    // first encode header

    if (addTrezorHeaders) {
      // 2*1 byte
      encodedByteBuffer.writeByte(MESSAGE_HEADER_BYTE);
      encodedByteBuffer.writeByte(MESSAGE_HEADER_BYTE);
    }

    // 2 bytes
    encodedByteBuffer.writeUint16(this.type);

    // 4 bytes (so 8 in total)
    encodedByteBuffer.writeUint32(bytes.length);

    // then put in the actual message
    encodedByteBuffer.append(bytes);

    // and convert to uint8 array
    // (it can still be too long to send though)
    const encoded: Uint8Array = new Uint8Array(encodedByteBuffer.buffer);

    return encoded;
  }

  // encodes itself and splits into "nice" chunks
  encode(): Array<ArrayBuffer> {
    const bytes: Uint8Array = this._encodeLong(true);

    const result: Array<ArrayBuffer> = [];
    const size: number = BUFFER_SIZE;

    // How many pieces will there actually be
    const count: number = Math.floor((bytes.length - 1) / size) + 1;

    // slice and dice
    for (let i = 0; i < count; i++) {
      const slice: Uint8Array = bytes.subarray(i * size, (i + 1) * size);
      const newArray: Uint8Array = new Uint8Array(size);
      newArray.set(slice);
      result.push(newArray.buffer);
    }

    return result;
  }

  // encodes itself into one long arraybuffer
  encodeOne(): Buffer {
    const bytes: Uint8Array = this._encodeLong(false);
    return Buffer.from([...bytes]);
  }
}

// Removes $$hashkey from angular and remove nulls
function cleanupInput(message: Object): void {
  delete message.$$hashKey;

  for (const key in message) {
    const value = message[key];
    if (value == null) {
      delete message[key];
    } else {
      if (Array.isArray(value)) {
        value.forEach((i) => {
          if (typeof i === `object`) {
            cleanupInput(i);
          }
        });
      }
      if (typeof value === `object`) {
        cleanupInput(value);
      }
    }
  }
}

// Builds buffers to send.
// messages: Builders, generated by reading config
// name: Name of the message
// data: Data to serialize, exactly as given by trezor.js
// Returning buffers that will be sent to Trezor
export function buildBuffers(messages: Messages, name: string, data: Object): Array<ArrayBuffer> {
  const message: BuiltMessage = new BuiltMessage(messages, name, data);
  const encoded: Array<ArrayBuffer> = message.encode();
  return encoded;
}

// Sends message to device.
// Resolves iff everything gets sent
export function buildOne(
  messages: Messages,
  name: string,
  data: Object
): Buffer {
  const message: BuiltMessage = new BuiltMessage(messages, name, data);
  return message.encodeOne();
}

// Sends message to device.
// Resolves iff everything gets sent
export async function buildAndSend(
  messages: Messages,
  sender: (data: ArrayBuffer) => Promise<void>,
  name: string,
  data: Object
): Promise<void> {
  const buffers: Array<ArrayBuffer> = buildBuffers(messages, name, data);
  return sendBuffers(sender, buffers);
}
