module.exports = {
  apps: [
    {
      name: 'server',
      script: 'server.js',
      // VPS 15 GB: Node toi da 10 GB heap, pm2 restart khi cham 11 GB.
      // Day la muc tran, Node chi dung phan can. Neu MongoDB chay chung VPS thi
      // gioi han cache MongoDB (storage.wiredTiger.engineConfig.cacheSizeGB: 2)
      // de tong khong vuot RAM may.
      node_args: '--max-old-space-size=10240',
      max_memory_restart: '11G'
    }
  ]
};
