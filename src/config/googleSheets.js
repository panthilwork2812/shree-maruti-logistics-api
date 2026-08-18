const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Clean surrounding quotes and whitespace from email address
 */
function cleanEmail(rawEmail) {
  if (!rawEmail) return '';
  let email = rawEmail.trim();
  if ((email.startsWith('"') && email.endsWith('"')) || (email.startsWith("'") && email.endsWith("'"))) {
    email = email.substring(1, email.length - 1).trim();
  }
  return email;
}

/**
 * Robustly formats and sanitizes Google Service Account PEM Private Key string.
 * Handles escaped \n, quotes, Windows carriage returns, and PEM headers/footers.
 */
function formatPrivateKey(rawKey) {
  if (!rawKey) return null;
  let key = rawKey.trim();

  // Remove outer wrapping quotes if present
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.substring(1, key.length - 1);
  }

  // Replace literal '\n' characters with real newlines
  key = key.replace(/\\n/g, '\n');

  // Normalize line breaks (remove \r)
  key = key.replace(/\r/g, '');

  // Ensure header and footer have proper newlines
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}`;
  }
  if (!key.includes('-----END PRIVATE KEY-----')) {
    key = `${key}\n-----END PRIVATE KEY-----`;
  }

  // Enforce proper newlines after header and before footer
  key = key.replace(/-----BEGIN PRIVATE KEY-----\s*/, '-----BEGIN PRIVATE KEY-----\n');
  key = key.replace(/\s*-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----\n');

  return key.trim();
}

/**
 * Initializes and returns an authenticated Google Sheets API client.
 */
function getGoogleSheetsClient() {
  let auth;

  // 1. Try credentials.json if file exists
  const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'credentials.json';
  const resolvedKeyPath = path.isAbsolute(keyFilePath) 
    ? keyFilePath 
    : path.join(__dirname, '../../', keyFilePath);

  if (fs.existsSync(resolvedKeyPath)) {
    try {
      const fileContent = fs.readFileSync(resolvedKeyPath, 'utf8');
      const creds = JSON.parse(fileContent);

      if (creds.client_email && creds.private_key) {
        const email = cleanEmail(creds.client_email);
        const privateKey = formatPrivateKey(creds.private_key);
        auth = new google.auth.JWT({
          email,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      } else {
        auth = new google.auth.GoogleAuth({
          keyFile: resolvedKeyPath,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      }
    } catch (err) {
      console.error('Failed to parse credentials.json:', err.message);
    }
  }

  // 2. Try Environment Variables if auth not initialized yet
  if (!auth && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const email = cleanEmail(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    const privateKey = formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY);

    auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  if (!auth) {
    return null;
  }

  return google.sheets({ version: 'v4', auth });
}

module.exports = {
  cleanEmail,
  formatPrivateKey,
  getGoogleSheetsClient,
};
