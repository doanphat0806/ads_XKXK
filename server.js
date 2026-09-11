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

// Route /api khong khop cai nao phai tra JSON 404. Neu de roi xuong catch-all
// ben duoi thi client nhan ve index.html va bao "May chu tra ve loi HTML" thay vi
// loi that (vd: goi sai duong dan API).
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Khong tim thay API ${req.method} /api${req.path}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Error handler cuoi chuoi: Express bat loi dong bo (va loi chuyen qua next(err))
// tu moi route. Khong co handler nay thi client nhan trang HTML stack trace cua
// Express thay vi JSON, nen bao loi tren giao dien luon la "loi HTML".
app.use((error, req, res, next) => {
  console.error(`Unhandled route error ${req.method} ${req.originalUrl}: ${error.message}`);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.message || 'Loi may chu' });
});

// Mot promise bi reject ma khong ai bat (vd: query Mongo trong handler async thieu
// try/catch) se lam Node >= 15 ket thuc process - ca he thong sap vi mot request
// hong. Log lai va giu server song; request hong van tu timeout o phia client.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason?.stack || reason?.message || reason);
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fb_ads_manager';
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGO_URI).then(async () => {
  console.log('MongoDB connected');
  try {
    await legacyRuntime.seedOrderSheetCache();
  } catch (error) {
    console.error(`Order sheet cache seed failed: ${error.message}`);
  }
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

  (async () => {
    try {
      await legacyRuntime.runStartupMaintenance();
    } catch (error) {
      console.error(`Startup storage maintenance failed: ${error.message}`);
    }

    await legacyRuntime.bootstrapFacebookToken();
    await legacyRuntime.initializeQueues();
    legacyRuntime.startSheetRefresh();
    legacyRuntime.startCronTasks();
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
