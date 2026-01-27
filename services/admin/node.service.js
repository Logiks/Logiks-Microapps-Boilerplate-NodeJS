//Administrating Node Controls

"use strict";

const os = require("os");

module.exports = {
    name: "admin.node",

    actions: {
        stats: {
            description: "Get node statistics",
            handler() {
                return {
                    pid: process.pid,
                    platform: process.platform,
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage(),
                    loadAverage: os.loadavg(),
                    totalMemory: os.totalmem(),
                    freeMemory: os.freemem(),
                    cpus: os.cpus(),
                    networkInterfaces: os.networkInterfaces(),
                };
            }
        },

        shutdown: {
            description: "Shutdown the node",
            handler() {
                this.logger.info("Node is shutting down...");
                setTimeout(() => {
                    process.exit(0);
                }, 1000);
                return { message: "Shutdown initiated" };
            }
        },

        restart: {
            description: "Restart the node",
            handler() {
                this.logger.info("Node is restarting...");
                setTimeout(() => {
                    process.exit(1);
                }, 1000);
                return { message: "Restart initiated" };
            }
        },

        ping: {
            description: "Ping the node",
            handler() {
                return { message: "pong" };
            }
        },

        healthCheck: {
            description: "Perform a health check on the node",
            handler() {
                // Simple health check logic
                const healthStatus = {
                    status: "ok",
                    timestamp: new Date(),
                };
                return healthStatus;
            }
        },


    },
    events: {
        
    }
}