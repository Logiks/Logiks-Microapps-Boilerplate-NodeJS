//For Starting the Plugin

const { ServiceBroker } = require("moleculer");
const { MoleculerError } = require("moleculer").Errors;
const os = require("os");

// Blue/Green deployment flag: "blue" or "green"
const WORKER_COLOR = process.env.WORKER_COLOR || "blue";

// Heartbeat interval
const HEARTBEAT_INTERVAL_MS = 10_000;

//Error Controller
class LogiksError extends MoleculerError {
  constructor(message = "Source Not Found", errCode = 404, errShortName = "INTERNAL_ONLY", errObj = {}) {
    super(message, errCode, errShortName, errObj);
    this.name = "LogiksError";
  }
}
global.LogiksError = LogiksError;

module.exports = {

	initialize: async function() {
        console.log("\n\x1b[32m%s\x1b[0m","MicroApp Initialization Completed");
    },

	start: async function() {
		const broker = new ServiceBroker({
			nodeID: `worker-${process.env.NODE_ID}-${os.hostname()}-${process.pid}`,
			transporter: process.env.TRANSPORTER || "nats://localhost:4222",
			namespace: process.env.NAMESPACE || "default",

			logger: true,
			// logger: console,
			logLevel: process.env.PLUGIN_LOG_LEVEL,//"info",

			requestTimeout: 10_000,
			retryPolicy: {
				enabled: true,
				retries: 3
			},
			metadata: {
				authToken: process.env.CLUSTER_TOKEN,
				nodeRole: "worker",
				color: WORKER_COLOR
			},

			metrics: true,
			statistics: true
		});
		
		// Load all local services
		broker.loadServices("./services");

		return broker;
	},

	connect: async function(broker, callback) {
		// -------------------------
		// SINGLE STARTUP REGISTRATION FUNCTION
		// -------------------------
		async function registerWithMainBroker() {
			const payload = {
				nodeID: broker.nodeID,
				role: "worker",
				host: os.hostname(),
				pid: process.pid,
				color: WORKER_COLOR,
				services: getLocalServiceNames(broker),
				menus: await PLUGINS.getMenus(),
				plugins: PLUGINS.listPlugins()
			};

			let attempt = 0;

			while (true) {
				attempt++;
				try {
					await broker.call("system.registerWorker", payload, {
						timeout: 5000,
						retries: 0
					});

					await BASEAPP.connect(broker);

					broker.logger.info("Worker successfully registered with main broker", payload);
					break;
				} catch (err) {
					// console.error("ERROR Registering Application", err);
					broker.logger.warn(
						`⏳ Main broker not ready yet. Retry ${attempt} in 5s...`,
						err.message
					);
					await new Promise(res => setTimeout(res, 5000));
				}
			}
		}

		// -------------------------
		// HEARTBEAT TO MAIN BROKER
		// -------------------------
		let heartbeatTimer = null;

		function startHeartbeat() {
			if (heartbeatTimer) return;

			heartbeatTimer = setInterval(async () => {
				try {
					const mem = process.memoryUsage();
					const load = os.loadavg()[0];

					await broker.call("system.workerHeartbeat", {
						nodeID: broker.nodeID,
						color: WORKER_COLOR,
						ts: Date.now(),
						metrics: {
							load,
							rss: mem.rss,
							heapUsed: mem.heapUsed
						}
					}, { timeout: 3000 });

				} catch (err) {
					broker.logger.warn("⚠️ Heartbeat failed", err.message);
				}
			}, HEARTBEAT_INTERVAL_MS);
		}

		// -------------------------
		// GRACEFUL DRAIN (ROLLING RESTART SAFETY)
		// -------------------------
		async function gracefulShutdown(signal) {
			broker.logger.warn(`🛑 Drain started (${signal}) — notifying main broker...`);

			try {
				// 1️⃣ Tell main broker to stop routing traffic here
				await broker.call("system.drainWorker", {
					nodeID: broker.nodeID
				}, { timeout: 5000 });

				broker.logger.info("⏱ Waiting for in-flight requests to complete...");
				await broker.stop();

				broker.logger.info("🚫 Worker drained & stopped safely");
				process.exit(0);
			} catch (err) {
				broker.logger.error("❌ Drain failed", err);
				process.exit(1);
			}
		}

		process.on("SIGINT", gracefulShutdown);
		process.on("SIGTERM", gracefulShutdown);

		// -------------------------
		// AUTO RE-REGISTER ON RECONNECT
		// -------------------------
		function setupReconnectListener() {
			// Transporter exists AFTER broker.start()
			const tx = broker.transit && broker.transit.tx;
			if (!tx) {
				broker.logger.warn("⚠️ Transport TX not ready yet");
				return;
			}

			const client = tx.client;
			if (client && client.on) {
				// For NATS / MQTT / Redis / AMQP
				client.on("reconnect", async () => {
					broker.logger.warn("🔄 Transporter reconnected — re-registering worker...");
					await registerWithMainBroker();
				});

				client.on("connect", async () => {
					broker.logger.warn("🔌 Transporter connected — ensuring registration...");
					await registerWithMainBroker();
				});
			}
		}

		let BROKER_CONNECTED = false;
		// Start worker
		broker.start().then(async () => {
			broker.logger.info("MicroApp Started & Connected to Cluster");

			await registerWithMainBroker();   // Startup registration
			startHeartbeat();                 // Start health pings

			// Now hook transporter reconnect events
			setupReconnectListener();

			BROKER_CONNECTED = true;

			broker.localBus.on("$node.connected", async payload => {
				BROKER_CONNECTED = true;
				await registerWithMainBroker();
				broker.logger.info("Node connected:", payload.node.id);
			});

			broker.localBus.on("$node.disconnected", async payload => {
				BROKER_CONNECTED = false;
				broker.logger.warn("Node disconnected:", payload.node.id);
			});

			return 0;
		})
		.catch(err => console.error(`Error occured! ${err.message}`))
		.finally(a=> {
			if(BROKER_CONNECTED) {
				console.log("\n\x1b[34m%s\x1b[0m", "MicroApp Started & Connected to Cluster");
			} else {
				console.log("\n\x1b[31m%s\x1b[0m", "MicroApp Started & But could not connect Cluster");
			}
			
			callback(BROKER_CONNECTED);
		})

		return broker;
	}
}

function getLocalServiceNames(broker) {
	const list = broker.registry.getServiceList({ onlyLocal: true });
	return list.map(svc => svc.name);
}