//All Connections and features available on the Main AppServer or across other applications should be available here

const fsPromise = require("fs").promises;

var MAIN_BROKER = null;
var HELPER_LIST = [];
var CONTROLLER_LIST = [];

module.exports = {

	initialize: function() {
        
    },

    getBroker: function() {
        return MAIN_BROKER;
    },

    connect: async function(broker) {
        MAIN_BROKER = broker;

        //Availing Local mapping to AppServer Helpers
        const helperList = await _helper("list_helpers");
        const controllerList = await _controller("list_controllers");
        log_info("HELPERS_ON_SERVER", helperList);
        log_info("CONTROLLERS_ON_SERVER", controllerList);

        if(HELPER_LIST && HELPER_LIST.length>0) {
            _.each(HELPER_LIST, function(helperId, k) {
                try {
                    delete global[helperId];
                    delete HELPER_LIST[k];
                } catch(e) {}
            })
        }
        if(CONTROLLER_LIST && CONTROLLER_LIST.length>0) {
            _.each(CONTROLLER_LIST, function(controllerId, k) {
                try {
                    delete global[controllerId];
                    delete CONTROLLER_LIST[k];
                } catch(e) {}
            })
        }
        HELPER_LIST = Object.values(HELPER_LIST);
        CONTROLLER_LIST = Object.values(CONTROLLER_LIST);

        _.each(helperList, function(helperId, k) {
            HELPER_LIST.push(helperId);
            global[helperId] = new UniversalAPI(helperId, "helper");
        });
        _.each(controllerList, function(controllerId, k) {
            CONTROLLER_LIST.push(controllerId);
            global[controllerId] = new UniversalAPI(controllerId, "controller");
        });

        // console.log("HELPER_LIST", HELPER_LIST);
        // console.log("CONTROLLER_LIST", CONTROLLER_LIST);
        
        log_info("CONNECTED_NODES", await listNodes());
    },

    runPluginMigration: async function() {
        console.log("\n\x1b[33m%s\x1b[0m", `Starting DB-Migration for this Microapp`);
        const pluginList = PLUGINS.listPlugins();
        for(i=0;i<pluginList.length;i++) {
            const pluginID = pluginList[i];

            var dbSchemaDir = LOGIKS_CONFIG.ROOT_PATH+`/plugins/${pluginID}/dbschema/`;
            try {
                await fsPromise.mkdir(dbSchemaDir,true);
            } catch(e) {}

			var dbSchemaFiles = false;
			if(fs.existsSync(dbSchemaDir)) {
				try {
                    const files = await fsPromise.readdir(dbSchemaDir, { withFileTypes: true });
                    // files = JSON.parse(JSON.stringify(files));
                    const matched = files
                            .filter(f => f.name.startsWith(`schema_`)  && f.name.endsWith(".json"))
                            .map(f => ({
                                name: f.name,
                                time: fs.statSync(path.join(dbSchemaDir, f.name)).mtimeMs
                            }));
                    if (matched.length>0) {
                        matched.sort((a, b) => b.time - a.time);

                        dbSchemaFiles = matched[0];

                        dbSchemaFiles = await fsPromise.readFile(path.join(dbSchemaDir,dbSchemaFiles.name), "utf8");
                        dbSchemaFiles = JSON.parse(dbSchemaFiles);
                    }
                } catch(e) {
                    dbSchemaFiles = false;
                }
			}
			var pluginDBSchema = await DBMIGRATOR.pluginMigration(pluginID, dbSchemaFiles);
            try {
                switch(pluginDBSchema.mode) {
                    case "EXPORT":
                        const filename = `schema_${process.env.BUILD?process.env.BUILD:"0000"}.json`;//${Date.now()}
                        const filepath = path.join(dbSchemaDir, filename);
                        await fsPromise.writeFile(filepath, JSON.stringify(pluginDBSchema.schema, "\n", "\t"));

                        console.log("\x1b[32m%s\x1b[0m", `Migration Completed for ${pluginID} in ${pluginDBSchema.mode} Mode @${filename}`);
                        log_info(`Migration Completed for ${pluginID} in ${pluginDBSchema.mode} Mode`);
                        break;
                    case "IMPORT":
                        console.log("\x1b[32m%s\x1b[0m", `Migration Completed for ${pluginID} in ${pluginDBSchema.mode} Mode :: ${pluginDBSchema.message}`);
                        log_info(`Migration Completed for ${pluginID} in ${pluginDBSchema.mode} Mode :: ${pluginDBSchema.message}`);
                        break;
                    default:
                        log_info("Running Migration - Mode Not Supported");
                }
            } catch(e) {
                console.error(e);
            }
        }
        console.log("\x1b[33m%s\x1b[0m\n", `Completed DB-Migration for this Microapp`);
    }
}

