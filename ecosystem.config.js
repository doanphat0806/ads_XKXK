module.exports = {
  apps: [
    {
      name: 'server',
      script: 'server.js',
      node_args: '--max-old-space-size=6144',
      max_memory_restart: '7G'
    }
  ]
};
