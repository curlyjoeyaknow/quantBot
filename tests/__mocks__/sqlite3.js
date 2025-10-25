const mockDb = {
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  close: jest.fn(),
  exec: jest.fn(),
  prepare: jest.fn(),
};

const Database = jest.fn(() => mockDb);

module.exports = {
  Database,
  OPEN_READWRITE: 2,
  OPEN_CREATE: 4,
};
