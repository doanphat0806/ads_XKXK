require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const { registerFacebookLoginRoutes } = require('./routes/facebookLoginRoutes');
const { createLegacyRuntime } = require('./services/legacyRuntimeService');
const { startPosOrderSync, stopPosOrderSync } = require('./services/posOrderService');
const { startPerfMonitor, requestTimingMiddleware } = require('./utils/perfMonitor');

const app = express();
const publicDir = path.join(__dirname, 'client', 'dist');
app.set('trust proxy', 1);

startPerfMonitor();
app.use(requestTimingMiddleware);
app.use(cors());
// Nen gzip JSON/JS/CSS (danh sach don, Tong hoan... giam ~70-80% dung luong)
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// File trong /assets co hash trong ten (Vite) -> trinh duyet nho lau dai; index.html luon hoi lai de lay ban build moi
app.use('/assets', express.static(path.join(publicDir, 'assets'), { maxAge: '365d', immutable: true }));
// Chunk cu khong con sau khi build lai -> 404 thay vi tra index.html (trinh duyet bao loi MIME kho hieu)
app.use('/assets', (req, res) => res.status(404).end());
app.use(express.static(publicDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

registerFacebookLoginRoutes(app);
const legacyRuntime = createLegacyRuntime(app);

// Route /api khong khop cai nao phai tra JSON 404. Neu de roi xuong catch-all
// ben duoi thi client nhan ve index.html va bao "May chu tra ve loi HTML" thay vi
// loi that (vd: goi sai duong dan API).
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Khong tim thay API ${req.method} /api${req.path}` });
});

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
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
  // Don hang lay tu Pancake POS (chi doc config + trang thai trong DB, khong cho mang)
  try {
    await startPosOrderSync();
  } catch (error) {
    console.error(`[pos-orders] khoi dong dong bo loi: ${error.message}`);
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
  stopPosOrderSync();
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
