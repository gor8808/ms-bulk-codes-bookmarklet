const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ZipWriter, buildZip, crc32, timestamp } = require('../server/lib/zip-writer');

test('crc32 returns the standard checksum for known data', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('buildZip creates an uncompressed ZIP with local and central directory signatures', () => {
  const zip = buildZip([{ name: '00468/file.pdf', data: Buffer.from('%PDF-test') }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.notEqual(zip.indexOf(Buffer.from('00468/file.pdf')), -1);
  assert.notEqual(zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), -1);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test('ZipWriter writes timestamped archive into download directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-writer-'));
  const writer = new ZipWriter(dir);
  const result = await writer.write(
    [{ name: '00468/file.pdf', data: Buffer.from('%PDF-test') }],
    new Date(2026, 4, 17, 18, 30),
  );

  assert.equal(result.fileName, 'marking-labels-2026-05-17-18-30.zip');
  assert.equal(path.dirname(result.filePath), dir);
  assert.equal((await fs.stat(result.filePath)).size > 0, true);
});

test('timestamp formats local date components', () => {
  assert.equal(timestamp(new Date(2026, 4, 17, 18, 30)), '2026-05-17-18-30');
});
