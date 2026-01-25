//Plugin Management

const fsPromise = require("fs").promises;
const Module = require("module");
const path = require("path");
const { execSync } = require("child_process");

var PLUGIN_REQUIRE = false;

const PLUGIN_CATALOG = {};
const PLUGIN_CONFIGS = {};
const APPINDEX = {
    "CONTROLLERS":{},
    "PROCESSORS": {},
    "DATA": {},
    "ROUTES": {}
};

module.exports = {

	initialize: async function() {
        
    },

    getMenus: async function() {
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
    },

	listPlugins: function() {
		return Object.keys(PLUGIN_CATALOG);
	},

	getPluginRequire: function(pkgId) {
		return PLUGIN_REQUIRE(pkgId);
	},

    loadPlugins: async function(broker) {
        //Catalog the plugins folder
        var plugins = await fsPromise.readdir(LOGIKS_CONFIG.ROOT_PATH+"/plugins/", { withFileTypes: true });
        plugins = JSON.parse(JSON.stringify(plugins));
        plugins = plugins.filter(a=>(a.name[0]!="." && ["z", "x", "temp"].indexOf(a.name.split("_")[0])<0));//.map(a=>{a.name, a.path});

		await loadPluginCatalog(plugins);

		console.log("\n\x1b[32m%s\x1b[0m","Plugin Catalog Initalized and Loaded");
    },

	checkDependencies: async function(broker) {
		if(process.env.ENABLE_PLUGINS_INSTALL_DEPS!=="true") {
			console.log("\n\x1b[31m%s\x1b[0m", "Plugin Dependecies loading is disabled");
			return;
		}

		const plugins = Object.keys(PLUGIN_CATALOG);
		const deps = {};
		for(i=0;i<plugins.length;i++) {
			const pluginID = plugins[i];
            // const pluginCatalog = PLUGIN_CATALOG[pluginID];
			const pluginConfig = PLUGIN_CONFIGS[pluginID];

			if(pluginConfig.CONFIG.dependencies) {
				Object.assign(deps, pluginConfig.CONFIG.dependencies || {});
			}
		}
		await installDeps(deps);

		PLUGIN_REQUIRE = Module.createRequire(
				path.resolve("./plugins/package.json")
			);

		console.log("\n\x1b[32m%s\x1b[0m","Plugin Dependecies installed and Loaded");
	},

    //Loading all Plugins and its Services
    activatePlugins: async function(broker) {
        const plugins = Object.keys(PLUGIN_CATALOG);
        for(i=0;i<plugins.length;i++) {
            const pluginID = plugins[i];
            const pluginConfig = PLUGIN_CATALOG[pluginID];

            //To Activate below files + other services
			console.log("\x1b[33m%s\x1b[0m", `Activating Plugin - ${pluginID}`);

			//api
            const apiFile = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginID}/api.js`;
            if(fs.existsSync(apiFile)) {
                try {
                    APPINDEX.CONTROLLERS[pluginID.toUpperCase()] = require(apiFile);
					global[pluginID.toUpperCase()] = APPINDEX.CONTROLLERS[pluginID.toUpperCase()];
                } catch(e) {
                    log_error(e);
                }
            }

            //routes
            const routeFile = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginID}/routes.json`;
            if(fs.existsSync(routeFile)) {
                try {
                    const tempConfig = JSON.parse(fs.readFileSync(routeFile, "utf8"));
                    loadPluginRoutes(broker, pluginID, tempConfig);
                } catch(e) {
                    log_error(e);

					loadPluginRoutes(broker, pluginID, {
						"enabled": true,
						"routes": {}
					});
                }
            } else {
                loadPluginRoutes(broker, pluginID, {
                    "enabled": true,
                    "routes": {}
                });
            }
        }
        console.log("\n\x1b[34m%s\x1b[0m", "All Plugins Loaded and Activated");
    }
}

