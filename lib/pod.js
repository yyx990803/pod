var fs      = require('fs'),
    async   = require('async'),
    exec    = require('child_process').exec,
    spawn   = require('child_process').spawn,
    path    = require('path'),
    argv    = require('optimist').argv,
    colors  = require('colors'),
    forever = require('forever/lib/forever'),
    cwd     = process.cwd()

var globalConfig = {},
    globalConfigPath = process.env.HOME + '/.podrc'

var testing = false,
    rawAppnameRE = '/apps/(.+)/.+\.js'

var api = {}

api.createApp = function (appname, options, callback) {

    if (typeof options === 'function') {
        callback = options
        options = null
    }

    if (globalConfig.apps[appname]) {
        return callback(new Error('an app with that name already exists.'))
    }

    var paths = getAppPaths(appname)
    async.parallel([
        function (done) {
            // write config file
            var opts = {
                env: '',
                port: '',
                maxRespawn: '',
                options: []
            }
            // merge options
            if (options) {
                for (var o in options) {
                    if (o in opts) {
                        opts[o] = options[o]
                    }
                }
            }
            globalConfig.apps[appname] = opts
            var data = JSON.stringify(globalConfig, null, 4)
            fs.writeFile(globalConfigPath, data, function (err) {
                done(err, 'updated config.')
            })
        },
        function (done) {
            // create log directory
            fs.mkdir(paths.logPath, function (err) {
                done(err, 'created logs dir at ' + paths.logPath.yellow)
            })
        },
        function (done) {
            // create repo
            createAppRepo(paths, done)
        }
    ],
    function (err, msgs) {
        var repoMsgs = msgs.pop()
        msgs = msgs.concat(repoMsgs)
        callback(err, msgs, api.getAppInfo(appname))
    })
}

api.removeApp = function (appname, callback) {
    
    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist'))
    }

    api.stopApp(appname, function (err) {
        if (!err || /is not running/.test(err.toString())) {
            async.parallel([
                function (done) {
                    // remove files
                    exec('rm -rf ' +
                        app.repoPath + ' ' +
                        app.workPath + ' ' +
                        app.logPath,
                        done
                    )
                },
                function (done) {
                    // rewrite config
                    delete globalConfig.apps[appname]
                    var data = JSON.stringify(globalConfig, null, 4)
                    fs.writeFile(globalConfigPath, data, done)
                }
            ],
            function (err) {
                if (err) return callback(err)
                callback(null, 'deleted app: ' + appname.yellow)
            })
        } else {
            callback(err)
        }
    })

}

api.startApp = function (appname, callback) {
    forever.list(false, function (err, list) {
        if (err) return callback(err)
        runApp(appname, list, callback)
    })
}

api.startAllApps = function (callback) {
    forever.list(false, function (err, list) {
        if (err) return callback(err)
        async.map(
            Object.keys(globalConfig.apps),
            function (appname, done) {
                runApp(appname, list, done)
            },
            callback
        )
    })
}

api.stopApp = function (appname, callback) {

    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist'))
    }

    var runner = forever.stop(app.script)
    runner.once('stop', function () {
        callback(null, appname.yellow + ' stopped.')
    })
    runner.once('error', function () {
        callback(new Error(appname.yellow + ' is not running.'))
    })
}

api.stopAllApps = function (callback) {

    var msg       = 'no app is running.',
        appnameRE = new RegExp(globalConfig.dir + rawAppnameRE)

    var runner    = forever.stopAll()
    runner.on('stopAll', function (procs) {
        if (procs && procs.length) {
            msg = []
            procs.forEach(function (p) {
                var match = p.file.match(appnameRE)
                msg.push(match[1].yellow + ' stopped.')
            })
            callback(null, msg)
        } else {
            callback(new Error(msg))
        }
        
    })
    runner.on('error', function () {
        callback(new Error(msg))
    })
}

api.restartApp = function (appname, callback) {
    
    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist'))
    }

    var runner = forever.restart(app.script)
    runner.on('restart', function () {
        callback(null, appname.yellow + ' restarted.')
    })
    runner.on('error', function () {
        callback(new Error(appname.yellow + ' is not running.'))
    })
}

api.restartAllApps = function (callback) {
    
    var msg = 'no currently running apps found.',
        appnameRE = new RegExp(globalConfig.dir + rawAppnameRE)

    var runner = forever.restartAll()
    runner.on('restartAll', function (procs) {
        if (procs && procs.length) {
            msg = []
            procs.forEach(function (p) {
                var match = p.file.match(appnameRE)
                msg.push(match[1].yellow + ' restarted.')
            })
            callback(null, msg)
        } else {
            callback(new Error(msg))
        }
        
    })
    runner.on('error', function (err) {
        callback(new Error(msg))
    })
}