global.log_debug = function(...args) {
    //console.debug(...args);
    if(MAIN_BROKER) MAIN_BROKER.logger.debug(...args);
    else console.debug(...args);
}

global.log_info = function(...args) {
    //console.info(...args);
    if(MAIN_BROKER) MAIN_BROKER.logger.info(...args);
    else console.info(...args);
}

global.log_warn = function(...args) {
    //console.warn(...args);
    if(MAIN_BROKER) MAIN_BROKER.logger.info(...args);
    else console.warn(...args);
}

global.log_error = function(...args) {
    //console.error(...args);
    if(MAIN_BROKER) MAIN_BROKER.logger.info(...args);
    else console.error(...args);
}


//calling list_helpers -> gives the list of all available helpers
//const a = await _helper("_DB.db_query", "SHOW TABLES");
global._helper = async function(helperString, ...args) {
    if(!MAIN_BROKER) {
        throw new Error("MAIN BASE APP is not connected");
    }
    var payload = {
        "cmd": helperString,
        "params": args
    };
    log_info("CALLING_HELPER", helperString);
    const data = await MAIN_BROKER.call("system.helpers", payload, {
            timeout: 5000,
            retries: 0
        });
    if(data.status=="success") {
        return data.data;
    } else {
        log_error("ERROR CALLING HELPERS", data.message);
        return false;
    }
}
//call controllers available in the server
global._controller = async function(cmdString, ...args) {
    if(!MAIN_BROKER) {
        throw new Error("MAIN BASE APP is not connected");
    }
    var payload = {
        "cmd": cmdString,
        "params": args
    };
    log_info("CALLING_CONTROLLER", cmdString);
    const data = await MAIN_BROKER.call("system.controllers", payload, {
            timeout: 5000,
            retries: 0
        });
    if(data.status=="success") {
        return data.data;
    } else {
        log_error("ERROR CALLING CONTROLLER", data.message);
        return false;
    }
}
//call any plugin api or services from across any other plugin or part of system
global._call = async function(serviceString, ...args) {
    log_info("CALLING_SERVICE", serviceString);

    try {
        const response = await MAIN_BROKER.call(serviceString, ...args, {
                timeout: 5000,
                retries: 0
            });
        
        return response;
    } catch(err) {
        log_error(err);
        return null;
    }
}

global.listNodes = async function() {
    const nodes = await BASEAPP.getBroker().call("$node.list");
    return nodes.map(n => n.id);
}

//Class used for making universal access for functions available int the AppServer
class UniversalAPI {
  constructor(helperId, apiType) {
    return new Proxy(this, {
      get: (target, prop) => {
        if(apiType=="helper")
            return (...args) => target.handleHelper(helperId, prop, ...args);
        else if(apiType=="controller")
            return (...args) => target.handleController(helperId, prop, ...args);
        else
            return false;
      }
    });
  }

  async handleHelper(helperId, method, ...args) {
    // console.log("Method:", method);
    // console.log("Args:", args);
    // console.log("Helper:", helperId);

    const helperString = `${helperId}.${method}`;
    //return `Handled ${method}`;
    
    return _helper(helperString, ...args);
  }

  async handleController(helperId, method, ...args) {
    // console.log("Method:", method);
    // console.log("Args:", args);
    // console.log("Helper:", helperId);

    const helperString = `${helperId}.${method}`;
    //return `Handled ${method}`;
    
    return _helper(helperString, ...args);
  }
}