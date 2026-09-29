'use strict';
// Wire format: [type:1][length:4 BE][payload]
//   type 1 = JSON control frame
//   type 2 = file data frame, payload = [transferId:4 BE][bytes]
const T_JSON = 1;
const T_DATA = 2;
const MAX_FRAME = 4 * 1024 * 1024;

function encodeJson(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(5);
  head[0] = T_JSON;
  head.writeUInt32BE(body.length, 1);
  return [head, body];
}

function encodeData(id, chunk) {
  const head = Buffer.alloc(9);
  head[0] = T_DATA;
  head.writeUInt32BE(chunk.length + 4, 1);
  head.writeUInt32BE(id, 5);
  return [head, chunk];
}

class Decoder {
  constructor(onJson, onData) {
    this.onJson = onJson;
    this.onData = onData;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 5) {
      const len = this.buf.readUInt32BE(1);
      if (len > MAX_FRAME) throw new Error('frame too large');
      if (this.buf.length < 5 + len) break;
      const type = this.buf[0];
      const payload = this.buf.subarray(5, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      if (type === T_JSON) this.onJson(JSON.parse(payload.toString('utf8')));
      else if (type === T_DATA) this.onData(payload.readUInt32BE(0), payload.subarray(4));
      else throw new Error('bad frame type');
    }
  }
}

module.exports = { encodeJson, encodeData, Decoder };
