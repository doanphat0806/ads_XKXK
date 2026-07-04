'use strict';

function registerAllRoutes(app) {
  app.use('/api/auth', require('./authRoutes'));
  app.use('/api', require('./userRoutes'));
  app.use('/api', require('./configRoutes'));
  app.use('/api/ai', require('./aiRoutes'));
  app.use('/api/ai/facebook', require('./facebookAiRoutes'));
  app.use('/api/deal-stop', require('./dealStopRoutes'));
  app.use('/api/google', require('./googleRoutes'));
  app.use('/api/facebook', require('./facebookRoutes'));
}

module.exports = { registerAllRoutes };
