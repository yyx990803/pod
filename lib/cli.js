var fs     = require('fs'),
	path   = require('path'),
	spawn  = require('child_process').spawn,
	argv   = require('optimist').argv,
	colors = require('colors')
	api    = require('./core').initCLI()

var globalConfigPath = process.env.HOME + '/.podrc'

var cli    = {

	help: function () {
	    console.log(fs.readFileSync(__dirname + '/../help/usage', 'utf-8'))
	},

	config: function () {
	    edit(globalConfigPath)
	},

	create: function (appname) {
	    if (!appname) return
	    api.createApp(appname, output)
	},

	rm: function (appname) {
	    if (!appname) return
	    api.removeApp(appname, output)
	},

	start: function (appname) {
		if (!appname) return
		api.startApp(appname, output)
	},

	stop: function (appname) {
	    if (!appname) return
	    api.stopApp(appname, output)
	},

	restart: function (appname) {
	    if (!appname) return
	    api.restartApp(appname, output)
	},

	startall: function () {
	    api.startAllApps(output)
	},

	stopall: function () {
		api.stopAllApps(output)
	},

	restartall: function () {
		api.restartAllApps(output)
	},

	edit: function (appname) {
	    if (!appname) return
        edit(api.getAppInfo(appname).repoPath + '/hooks/post-receive')
	},

	list: function () {
	    api.listApps(function (err, apps) {
	        if (!apps.length) {
	        	log('no apps found.')
	        } else {
	        	console.log()
	        	apps.forEach(function (app) {
	        		var tabs = app.name.length < 6 ? '\t\t' : '\t',
	        			status = app.isRunning ? 'ON '.green : 'OFF'.grey
	        	    console.log('  ' + app.name.yellow + tabs + ' - ' + status + ' : ' + app.port)
	        	})
	        	console.log()
	        }
	    })
	}

}

if (!api) {
	console.log('Hello! It seems it\'s your first time running pod on this machine.')
	prompt('Please specify a root directory for pod to store all the files (repos, logs, apps):', function (dir) {
	    dir = path.resolve(process.cwd(), dir)
	    if (fs.existsSync(dir)) {
	    	if (!fs.statSync(dir).isDirectory()) {
	    		return warn('target path ' + dir.grey + ' is not a directory.')
	    	} else {
	    		api = core.initConfig(dir)
	    		parseCommand()
	    	}
	    } else {
	    	prompt('target path ' + dir.grey + ' doesn\'t exist. create it? y/n', function (reply) {
                if (reply.toLowerCase() === 'y') {
                    fs.mkdirSync(dir)
                    api = core.initConfig(dir)
                    parseCommand()
                } else {
                	process.exit(0)
                }
            })
	    }
	})
} else {
	parseCommand()
}

function parseCommand () {
	var command = argv._[0] || 'help'
    if (cli[command]) {
        cli[command](argv._[1])
    } else {
        if (command) {
            warn('unknown command ' + command.red)
        }
    }
}

function prompt (msg, callback) {
    console.log(msg)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', function (input) {
        process.stdin.pause()
        callback(input.replace(/\n/g, ''))
    })
}

function edit (file, callback) {
    process.stdin.setRawMode(true)
    var p = spawn(api.getConfig().editor, [file], {
        customFds: [ 0, 1, 2 ]
    })
    p.on('exit', function () {
        process.stdin.setRawMode(false)
        callback && callback()
    })
}

function output (err, msg) {
    err ? warn(err) : log(msg)
}

function log (msg) {
    if (!Array.isArray(msg)) {
        console.log(msg)
    } else {
        msg.forEach(function (m) {
            console.log(m)
        })
    }
}

function warn (err) {
    err = err.toString().replace('Error: ', '')
    console.warn('POD '.green + 'ERR '.red + err)
}