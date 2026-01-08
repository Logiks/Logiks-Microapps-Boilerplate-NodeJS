//All Connections and features available on the Main AppServer or across other applications should be available here

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
            global[helperId] = new UniversalAPI(helperId);
        });
        _.each(controllerList, function(controllerId, k) {
            CONTROLLER_LIST.push(controllerId);
            global[controllerId] = new UniversalAPI(controllerId);
        });

        // console.log("HELPER_LIST", HELPER_LIST);
        // console.log("CONTROLLER_LIST", CONTROLLER_LIST);
        
        log_info("CONNECTED_NODES", await listNodes());
    }
}

global.log_info = function(...args) {
    MAIN_BROKER.logger.info(...args);
}

global.log_warn = function(...args) {
    MAIN_BROKER.logger.info(...args);
}

global.log_error = function(...args) {
    MAIN_BROKER.logger.info(...args);
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
        console.error("ERROR CALLING HELPERS", data.message);
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
        console.error("ERROR CALLING CONTROLLER", data.message);
        return false;
    }
}
//call any plugin api or services from across any other plugin or part of system
global._call = async function(serviceString, ...args) {
    log_info("CALLING_SERVICE", serviceString);

    try {
        const response = await MAIN_BROKER.call(serviceString, args, {
                timeout: 5000,
                retries: 0
            });
        
        return response;
    } catch(err) {
        console.error(err);
        return null;
    }
}

global.listNodes = async function() {
    const nodes = await BASEAPP.getBroker().call("$node.list");
    return nodes.map(n => n.id);
}

//Class used for making universal access for functions available int the AppServer
class UniversalAPI {
  constructor(helperId) {
    return new Proxy(this, {
      get: (target, prop) => {
        return (...args) => target.handle(helperId, prop, ...args);
      }
    });
  }

  async handle(helperId, method, ...args) {
    // console.log("Method:", method);
    // console.log("Args:", args);
    // console.log("Helper:", helperId);

    const helperString = `${helperId}.${method}`;
    //return `Handled ${method}`;
    
    return _helper(helperString, ...args);
  }
}