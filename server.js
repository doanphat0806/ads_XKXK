require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { registerFacebookLoginRoutes } = require('./routes/facebookLoginRoutes');
const { createLegacyRuntime } = require('./services/legacyRuntimeService');

const app = express();
const publicDir = path.join(__dirname, 'client', 'dist');
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(publicDir));

registerFacebookLoginRoutes(app);
const legacyRuntime = createLegacyRuntime(app);

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager';
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGO_URI).then(() => {
  console.log('MongoDB connected');
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  legacyRuntime.startSheetRefresh();

  (async () => {
    try {
      await legacyRuntime.runStartupMaintenance();
    } catch (error) {
      console.error(`Startup storage maintenance failed: ${error.message}`);
    }

    await legacyRuntime.bootstrapFacebookToken();
    legacyRuntime.startCronTasks();
    await legacyRuntime.initializeQueues();
    await legacyRuntime.resumeAutoAccounts();
  })().catch(error => {
    console.error(`Background startup failed: ${error.message}`);
  });
}).catch(error => {
  console.error('MongoDB error:', error.message);
  process.exit(1);
});

async function gracefulShutdown(signal) {
  console.log(`Shutting down gracefully (${signal})...`);
  await legacyRuntime.shutdown();
  await mongoose.connection.close();
  process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT').catch(error => {
  console.error('Graceful shutdown failed:', error.message);
  process.exit(1);
}));

process.once('SIGTERM', () => gracefulShutdown('SIGTERM').catch(error => {
  console.error('Graceful shutdown failed:', error.message);
  process.exit(1);
}));
