const express = require('express')
const httpProxy = require('http-proxy');
require('dotenv').config();
const client = require('./client');
const axios = require('axios');

const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

const app = express()
const PORT = process.env.PORT || 8000

const CDN_URL = process.env.CDN_URL;
const API_SERVER_URL = process.env.API_SERVER_URL;
const SERVERLESS_BASE_URL = process.env.SERVERLESS_BASE_URL;

const proxy = httpProxy.createProxy();

async function preloadAppTypes() {
    try {
      console.log('Preloading app types from API server...');
      const response = await axios.get(`${API_SERVER_URL}/api/v1/app-types`);
      const mapping = response.data;
  
      for (const [subdomain, appType] of Object.entries(mapping)) {
        await client.set(subdomain, appType, 'EX', 600); 
      }
  
      console.log('App types preloaded into Redis ✅');
    } catch (error) {
      console.error('Failed to preload app types:', error.message);
    }
}

async function getAppTypeFromDB(subdomain) {
    try {
      console.log('Fetching app type from API server...');
      const response = await axios.get(`${API_SERVER_URL}/api/v1/app-types`);
      const mapping = response.data;
  
      return mapping[subdomain]; 
    } catch (error) {
      console.error('Error fetching from API server:', error.message);
      return null;
    }
}

app.use(async (req, res) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];

    let appType = await client.get(subdomain);

    if (!appType) {
      appType = await getAppTypeFromDB(subdomain);
      if (appType) {
        await client.set(subdomain, appType, 'EX', 60 * 60 * 24 * 365); // 1 year
      }
    }

    if (!appType) {
      res.status(404).send('Application not found');
      return;
    }

    let targetUrl;
    if (appType === 'static') {
        console.log("Static app type");
        targetUrl = `${CDN_URL}/outputs/${subdomain}/`;
    } else if (appType === 'serverless') {
        console.log("Serverless app type");
        targetUrl = `https://${subdomain}.${SERVERLESS_BASE_URL}/`;
    } else {
        console.log("Unknown app type");
        targetUrl = `http://${DYNAMIC_PROJECTS_URL}/projects/${subdomain}/`
    }

    req.appType = appType;
    const clientIP = req.ip;

    console.log(targetUrl);
    const agentToUse = targetUrl.startsWith('https') ? httpsAgent : httpAgent;

    proxy.web(req, res, {
        target: targetUrl,
        changeOrigin: true,
        agent: agentToUse,
        headers: {
            'X-Forwarded-For': clientIP,
            'X-Real-IP': clientIP,
            'X-Project-Path': "/outputs/" + subdomain
        }
    });
})

proxy.on('proxyReq', (proxyReq, req, res) => {
    if (req.appType === 'static' && req.url === '/') {
      proxyReq.path += 'index.html';
    }
    console.log(proxyReq.path);
});

preloadAppTypes().then(() => {
app.listen(PORT, () => console.log(`Reverse Proxy Running on port ${PORT}`));
});
  