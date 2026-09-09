import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';
const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.warn('.env file not found at project root:', envPath);
}
const dbHost = process.env.DB_HOST;
const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbPassword = process.env.DB_PASSWORD || process.env.DB_PASS || '';
const poolConfig = {
  user: process.env.DB_USER || 'root',
  password: dbPassword,
  database: process.env.DB_NAME || 'my_project_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
};
if (dbHost && dbHost !== 'someshit') {
  poolConfig.host = dbHost;
  poolConfig.port = dbPort;
} else {
  poolConfig.socketPath = process.env.DB_SOCKET || '/run/mysqld/mysqld.sock';
}
export const pool = mysql.createPool(poolConfig);
