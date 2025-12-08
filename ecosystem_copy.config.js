module.exports = {
  apps : [{
    name: 'Logiks_MicroApp',
    script: 'index.js',
    instances : '1',
    watch: ["services/*"],
    max_memory_restart: '1024M',
    exec_mode : "cluster",
    env: {
        "NODE_ENV": "production"
    }
  }]
};
