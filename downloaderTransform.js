const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');

const Blake2s = require('blake2s-js');
const rimraf = require('rimraf');
const uniqid = require('uniqid');

const FILE_WRITTEN = 'file_written';

class Downloader extends Writable {
  constructor({ storagePath } = {}) {
    super();

    this.tempHash = uniqid();
    this.storagePath = storagePath || path.join(process.cwd(), '/fileStore/store/');
    this.chunkIndex = 0;
    this.hasher = new Blake2s(16);
    this.overflow = Buffer.alloc(0);

    if (!fs.existsSync(path.join(this.storagePath, this.tempHash))) {
      fs.mkdirSync(path.join(this.storagePath, this.tempHash), { recursive: true });
    }
  }

  _write(chunk, encoding, next) {
    const chunkAsBuf = !(chunk instanceof Buffer) ? Buffer.from(chunk) : chunk;
    const withOverflow = Buffer.concat([this.overflow, chunkAsBuf]);
    const totalLength = withOverflow.length;

    this.hasher.update(chunk);

    if (totalLength > 4096) {
      let asArray = Array.from(withOverflow);

      while (asArray.length >= 4096) {
        const chunkPath = path.join(this.storagePath, this.tempHash, `${this.chunkIndex}.txt`);

        fs.writeFileSync(chunkPath, Buffer.from(asArray.splice(0, 4096)));
        this.chunkIndex += 1;
      }

      this.overflow = Buffer.from(asArray);
    } else {
      this.overflow = withOverflow;
    }

    next();
  }

  _final(done) {
    const hash = this.hasher.hexDigest();
    const tempDir = path.join(this.storagePath, this.tempHash);
    const finalDir = path.join(this.storagePath, hash);

    if (this.overflow.length > 0) {
      fs.writeFileSync(path.join(this.storagePath, this.tempHash, `${this.chunkIndex}.txt`), this.overflow);
      this.chunkIndex += 1;
    }

    fs.mkdirSync(finalDir);

    for (let i = 0; i < this.chunkIndex; i += 1) {
      fs.copyFileSync(path.join(tempDir, `${i}.txt`), path.join(finalDir, `${i}.txt`));
    }

    rimraf.sync(tempDir;

    this.emit(FILE_WRITTEN, path.join(finalDir, `${this.chunkIndex - 1}.txt`));
    done();
  }
}

module.exports = {
  FILE_WRITTEN,
  Downloader
};