async function loadPluginCatalog(plugins) {
  	for (const pluginObj of plugins) {
    	const pluginName = pluginObj.name;

		if(["node_modules", "package-lock.json", "package.json"].includes(pluginName)) continue;
		if(["z", "x", "y"].includes(pluginName.split("_")[0])) continue;

		var logiksConfig = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginName}/logiks.json`;
		if(!fs.existsSync(logiksConfig)) {
			// delete PLUGIN_CATALOG[pluginName];
			console.log("\n\x1b[31m%s\x1b[0m", `Plugin not loaded ${pluginName} due to missing config - logiks.json`);
			continue;
		}

		//Load Logiks.json
		try {
			const tempConfig = JSON.parse(fs.readFileSync(logiksConfig, "utf8"));
			logiksConfig = tempConfig;
		} catch(e) {
			// delete PLUGIN_CATALOG[pluginName];
			console.log("\n\x1b[31m%s\x1b[0m", `Plugin not loaded ${pluginName} due to corrupt config - logiks.json`, e);
			continue;
		}


    	PLUGIN_CATALOG[pluginName] = await catalogPlugins(
      		LOGIKS_CONFIG.ROOT_PATH + `/plugins/${pluginName}/`
    	);
		const pluginConfig = PLUGIN_CATALOG[pluginName];
		
		PLUGIN_CONFIGS[pluginName] = {
			"CONFIG": logiksConfig,
			"CATALOG": pluginConfig
		};
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

function loadPluginRoutes(broker, pluginName, routeConfig) {
	// if (!broker.getLocalService(pluginName)) {
	// 	throw new LogiksError(
	// 		"Plugin With Same Name Already Exists - "+pluginName,
	// 		501,
	// 		"INVALID_PLUGIN_NAME",
	// 		pluginName
	// 	);
	// }
	
	const serviceSchema = {
		name: pluginName,
		actions: {},
		methods: {},
		events: {}
	};

	if(routeConfig.enabled) {
		_.each(routeConfig.routes, function(conf, path) {
			var rPath = `/${pluginName}${path}`;
			if(conf.method==null) conf.method = "GET";

			if(!conf.params) conf.params = {};

			//generateNewAction(conf, rPath);
			rPath = rPath.replaceAll(/\//g,"_").replace(/:/g,'');
			if(rPath[0]=="_") rPath = rPath.substring(1);
			if(rPath.substring(rPath.length-1,rPath.length)=="_") rPath = rPath.substring(0,rPath.length-1);

			const tempConfig = {
				rest: {
					method: conf.method.toUpperCase(),
					// path: path,
					// fullPath: `/api/${pluginName}${path}`
					fullPath: `/api/services/${pluginName}${path}`
				},
				async handler(ctx) {
					return {
						"status": "okay",
						"results": await runAction(ctx, conf, path, rPath)
					};
				}
			}
			//console.log(">>>", `/api/services/${pluginName}${path}`);
			if(conf.params) tempConfig.params = conf.params;
			if(conf.meta) tempConfig.meta = conf.meta;
			if(conf.cache) tempConfig.cache = conf.cache;
			if(conf.description) tempConfig.description = conf.description;
			
			serviceSchema.actions[rPath] = tempConfig;

			// log_info(rPath, path, serviceSchema.actions[rPath]);
		})
	} else {
		log_info(`Route Not Enabled for ${pluginID}`);
	}

	serviceSchema.actions["source"] = {
		rest: {
			method: "GET",
			path: "/source"
		},
		params: {
			file: "string",
			folder: "string",
			silent: { type: "boolean", optional: true },
		},
		async handler(ctx) {
			// var ext = ctx.params.file.split(".");
			// ext = ext[ext.length-1];
			if(ctx.params.silent===null) ctx.params.silent = false;
			
			// console.log("SOURCE_CALLED", pluginName, ctx.params);
			log_info("SOURCE_CALLED", pluginName, ctx.params);

			const FILES = [
				`plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file}`,
				`plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file.replace('.js', ".jsx")}`,
				`plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file.replace('_mapp', '')}`,
				`plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file.replace('_mapp', '').replace('.js', ".jsx")}`,
			].filter((value, index, self) => {
				return self.indexOf(value) === index;
			});
			// log_info("FILES", FILES);
			
			if(ctx.params.params.rebuild || ctx.params.params.rebuild==="true") {
				if(fs.existsSync(FILES[1])) FILES[0] = FILES[0]+"_1";
				if(FILES[2] && fs.existsSync(FILES[3])) FILES[2] = FILES[2]+"_1";
			}
			// console.log("FILES", FILES, ctx.params);
			
			for(let i=0;i<FILES.length;i++) {
				if(fs.existsSync(FILES[i])) {
					//Add Cachng Here if needed
					var ext = FILES[i].split(".");
          			ext = ext[ext.length - 1];

					switch(ext) {
						case "jsx":
							const jsContent = JITCOMPILER.compileJSX(FILES[i]);

							return jsContent;
							break;
						case "json":
							var sourceData = fs.readFileSync(FILES[i], "utf8");
							try {
								const temp = JSON.parse(sourceData);
								if(temp) sourceData = temp;
							} catch(e) {log_error(e)}
							try {
								const fileScript = `plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file.replace('.json', '.js')}`;
								if(fs.existsSync(fileScript)) {
									var scriptData = fs.readFileSync(fileScript, "utf8");
									sourceData.script = Buffer.from(scriptData).toString('base64');
								}
							} catch(e) {}
							return sourceData;
							break;
						default:
							var sourceData = fs.readFileSync(FILES[i], "utf8");
							return sourceData;
					}
				}
			}
			if(ctx.params.silent===false) {
				throw new LogiksError(
					"Invalid Source File",
					404,
					"INVALID_SOURCE_FILE",
					ctx.params
				);
			}
			

			// var sourceFile = `plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file}`;
			// var sourceFile_JSX = `plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file}`.replace('.js', ".jsx");
			
			// if(ctx.params.params.rebuild || ctx.params.params.rebuild==="true") {
			// 	if(fs.existsSync(sourceFile_JSX)) {
			// 		sourceFile = sourceFile+1;
			// 	}
			// }

			// if(fs.existsSync(sourceFile)) {
			// 	var sourceData = fs.readFileSync(sourceFile, "utf8");
			// 	try {
			// 		if(ext=="json") {
			// 			const temp = JSON.parse(sourceData);
			// 			if(temp) sourceData = temp;
			// 		}
			// 	} catch(e) {log_error(e)}
			// 	return sourceData;
			// } else if(fs.existsSync(sourceFile_JSX)) {
			// 	const jsContent = JITCOMPILER.compileJSX(sourceFile_JSX);

			// 	return jsContent;
			// } else {
			// 	throw new LogiksError(
			// 		"Invalid Source File",
			// 		404,
			// 		"INVALID_SOURCE_FILE",
			// 		ctx.params
			// 	);
			// }
		}
	}

	serviceSchema.actions["www"] = {
		rest: {
			method: "GET",
			path: "/www"
		},
		params: {
			file: "string",
			folder: "string",
		},
		async handler(ctx) {
			var ext = ctx.params.file.split(".");
			ext = ext[ext.length-1];

			if(ctx.params.folder && ctx.params.folder.length>0) {
				const sourceFile = `plugins/${pluginName}/www/${ctx.params.folder}/${ctx.params.file}`;
			
				if(fs.existsSync(sourceFile)) {
					var sourceData = fs.readFileSync(sourceFile, "utf8");
					return sourceData;
				} else {
					return "";
				}
			} else {
				const sourceFile = `plugins/${pluginName}/www/${ctx.params.file}`;
			
				if(fs.existsSync(sourceFile)) {
					var sourceData = fs.readFileSync(sourceFile, "utf8");
					return sourceData;
				} else {
					return "";
				}
			}
		}
	}

	//add the api file functions to services for calling across system but don't expose them as API
	try {
		if(APPINDEX.CONTROLLERS[pluginName.toUpperCase()]) {
			Object.keys(APPINDEX.CONTROLLERS[pluginName.toUpperCase()]).forEach(a=>{
				serviceSchema.actions[a] = {
					rest: false,
					async handler(ctx) {
						return APPINDEX.CONTROLLERS[pluginName.toUpperCase()][a](ctx.params, ctx);
					}
				};
			})
		}
	} catch (err) {
		log_error(err)
	}

	//Event system
	try {
		if(routeConfig.events) {
			_.each(routeConfig.events, function(eventConf, eventKey) {
				if(eventConf.data!=null) {
					serviceSchema.events[eventKey] = {
						async handler(ctx) {
							// console.log("EVENT_LISTENER",pluginName, eventKey, eventConf, ctx);
							return await runAction(ctx, eventConf, eventKey, eventKey);
						}
					}
				}
			});
		}
	} catch (err) {
		log_error(err)
	}

	// log_info("PLUGIN", pluginName.toUpperCase(), serviceSchema);
	
	broker.createService(serviceSchema);
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
					// log_info("METHOD FOUND", APPINDEX.CONTROLLERS[METHOD[0]][METHOD[1]]);

					METHOD_TYPE = "CONTROLLER";
					METHOD_PARAMS = APPINDEX.CONTROLLERS[METHOD[0]][METHOD[1]];

				} else {
					log_error(`Controller Method ${METHOD[0]}.${METHOD[1]} not found for ROUTE-${rPath}`);
					// if(CONFIG.strict_routes) return;

					METHOD_TYPE = "ERROR";
					METHOD_PARAMS = `Controller Method ${METHOD[0]}.${METHOD[1]} not found`;
				}
			} else {
				log_error(`Controller ${METHOD[0]} not found for ROUTE-${rPath}`);
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

	// log_info("runAction>>", METHOD_TYPE, METHOD_PARAMS, path, rPath, method, config, `${method}::${rPath}`, _.extend({}, ctx.params, ctx.query));
	// log_info("runAction_CTX>>", ctx);

	switch(METHOD_TYPE) {
		case "CONTROLLER":
			var data = await METHOD_PARAMS(_.extend({}, ctx.params, ctx.query), ctx, config, path, rPath);

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
			log_info("GENERATED_CONTROLLER", funcKey);//, params, conf, confOri, controllerConfig[funcKey]

            switch(conf.type) {
                case "sql":
                    var additionalQuery = "";
                    if(conf.group_by) additionalQuery += ` GROUP BY ${conf.group_by}`;
                    if(conf.order_by) additionalQuery += ` ORDER BY ${conf.order_by}`;

                    if(!conf.where) conf.where = {};
                    _.each(conf.where, function(v,k) {
                        conf.where[k] = _replace(v, params);
                    })

                    _DB.db_selectQ("appdb", conf.table, conf.columns, conf.where, {}, function(data, errorMsg) {
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

async function installDeps(deps) {
	if(deps['core']) delete deps['core'];

	const pkg = {
		name: "plugin-runtime",
		private: true,
		dependencies: deps
	};

	fs.writeFileSync(
		"./plugins/package.json",
		JSON.stringify(pkg, null, 2)
	);

	execSync("npm install --only=prod", {
		cwd: "./plugins",
		stdio: "inherit"
	});
}