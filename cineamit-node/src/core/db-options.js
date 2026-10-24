'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const Config = require('./config');

// Shared by the application pool and the explicitly supplied session-store pool.
// express-mysql-session 3.x drops SSL fields when it constructs its own pool.
module.exports = function databaseOptions() {
  const host = String(Config.DB_HOST || '').trim();
  const database = String(Config.DB_NAME || '').trim();
  const user = String(Config.DB_USER || '').trim();
  const password = String(Config.DB_PASS ?? '');
  if (!host || !database || !user || password === '') {
    throw new Error('MySQL config missing. Check DB_HOST, DB_NAME, DB_USER and DB_PASS in .env.');
  }
  const options = {
    host, port: Config.DB_PORT || 3306, user, password, database,
    charset: 'utf8mb4', waitForConnections: true, connectionLimit: 10,
    namedPlaceholders: false, dateStrings: true, connectTimeout: 5000,
  };
  if (Config.DB_SSL) {
    // mysql2 uses DNS hostnames for SNI and its identity verification path.
    // Do not silently skip hostname checks for a numeric IP destination.
    if (net.isIP(host.replace(/^\[|\]$/g, ''))) {
      throw new Error('Use the database DNS hostname, not an IP address, when DB_SSL is enabled so certificate identity can be verified.');
    }
    options.ssl = {rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2'};
    if (Config.DB_SSL_CA_FILE) {
      const filename = path.resolve(__dirname, '../..', Config.DB_SSL_CA_FILE);
      try { options.ssl.ca = fs.readFileSync(filename, 'utf8'); }
      catch { throw new Error('Cannot read DB_SSL_CA_FILE. Use an existing PEM CA file; relative paths start at the application root.'); }
    }
  }
  return options;
};
