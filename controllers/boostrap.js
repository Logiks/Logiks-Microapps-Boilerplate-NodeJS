//For Starting the Plugin

const { ServiceBroker } = require("moleculer");
// const { Errors } = require("moleculer");
// const { MoleculerClientError } = Errors;
const { MoleculerError } = require("moleculer").Errors;
const os = require("os");
const fsPromise = require("fs").promises;

// Blue/Green deployment flag: "blue" or "green"
const WORKER_COLOR = process.env.WORKER_COLOR || "blue";

// Heartbeat interval
const HEARTBEAT_INTERVAL_MS = 10_000;

//Error Controller
class LogiksError extends MoleculerError {
  constructor(message = "Internal only action") {
    super(message, 403, "INTERNAL_ONLY");
    this.name = "LogiksError";
  }
}
global.LogiksError = LogiksError;

const PLUGIN_CATALOG = {};
const APPINDEX = {
    "CONTROLLERS":{},
    "PROCESSORS": {},
    "DATA": {},
    "ROUTES": {}
};

module.exports = {

	initialize: async function() {
        console.log("\n\x1b[32m%s\x1b[0m","MicroApp Initialization Completed");
    },

	loadPlugins: async function() {
		//Catalog the plugins folder
		var plugins = await fsPromise.readdir(LOGIKS_CONFIG.ROOT_PATH+"/plugins/", { withFileTypes: true });
		plugins = JSON.parse(JSON.stringify(plugins));
		plugins = plugins.filter(a=>(a.name[0]!="." && ["z", "x", "temp"].indexOf(a.name.split("_")[0])<0));//.map(a=>{a.name, a.path});

		await loadPluginCatalog(plugins);

		// console.log("plugins", plugins, JSON.stringify(PLUGIN_CATALOG, "\n", 2));

		console.log("\n\x1b[32m%s\x1b[0m","Plugin Catalog Initalized and Loaded");
	},

	connect: async function() {
		const broker = new ServiceBroker({
			nodeID: process.env.NODE_ID || `remote-worker-${os.hostname()}-${process.pid}`,
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

		//Loading all Plugins and its Services
		await activatePlugins(broker);
		
		function getLocalServiceNames() {
			const list = broker.registry.getServiceList({ onlyLocal: true });
			return list.map(svc => svc.name);
		}

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
				services: getLocalServiceNames(),
				menus: await buildAllMenusObject()
			};

			let attempt = 0;

			while (true) {
				attempt++;
				try {
					await broker.call("system.registerWorker", payload, {
						timeout: 5000,
						retries: 0
					});

					broker.logger.info("Worker successfully registered with main broker", payload);
					break;
				} catch (err) {
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

		// Start worker
		broker.start().then(async () => {
			broker.logger.info("MicroApp Started & Connected to Cluster");
			console.log("\n\x1b[34m%s\x1b[0m", "MicroApp Started & Connected to Cluster");

			await registerWithMainBroker();   // Startup registration
			startHeartbeat();                 // Start health pings

			// Now hook transporter reconnect events
			setupReconnectListener();

			// broker.call("demo.find", { a: 5, b: 3 }).then(a=>console.log(`DEMO FIND`, a))
			return 0;
		}).catch(err => console.error(`Error occured! ${err.message}`));
	}
}

async function loadPluginCatalog(plugins) {
  for (const pluginObj of plugins) {
    const pluginName = pluginObj.name;

    PLUGIN_CATALOG[pluginName] = await catalogPlugins(
      LOGIKS_CONFIG.ROOT_PATH + `/plugins/${pluginName}/`
    );
  }
}

async function catalogPlugins(dirPath, depth = 0, returnTree = false) {
	if(depth>1) return false;
	const entries = await fsPromise.readdir(dirPath, { withFileTypes: true });

	// Skip anything starting with z_ or x_
	const filtered = entries.filter(a=>(a.name[0]!="." && ["z", "x", "temp"].indexOf(a.name.split("_")[0])<0));

	// Sort: files first, then folders (alphabetical inside each group)
	filtered.sort((a, b) => {
		if (a.isFile() && b.isDirectory()) return -1;
		if (a.isDirectory() && b.isFile()) return 1;
		return a.name.localeCompare(b.name);
	});

	const tree = [];
	const list = {};

	for (const entry of filtered) {
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			const children = await catalogPlugins(fullPath, depth+1);
			list[entry.name] = Object.values(children);
			tree.push({
				type: "folder",
				name: entry.name,
				path: fullPath,
				children
			});
		} else if (entry.isFile()) {
			list[entry.name.replace(/.json/, '').replace(/.js/, '')] = entry.name;
			tree.push({
				type: "file",
				name: entry.name,
				path: fullPath
			});
		}
	}
	if(returnTree) return tree;
	return list;
}

async function buildAllMenusObject() {
  const tasks = Object.entries(PLUGIN_CATALOG).flatMap(
    ([pluginName, pluginData]) =>
      (pluginData.menus || []).map(menu => ({
        pluginName,
        menu
      }))
  );

  const results = await Promise.all(
    tasks.map(async ({ pluginName, menu }) => {
      const content = await fetchFile(pluginName, "menus", menu);
      return [`${pluginName}-${menu}`, content]; // [key, value]
    })
  );

  return Object.fromEntries(results);
}

async function fetchFile(pluginID, folder, file) {
	const srcFile = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginID}/${folder}/${file}`;
	if(fs.existsSync(srcFile)) {
		try {
			const temp = JSON.parse(fs.readFileSync(srcFile, "utf8"));
			return temp;
		} catch(e) {
			return false;
		}
	} return false;
}

async function activatePlugins(broker) {
	//console.log("PLUGIN_CATALOG", PLUGIN_CATALOG);

	const plugins = Object.keys(PLUGIN_CATALOG);
	for(i=0;i<plugins.length;i++) {
		const pluginID = plugins[i];
		const pluginConfig = PLUGIN_CATALOG[pluginID];
		// console.log("PLUGIN", pluginID, pluginConfig);

		//To Activate below files + other services
		//api
		const apiFile = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginID}/api.js`;
		if(fs.existsSync(apiFile)) {
			try {
				APPINDEX.CONTROLLERS[pluginID.toUpperCase()] = require(apiFile);
			} catch(e) {
				console.error(e);
			}
		}

		//routes
		const routeFile = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginID}/routes.json`;
		if(fs.existsSync(routeFile)) {
			try {
				const tempConfig = JSON.parse(fs.readFileSync(routeFile, "utf8"));
				loadPluginRoutes(broker, pluginID, tempConfig);
			} catch(e) {
				console.error(e);
			}
		}
		//service
	}

	console.log("\n\x1b[34m%s\x1b[0m", "All Plugins Loaded and Activated");
}

function loadPluginRoutes(broker, pluginName, routeConfig) {
	const serviceSchema = {
		name: pluginName,
		actions: {},
		methods: {}
	};

	// console.log("routeConfig", routeConfig);
	if(routeConfig.enabled) {
		_.each(routeConfig.routes, function(conf, path) {
			var rPath = `/${pluginName}${path}`;
			if(conf.method==null) conf.method = "GET";

			if(!conf.params) conf.params = {};

			//generateNewAction(conf, rPath);
			rPath = rPath.replaceAll(/\//g,"_").replace(/:/g,'');
			if(rPath[0]=="_") rPath = rPath.substring(1);

			serviceSchema.actions[rPath] = {
					rest: {
						method: conf.method.toUpperCase(),
						path: path
					},
					params: conf.params,
					async handler(ctx) {
						// console.log("ROUTE_REMOTE", conf.data);
						// return {"status": "okay", "results": conf};

						return runAction(ctx, conf, path, rPath);
					}
				}
		})
	} else {
		console.log(`Route Not Enabled for ${pluginID}`);
	}
	
	serviceSchema.actions["source"] = {
		rest: {
			method: "GET",
			path: "/source"
		},
		params: {
			file: "string",
			folder: "string",
		},
		async handler(ctx) {
			// console.log("ROUTE_REMOTE", ctx.params);
			
			var ext = ctx.params.file.split(".");
			ext = ext[ext.length-1];
			
			const sourceFile = `plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file}`;
			
			// console.log("sourceFile", sourceFile);
			if(fs.existsSync(sourceFile)) {
				const sourceData = fs.readFileSync(sourceFile, "utf8");
				try {
					if(ext=="json") {
						const temp = JSON.parse(sourceData);
						if(temp) sourceData = temp;
					}
				} catch(e) {}
				return sourceData;
			} else {
				throw new LogiksError(
					"Invalid Source File",
					404,
					"INVALID_SOURCE_FILE",
					ctx.params
				);
			}
		}
	}

	// console.log("XXXX", JSON.stringify(serviceSchema, "\n", 2));

	broker.createService(serviceSchema);
}

async function _helper(ctx, ...args) {
	return await ctx.call(args);
}

async function runAction(ctx, config, path, rPath) {
	var METHOD_TYPE = "DATA";//DATA, ERROR, CONTROLLER
	var METHOD_PARAMS = {};
	const method = config.method;
	
	//Process CONFIG Setup
	switch(typeof config.data) {
		case "string":
			var METHOD = config.data.split(".");
			METHOD[0] = METHOD[0].toUpperCase();

			if(APPINDEX.CONTROLLERS[METHOD[0]]!=null) {
				if(APPINDEX.CONTROLLERS[METHOD[0]][METHOD[1]]!=null) {
					// console.log("METHOD FOUND", APPINDEX.CONTROLLERS[METHOD[0]][METHOD[1]]);

					METHOD_TYPE = "CONTROLLER";
					METHOD_PARAMS = APPINDEX.CONTROLLERS[METHOD[0]][METHOD[1]];

				} else {
					console.log("\x1b[31m%s\x1b[0m", `\nController Method ${METHOD[0]}.${METHOD[1]} not found for ROUTE-${rPath}`);
					// if(CONFIG.strict_routes) return;

					METHOD_TYPE = "ERROR";
					METHOD_PARAMS = `Controller Method ${METHOD[0]}.${METHOD[1]} not found`;
				}
			} else {
				console.log("\x1b[31m%s\x1b[0m", `\nController ${METHOD[0]} not found for ROUTE-${rPath}`);
				// if(CONFIG.strict_routes) return;

				METHOD_TYPE = "ERROR";
				METHOD_PARAMS = `Controller Method ${METHOD[0]}.${METHOD[1]} not found`;
			}
		break;
		default:
			METHOD_TYPE = "DATA";
			METHOD_PARAMS = config.data;
	}

	APPINDEX.ROUTES[`${method}::${rPath}`] = config;

	// console.info("runAction>>", METHOD_TYPE, METHOD_PARAMS, path, rPath, method, config, `${method}::${rPath}`);

	switch(METHOD_TYPE) {
		case "CONTROLLER":
			var data = await METHOD_PARAMS(_.extend({}, ctx.params, ctx.query));

			if(config.processor && config.processor.length>0 && config.processor.split(".").length>1) {
				const processorObj = config.processor.split(".");
				if(APPINDEX.PROCESSORS[processorObj[0].toUpperCase()] && typeof APPINDEX.PROCESSORS[processorObj[0].toUpperCase()][processorObj[1]]=="function") {
					data = APPINDEX.PROCESSORS[processorObj[0].toUpperCase()][processorObj[1]](data, config, ctx);
				}
			}

			return data;
			break;
		case "DATA":
			return METHOD_PARAMS;
			break;
		case "ERROR":
			return METHOD_PARAMS;
			break;
		default:
	}

	return false;
}

//For Future Usage
function generateController(controllerID, controllerConfig) {
    var newController = {};

    _.each(controllerConfig, function(confOri, funcKey) {
        newController[funcKey] = function(params, callback) {
            var conf = _.cloneDeep(confOri);
            // console.log("GENERATED_CONTROLLER", funcKey, params, conf, confOri, controllerConfig[funcKey]);

            switch(conf.type) {
                case "sql":
                    //console.log("conf", conf.where);
                    var additionalQuery = "";
                    if(conf.group_by) additionalQuery += ` GROUP BY ${conf.group_by}`;
                    if(conf.order_by) additionalQuery += ` ORDER BY ${conf.order_by}`;

                    if(!conf.where) conf.where = {};
                    _.each(conf.where, function(v,k) {
                        conf.where[k] = _replace(v, params);
                    })

                    db_selectQ("appdb", conf.table, conf.columns, conf.where, {}, function(data, errorMsg) {
                        // console.log("XXXXXXX", data, errorMsg);
                        if(errorMsg) callback([], "", errorMsg);
                        else callback(data, "");
                    }, additionalQuery);
                    break;
                default:
                    callback(false, "", "Controller Not Found");
            }
        }
    });

    return newController;
}