api.listApps = function (callback) {
    var apps = Object.keys(globalConfig.apps)
    if (!apps.length) {
        callback(null, 'no apps found.')
    }
    forever.list(false, function (err, list) {
        if (err) return callback(err)
        var getStatus = function (appname) {
            var app = api.getAppInfo(appname)
            app.isRunning = isRunning(list, app.script)
            return app
        }
        callback(null, apps.map(getStatus))
    })
}

api.listProcs = function (callback) {
    forever.list(true, function (err, msg) {
        callback(err, msg || 'no process running.')
    })
}

api.cleanAppLog = function (appname, callback) {
    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist'))
    }
    exec('rm -f ' + app.logPath + '/*', function (err) {
        if (err) return callback(err)
        callback(null, 'cleaned logs for ' + appname.yellow)
    })
}

api.getAppInfo = function (appname) {
    var info = getAppPaths(appname)
    info.config = globalConfig.apps[appname]
    if (!info.config) return
    info.script = info.workPath + '/' + (getAppMainScript(info.workPath) || globalConfig.defaultScript)
    info.port = info.config.port || sniffPort(info.script) || 'unknown port'
    return info
}

api.getConfig = function () {
    return globalConfig
}

// helpers

function getAppPaths (app) {
    return {
        name: app,
        repoPath    : globalConfig.dir + '/repos/' + app + '.git',
        workPath    : globalConfig.dir + '/apps/' + app,
        logPath     : globalConfig.dir + '/logs/' + app
    }
}

function createAppRepo (info, done) {
    async.series([
        function (next) {
            // create repo directory
            fs.mkdir(info.repoPath, next)
        },
        function (next) {
            // init bare repo
            exec('git --git-dir ' + info.repoPath + ' --bare init', function (err) {
                next(err, 'created bare repo at ' + info.repoPath.yellow)
            })
        },
        function (next) {
            // create post-receive hook
            createHook(info, function (err) {
                next(err, 'created post-receive hook.')
            })
        },
        function (next) {
            // clone an empty working copy
            exec('git clone ' + info.repoPath + ' ' + info.workPath, function (err) {
                next(err, 'created empty working copy at ' + info.workPath.yellow)
            })
        }
    ], function (err, msgs) {
        msgs.shift()
        done(err, msgs)
    })
}

function createHook (info, done) {
    var hookPath = info.repoPath + '/hooks/post-receive'
    async.waterfall([
        function (next) {
            fs.readFile(__dirname + '/../hooks/post-receive', 'utf-8', next)
        },
        function (data, next) {
            data = data
                .replace(/\{\{pod_dir\}\}/g, globalConfig.dir)
                .replace(/\{\{app\}\}/g, info.name)
            fs.writeFile(hookPath, data, next)
        },
        function (next) {
            fs.chmod(hookPath, '0777', next)
        }
    ], done)
}

function runApp (appname, list, callback) {
    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist'))
    }
    fs.exists(app.script, function (exists) {

        if (!exists) {
            return callback(new Error('cannot locate main script for ' + appname.yellow + '\n' +('(' + app.script + ')').grey))
        }

        if (isRunning(list, app.script)) {
            return callback(null, appname.yellow + ' already running')
        }

        if (argv.port || app.config.port) process.env.PORT = argv.port || app.config.port
        process.env.NODE_ENV = argv.env || app.config.env || globalConfig.env

        var daemonOptions = {
            max: app.config.maxRespawn || 10,
            options: app.config.options || [],
            logFile: app.logPath + '/forever.log',
            errFile: app.logPath + '/stderr.log',
            outFile: app.logPath + '/stdout.log',
            append: true,
        }

        // start daemon
        var monitor = forever.startDaemon(app.script, daemonOptions),
            msg = appname.yellow + ' running on port ' + app.port

        if (testing) {
            // forever has an exit listener if it dies in the same process
            monitor.removeAllListeners('exit')
        }

        callback(null, msg, monitor)
    })
}

function isRunning(list, script) {
    if (!list || !list.length) return false
    for (var i = 0, j = list.length; i < j; i++) {
        if (list[i].file === script) {
            return true
        }
    }
    return false
}

