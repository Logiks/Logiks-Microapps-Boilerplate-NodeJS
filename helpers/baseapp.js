//All Connections and features available on the Main AppServer or across other applications should be available here

var MAIN_BROKER = null;

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
        log_info("HELPERS_ON_SERVER", helperList);

        _.each(helperList, function(helperId, k) {
            global[helperId] = new UniversalAPI(helperId);
        });

        
        log_info("CONNECTED_NODES", listNodes());
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