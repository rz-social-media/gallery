// Streaming STORE-only ZIP writer that does no per-byte work in the Worker.
// CRC-32 values are computed in the browser at upload time and stored on each
// media item, so the Worker only writes headers and pipes R2 bodies through.
// That keeps CPU time flat no matter how large the gallery is.

export type ZipEntry = {
  name: string;
  size: number;
  crc32?: number;
  modified: Date;
  open: () => Promise<ReadableStream<Uint8Array> | null>;
};

const encoder = new TextEncoder();
const MAX32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function dosTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function localHeader(name: Uint8Array, entry: ZipEntry, crc: number, zip64: boolean) {
  const extra = zip64 ? 20 : 0;
  const buffer = new Uint8Array(30 + name.length + extra);
  const view = new DataView(buffer.buffer);
  const { time, date } = dosTime(entry.modified);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, zip64 ? 45 : 20, true);
  view.setUint16(6, 0x0800, true); // UTF-8 names
  view.setUint16(8, 0, true); // STORE
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, zip64 ? MAX32 : entry.size, true);
  view.setUint32(22, zip64 ? MAX32 : entry.size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, extra, true);
  buffer.set(name, 30);
  if (zip64) {
    const at = 30 + name.length;
    view.setUint16(at, 0x0001, true);
    view.setUint16(at + 2, 16, true);
    view.setBigUint64(at + 4, BigInt(entry.size), true);
    view.setBigUint64(at + 12, BigInt(entry.size), true);
  }
  return buffer;
}

function centralHeader(name: Uint8Array, entry: ZipEntry, crc: number, offset: number) {
  const zip64 = entry.size >= MAX32 || offset >= MAX32;
  const extra = zip64 ? 28 : 0;
  const buffer = new Uint8Array(46 + name.length + extra);
  const view = new DataView(buffer.buffer);
  const { time, date } = dosTime(entry.modified);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, (3 << 8) | 45, true);
  view.setUint16(6, zip64 ? 45 : 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, zip64 ? MAX32 : entry.size, true);
  view.setUint32(24, zip64 ? MAX32 : entry.size, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, extra, true);
  view.setUint32(38, (0o100644 << 16) >>> 0, true);
  view.setUint32(42, zip64 ? MAX32 : offset, true);
  buffer.set(name, 46);
  if (zip64) {
    const at = 46 + name.length;
    view.setUint16(at, 0x0001, true);
    view.setUint16(at + 2, 24, true);
    view.setBigUint64(at + 4, BigInt(entry.size), true);
    view.setBigUint64(at + 12, BigInt(entry.size), true);
    view.setBigUint64(at + 20, BigInt(offset), true);
  }
  return buffer;
}

function endRecords(count: number, centralSize: number, centralOffset: number) {
  const zip64 = count >= 0xffff || centralSize >= MAX32 || centralOffset >= MAX32;
  const parts: Uint8Array[] = [];
  if (zip64) {
    const record = new Uint8Array(56);
    const r = new DataView(record.buffer);
    r.setUint32(0, 0x06064b50, true);
    r.setBigUint64(4, 44n, true);
    r.setUint16(12, 45, true);
    r.setUint16(14, 45, true);
    r.setBigUint64(24, BigInt(count), true);
    r.setBigUint64(32, BigInt(count), true);
    r.setBigUint64(40, BigInt(centralSize), true);
    r.setBigUint64(48, BigInt(centralOffset), true);
    const locator = new Uint8Array(20);
    const l = new DataView(locator.buffer);
    l.setUint32(0, 0x07064b50, true);
    l.setBigUint64(8, BigInt(centralOffset + centralSize), true);
    l.setUint32(16, 1, true);
    parts.push(record, locator);
  }
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, Math.min(count, 0xffff), true);
  e.setUint16(10, Math.min(count, 0xffff), true);
  e.setUint32(12, Math.min(centralSize, MAX32), true);
  e.setUint32(16, Math.min(centralOffset, MAX32), true);
  parts.push(end);
  return parts;
}

// Exact archive size, so browsers can show real progress and detect truncation.
export function zipLength(entries: ZipEntry[]) {
  let offset = 0;
  let central = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name).length;
    const zip64Local = entry.size >= MAX32;
    central += 46 + name + (entry.size >= MAX32 || offset >= MAX32 ? 28 : 0);
    offset += 30 + name + (zip64Local ? 20 : 0) + entry.size;
  }
  const zip64End = entries.length >= 0xffff || central >= MAX32 || offset >= MAX32;
  return offset + central + (zip64End ? 76 : 0) + 22;
}

async function crcOf(stream: ReadableStream<Uint8Array>) {
  let crc = 0xffffffff;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) crc = CRC_TABLE[(crc ^ value[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStream(entries: ZipEntry[]) {
  const { readable, writable } = new FixedLengthStream(zipLength(entries));
  const writer = writable.getWriter();
  (async () => {
    const central: Uint8Array[] = [];
    let offset = 0;
    try {
      for (const entry of entries) {
        const name = encoder.encode(entry.name);
        // Legacy items without a stored checksum: compute it here (costs CPU).
        let crc = entry.crc32;
        if (typeof crc !== "number") {
          const source = await entry.open();
          if (!source) throw new Error(`Missing ${entry.name}`);
          crc = await crcOf(source);
        }
        const header = localHeader(name, entry, crc, entry.size >= MAX32);
        await writer.write(header);
        const body = await entry.open();
        if (!body) throw new Error(`Missing ${entry.name}`);
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        central.push(centralHeader(name, entry, crc, offset));
        offset += header.length + entry.size;
      }
      const centralSize = central.reduce((sum, part) => sum + part.length, 0);
      for (const part of central) await writer.write(part);
      for (const part of endRecords(entries.length, centralSize, offset)) await writer.write(part);
      await writer.close();
    } catch (error) {
      await writer.abort(error);
    }
  })();
  return readable;
}
