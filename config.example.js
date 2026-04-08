/**
 * Command Center — Configuration
 *
 * 1. Copy this file: cp config.example.js config.js
 * 2. Replace the placeholder values below with your own.
 * 3. See SETUP.md for detailed instructions.
 */
window.COMMAND_CENTER_CONFIG = {
  // Your Google Sheet ID (from the URL: /spreadsheets/d/SHEET_ID/edit)
  sheetId: 'YOUR_SHEET_ID_HERE',

  // Your Google OAuth 2.0 Client ID (Web application type)
  // Get one at: https://console.cloud.google.com/apis/credentials
  // Create OAuth 2.0 Client ID → Web application
  // Add your domain to Authorized JavaScript Origins
  oauthClientId: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',

  // Optional: dashboard title
  title: 'Command Center',
};
