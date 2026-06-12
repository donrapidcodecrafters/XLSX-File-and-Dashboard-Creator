module.exports = {
  apps: [
    {
      name: "quickbase-reporting-api",
      cwd: __dirname,
      script: "apps/api/dist/index.js",
      node_args: "--max-old-space-size=1400",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "1500M",
      time: true,
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3001"
      },
      error_file: "logs/api-error.log",
      out_file: "logs/api-out.log",
      merge_logs: true,
      restart_delay: 3000,
      kill_timeout: 10000
    }
  ]
};