var pod = {

    help: function () {
        console.log(fs.readFileSync(__dirname + '/../help/usage', 'utf-8'))
    },

    config: function (appname) {
        edit(globalConfigPath)
    },

    create: function (appname) {
        if (!appname) return
        api.createApp(appname, output)
    },

    rm: function (appname) {
        if (!appname) return
        prompt('Really delete app \'' + appname + '\'? (y/n)', function (res) {
            if (res === 'y') {
                api.removeApp(appname, output)
            }
        })
    },

    cleanlogs: function (appname) {
        if (!appname) return
        api.cleanAppLog(appname, output)
    },

    edit: function (appname) {
        if (!appname) return
        edit(api.getAppInfo(appname).repoPath + '/hooks/post-receive')
    },

    list: function () {
        if (argv.p) {
            api.listProcs(output)
        } else {
            api.listApps(function (err, apps) {
                if (err) return warn(err)
                apps.forEach(function (app) {
                    console.log(
                        '⚑ ' + app.name.yellow +
                        (app.name.length < 8 ? '\t' : '') +
                        '\t - ' +
                        (app.isRunning ? 'ON '.green : 'OFF'.magenta) +
                        ' : ' + app.port
                    )
                })
            })
        }
    },

    start: function (appname, list) {
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
    }

}

function output (err, msg) {
    err ? warn(err) : log(msg)
}

function log (msg) {
    if (!Array.isArray(msg)) {
        console.log('pod '.green + msg)
    } else {
        msg.forEach(function (m) {
            console.log('pod '.green + m)
        })
    }
}

function warn (err) {
    err = err.toString().replace('Error: ', '')
    console.warn('pod '.green + 'WARN '.magenta + err)
}

// INIT

function initConfig () {
    prompt('Please specify a directory for Pod to store all the data (repos, logs, app files):', function (res) {
        res = path.resolve(cwd, res)
        if (fs.existsSync(res)) {
            if (!fs.statSync(res).isDirectory()) {
                warn('target path ' + res.grey + ' is not a directory.')
                process.exit(-1)
            }
            createGlobalConfig(res)
            makeDirs()
        } else {
            prompt('target path ' + res.grey + ' doesn\'t exist. create it? y/n', function (reply) {
                if (reply === 'y') {
                    fs.mkdirSync(res)
                    createGlobalConfig(res)
                    makeDirs()
                }
            })
        }
    })
}

function parseCommand () {
    var command = argv._[0] || 'help'
    if (pod[command]) {
        pod[command](argv._[1], argv._[2])
    } else {
        if (command) {
            warn('unknown command ' + command.red)
        }
    }
}

// CLI interfacing

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
    var p = spawn(globalConfig.editor, [file], {
        customFds: [ 0, 1, 2 ]
    })
    p.on('exit', function () {
        process.stdin.setRawMode(false)
        callback && callback()
    })
}

// File writing

function createGlobalConfig (dir) {
    globalConfig.dir = dir
    // write default values for global config
    globalConfig.env = 'development'
    globalConfig.defaultScript = 'app.js'
    globalConfig.editor = process.env.VISUAL || process.env.EDITOR || 'vi'
    globalConfig.apps = {}

    fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 4))
    log('write global config file: ' + globalConfigPath.yellow)
}

function makeDirs () {
    var apps = globalConfig.dir + '/apps',
        repos = globalConfig.dir + '/repos'
        logs = globalConfig.dir + '/logs'
    if (!fs.existsSync(apps)) fs.mkdirSync(apps)
    if (!fs.existsSync(repos)) fs.mkdirSync(repos)
    if (!fs.existsSync(logs)) fs.mkdirSync(logs)
}

// File searching / reading

function getAppMainScript (workPath) {
    var pkg = readJSON(workPath + '/package.json')
    if (pkg) return pkg.main
}

function readJSON (file) {
    if (!fs.existsSync(file)) {
        return null
    } else {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
}

function sniffPort (script) {
    if (fs.existsSync(script)) {
        // sniff port
        var content = fs.readFileSync(script, 'utf-8'),
            portMatch = content.match(/\.listen\(\D*(\d\d\d\d\d?)\D*\)/)
        return portMatch ? portMatch[1] : null
    } else {
        return null
    }
}

// Expose stuff

module.exports = {

    initTest: function (config) {
        testing = true
        globalConfig = config
        globalConfigPath = config.dir + '/.podrc'
        return api
    },

    initCLI: function () {
        if (fs.existsSync(globalConfigPath)) {
            globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'))
            parseCommand()
        } else {
            console.log('No global config file found.')
            initConfig()
        }
    }

}