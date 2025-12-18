//Plugin Management

const fsPromise = require("fs").promises;

const PLUGIN_CATALOG = {};
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

    loadPlugins: async function(broker) {
        //Catalog the plugins folder
        var plugins = await fsPromise.readdir(LOGIKS_CONFIG.ROOT_PATH+"/plugins/", { withFileTypes: true });
        plugins = JSON.parse(JSON.stringify(plugins));
        plugins = plugins.filter(a=>(a.name[0]!="." && ["z", "x", "temp"].indexOf(a.name.split("_")[0])<0));//.map(a=>{a.name, a.path});

        await loadPluginCatalog(plugins);

        //console.log("plugins", plugins, JSON.stringify(PLUGIN_CATALOG, "\n", 2));

        console.log("\n\x1b[32m%s\x1b[0m","Plugin Catalog Initalized and Loaded");
    },

    //Loading all Plugins and its Services
    activatePlugins: async function(broker) {
        const plugins = Object.keys(PLUGIN_CATALOG);
        for(i=0;i<plugins.length;i++) {
            const pluginID = plugins[i];
            const pluginConfig = PLUGIN_CATALOG[pluginID];

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
            } else {
                loadPluginRoutes(broker, pluginID, {
                    "enabled": true,
                    "routes": {}
                });
            }
            //service
        }

        console.log("\n\x1b[34m%s\x1b[0m", "All Plugins Loaded and Activated");
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
		methods: {}
	};

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
						return runAction(ctx, conf, path, rPath);
					}
				}
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
		},
		async handler(ctx) {
			var ext = ctx.params.file.split(".");
			ext = ext[ext.length-1];
			
			const sourceFile = `plugins/${pluginName}/${ctx.params.folder}/${ctx.params.file}`;
			
			if(fs.existsSync(sourceFile)) {
				var sourceData = fs.readFileSync(sourceFile, "utf8");
				try {
					if(ext=="json") {
						const temp = JSON.parse(sourceData);
						if(temp) sourceData = temp;
					}
				} catch(e) {console.error(e)}
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
					// console.log("METHOD FOUND", APPINDEX.CONTROLLERS[METHOD[0]][METHOD[1]]);

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
			log_info("GENERATED_CONTROLLER", funcKey);
            //console.log("GENERATED_CONTROLLER", funcKey, params, conf, confOri, controllerConfig[funcKey]);

            switch(conf.type) {
                case "sql":
                    var additionalQuery = "";
                    if(conf.group_by) additionalQuery += ` GROUP BY ${conf.group_by}`;
                    if(conf.order_by) additionalQuery += ` ORDER BY ${conf.order_by}`;

                    if(!conf.where) conf.where = {};
                    _.each(conf.where, function(v,k) {
                        conf.where[k] = _replace(v, params);
                    })

                    db_selectQ("appdb", conf.table, conf.columns, conf.where, {}, function(data, errorMsg) {
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
