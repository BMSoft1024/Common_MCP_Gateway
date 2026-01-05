module.exports = {
  apps: [
    {
      name: 'gateway-manager-backend',
      script: 'gateway-manager/backend/src/server.ts',
      cwd: __dirname,
      interpreter: 'node',
      interpreter_args: '--loader ts-node/esm',
      env: {
        NODE_ENV: 'production',
        PORT: 1525
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      name: 'gateway-manager-frontend',
      script: 'npm',
      args: 'run dev',
      cwd: './gateway-manager/frontend',
      env: {
        NODE_ENV: 'development',
        PORT: 5173
      },
      autorestart: true,
      watch: false,
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
