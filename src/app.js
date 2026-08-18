const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const shippingRoutes = require('./routes/shippingRoutes');
const googleSheetsService = require('./services/googleSheetsService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Public Static Files (HTML Dashboard)
app.use(express.static(path.join(__dirname, '../public')));

// Config Endpoint for Web Dashboard
app.get('/api/config', (req, res) => {
  res.json({
    status: 'success',
    spreadsheetId: process.env.SPREADSHEET_ID || ''
  });
});

// API Routes
app.use('/api', shippingRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);

  const errorDesc = err.response?.data?.error_description || err.message || '';
  if (errorDesc.includes('account not found') || err.response?.data?.error === 'invalid_grant') {
    return res.status(400).json({
      status: 'error',
      errorType: 'GOOGLE_AUTH_INVALID_GRANT',
      message: 'Google Service Account Authentication Failed: Invalid grant (account not found).',
      remedies: [
        '1. Check GOOGLE_SERVICE_ACCOUNT_EMAIL in your .env file or credentials.json.',
        '2. Verify there are no typos, extra quotes, or trailing spaces in the service account email.',
        '3. Make sure the Service Account email actually exists in Google Cloud Console -> IAM & Admin -> Service Accounts.',
        '4. Ensure the Google Spreadsheet is shared with this Service Account email address (Editor permission).'
      ]
    });
  }

  res.status(500).json({ status: 'error', message: err.message || 'Internal Server Error' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Shree Maruti Shipping API running on port ${PORT}`);
  console.log(`💻 Web Dashboard: http://localhost:${PORT}`);
  console.log(`📊 Google Sheets Configured: ${googleSheetsService.isConfigured() ? 'YES ✅' : 'NO ⚠️ (Using local seed fallback)'}`);
  console.log(`=======================================================`);
});

module.exports = app;
