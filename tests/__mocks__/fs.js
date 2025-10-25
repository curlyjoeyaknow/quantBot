const fs = {
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(() => []),
  statSync: jest.fn(() => ({ mtime: new Date() })),
  unlinkSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(() => Promise.resolve([])),
    stat: jest.fn(() => Promise.resolve({ mtime: new Date() })),
    unlink: jest.fn()
  }
};

module.exports = fs;
module.exports.default = fs;
