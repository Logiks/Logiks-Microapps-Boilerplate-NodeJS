/*
 * The starting file for the microapp service, this loads all other required files and initiates the processes.
 * 
 * @author : Bismay <bismay@smartinfologiks.com>
 * */
require("dotenv").config();

global._ENV = {SERVICES:[], HELPERS: [], CONTROLLERS: []};

global._ = require("lodash");
global.fs = require("fs");
global.path = require("path");
global.axios = require("axios");
global.moment = require("moment");

global.LOGIKS_CONFIG = JSON.parse(fs.readFileSync("./logiks.json", "utf8"));
LOGIKS_CONFIG.ROOT_PATH = __dirname;

//console.log(LOGIKS_CONFIG);

//Load all helpers
fs.readdirSync('./helpers/').forEach(function(file) {
    if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
        var filePath = path.resolve('./helpers/' + file);
        var clsName = file.replace('.js','').toUpperCase();

        _ENV.HELPERS.push(clsName);
        global[clsName] = require(filePath);
    }
});

//Load all controllers
fs.readdirSync('./controllers/').forEach(function(file) {
    if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
        var filePath = path.resolve('./controllers/' + file);
        var clsName = file.replace('.js','').toUpperCase();

        _ENV.CONTROLLERS.push(clsName);
        global[clsName] = require(filePath);

        if(typeof global[clsName]["initialize"] == "function") {
            global[clsName].initialize(this);
        }
    }
});

async function main() {
    const broker = await BOOSTRAP.start();

    await PLUGINS.loadPlugins(broker);
    await PLUGINS.activatePlugins(broker);
    
    BOOSTRAP.connect(broker, async function(connected) {
        if(connected) {
            //Connected to appserver
        } else {
            //Failed to connect to appserver
        }
    });
}

//starting the application service
main();
