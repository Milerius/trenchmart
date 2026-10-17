export type ZipEntryMeta = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  unixMode: number;
  isUnix: boolean;
};

export function unixModeIsSymlink(mode: number): boolean {
  return (mode & 0o170000) === 0o120000;
}

export function unsafeZipPath(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return true;
  const parts = name.split('/');
  return parts.some((p) => p === '..');
}

function findEocd(buf: Uint8Array): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}

export function listZip(buf: Uint8Array): ZipEntryMeta[] | { error: string } {
  const eocd = findEocd(buf);
  if (eocd < 0) return { error: 'not a zip' };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntryMeta[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length) return { error: 'truncated central directory' };
    if (
      buf[offset] !== 0x50 ||
      buf[offset + 1] !== 0x4b ||
      buf[offset + 2] !== 0x01 ||
      buf[offset + 3] !== 0x02
    ) {
      return { error: 'bad central directory' };
    }
    const madeBy = view.getUint16(offset + 4, true);
    const method = view.getUint16(offset + 10, true);
    const comp = view.getUint32(offset + 20, true);
    const uncomp = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const ext = view.getUint32(offset + 38, true);
    const name = new TextDecoder().decode(buf.subarray(offset + 46, offset + 46 + nameLen));
    entries.push({
      name,
      compressedSize: comp,
      uncompressedSize: uncomp,
      method,
      unixMode: ext >>> 16,
      isUnix: madeBy >> 8 === 3,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
