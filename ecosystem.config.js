require('dotenv').config();

const instanceId = process.env.INSTANCE_ID || 'examflex';

module.exports = {
  apps: [
    {
      name: `${instanceId}-api`,

      script: 'dist/main.js',

      instances: 1,

      exec_mode: 'fork',

      autorestart: true,

      watch: false,

      max_memory_restart: '700M',

      kill_timeout: 5000,

      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        INSTANCE_ID: process.env.INSTANCE_ID || 'examflex',
        INSTANCE_NAME: process.env.INSTANCE_NAME || 'ExamFlex',
      },
    },
  ],
};
