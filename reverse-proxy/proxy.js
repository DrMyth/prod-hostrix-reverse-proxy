const app = require('/api/app');
const serverless = require('serverless-http');

module.exports = serverless(app);