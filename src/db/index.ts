import { DatabaseSync } from 'node:sqlite';

class AuroraDb {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    return {
      get: (...params: any[]): any => stmt.get(...params),
      all: (...params: any[]): any[] => stmt.all(...params),
      run: (...params: any[]) => stmt.run(...params),
    };
  }

  exec(sql: string) { this.db.exec(sql); }
  close() { this.db.close(); }
  pragma(sql: string) { this.exec(`PRAGMA ${sql}`); }
}

export const getDb = () => {
  const dbPath = process.env.AURORA_DB_PATH || 'C:\\Aurora\\AuroraDB.db';
  return new AuroraDb(dbPath);
};

export const initDb = () => {
  const db = getDb();
  try {
    db.exec('PRAGMA foreign_keys = ON');
  } finally {
    db.close();
  }
};