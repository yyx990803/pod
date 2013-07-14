var fs      = require('fs'),
    async   = require('async'),
    exec    = require('child_process').exec,
    spawn   = require('child_process').spawn,
    path    = require('path'),
    argv    = require('optimist').argv,
    colors  = require('colors'),
    forever = require('forever/lib/forever'),
    cwd     = process.cwd()

var silent = false, // for API and Testing
    globalConfig = {},
    globalConfigDirPath = process.env.HOME + '/.podrc',
    globalConfigPath = globalConfigDirPath + '/global.json'

var api = {

    createApp: function (appname, callback) {
        if (globalConfig.apps[appname]) {
            warn('an app with that name already exists.', callback)
        } else {
            var paths = getAppPaths(appname)
            async.parallel([
                function (done) {
                    // write config file
                    globalConfig.apps[appname] = {
                        env: '',
                        port: '',
                        maxRespawn: '',
                        options: []
                    }
                    fs.writeFile(
                        globalConfigPath,
                        JSON.stringify(globalConfig, null, 4),
                        ifOK(done)
                    )
                },
                function (done) {
                    // create log directory
                    fs.mkdir(
                        paths.logPath,
                        ifOK(function () {
                            log('create logs dir at ' + paths.logPath.yellow)
                            done()
                        })
                    )
                },
                function (done) {
                    // create repo
                    createAppRepo(paths, done)
                }
            ],
            ifOK(function () {
                callback(
                    null,
                    'created app ' + appname.yellow,
                    api.getAppInfo(appname)
                )
            }))
        }
    },

    startApp: function (appname, callback) {
        forever.list(false, ifOK(function (list) {
            runApp(appname, list, callback)
        }))
    },

    startAllApps: function (callback) {
        forever.list(false, ifOK(function (list) {
            async.map(
                Object.keys(globalConfig.apps),
                function (appname, done) {
                    runApp(appname, list, done)
                },
                function (err, msgs) {
                    if (callback) {
                        callback(err, msgs)
                    } else if (!err) {
                        log(msgs.join('\n'))
                    } else {
                        throw err
                    }
                }
            )
        }))
    },

    stopApp: function (appname, callback) {
        var app = api.getAppInfo(appname)
        if (!app) {
            warn('app ' + appname.yellow + ' does not exist', callback)
            return
        }
        var runner = forever.stop(app.script)
        runner.on('stop', function () {
            console.log('123123')
            log(appname.yellow + ' stopped.', callback)
        })
        runner.on('error', function () {
            log(appname.yellow + ' is not running.', callback)
        })
    },

    stopAllApps: function (callback) {
        
    },

    removeApp: function (callback) {
        
    },

    listAppsStatus: function () {

    },

    getAppInfo: function (appname) {
        var info = getAppPaths(appname)
        info.config = globalConfig.apps[appname]
        if (!info.config) return
        info.script = info.workPath + '/' + (getAppMainScript(info.workPath) || globalConfig.defaultScript)
        info.port = info.config.port || sniffPort(info.script) || 'unknown port'
        return info
    },

    getConfig: function () {
        return globalConfig
    }

}

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
            fs.mkdir(info.repoPath, ifOK(next))
        },
        function (next) {
            // init bare repo
            exec('git --git-dir ' + info.repoPath + ' --bare init', ifOK(function () {
                log('create bare repo at ' + info.repoPath.yellow)
                createHook(info, next)
            }))
        },
        function (next) {
            // clone an empty working copy
            exec('git clone ' + info.repoPath + ' ' + info.workPath, ifOK(function () {
                log('create empty working copy at ' + info.workPath.yellow)
                next()
            }))
        }
    ], done)
}

function createHook (info, done) {
    fs.readFile(__dirname + '/../hooks/post-receive', 'utf-8', ifOK(function (data) {
        data = data
            .replace(/\{\{pod_dir\}\}/g, globalConfig.dir)
            .replace(/\{\{app\}\}/g, info.name)
        var hookPath = info.repoPath + '/hooks/post-receive'
        fs.writeFile(hookPath, data, ifOK(function () {
            fs.chmod(hookPath, '0777', ifOK(done))
        }))
    }))
}

function runApp (appname, list, callback) {
    var app = api.getAppInfo(appname)
    if (!app) {
        warn('app ' + appname.yellow + ' does not exist', callback)
        return
    }
    fs.exists(app.script, function (exists) {
        if (!exists) {
            warn('cannot locate main script for ' + appname.yellow + '\n' +('(' + app.script + ')').grey, callback)
        } else {
            if (isRunning(list, app.script)) {
                log(appname.yellow + ' already running', callback)
            } else {
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
                if (callback) {
                    callback(null, msg, monitor)
                } else {
                    log(msg)
                }
            }
        }
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

function ifOK (func) {
    return function (err) {
        if (err) {
            throw err
        } else {
            func && func.apply(null, [].slice.call(arguments, 1))
        }
    }
}

var pod = {

    help: function () {
        console.log(fs.readFileSync(__dirname + '/../help/usage', 'utf-8'))
    },

    config: function (appname) {
        if (argv.reset) {
            initConfig()
        } else {
            edit(
                appname
                ? getAppInfo(appname).configPath
                : globalConfigPath
            )
        }
    },

    create: function (appname) {
        if (!appname) return
        api.createApp(appname)
    },

    rm: function (appname) {

        if (!appname) return

        var app = getAppInfo(appname)

        prompt('Really delete app \'' + appname + '\'? (y/n)', function (res) {
            if (res === 'y') {
                // stop it first
                pod.stop(appname)
                // fs.rmdir can't -rf
                exec('rm -rf ' +
                    app.configPath + ' ' +
                    app.repoPath + ' ' +
                    app.workPath + ' ' +
                    app.logPath,
                function (err) {
                    if (err) {
                        warn(err)
                    } else {
                        log('deleted app: ' + appname.yellow)
                    }
                })
            }
        })
    },

    cleanlogs: function (appname) {
        var logDir = getAppInfo(appname).logPath
        if (!fs.existsSync(logDir)) {
            warn('cannot find log directory for ' + appname)
            return
        }
        clean('forever.log')
        clean('stderr.log')
        clean('stdout.log')
        var total = 3
        function clean (file) {
            file = logDir + '/' + file
            fs.exists(file, function (exist) {
                if (exist) {
                    fs.writeFile(file, 'restart at ' + Date.now() + '\n', 'utf-8', function (err) {
                        if (!err) {
                            done()
                        } else {
                            warn(err)
                        }
                    })
                } else done()
            })
        }
        function done () {
            total--
            if (!total) log('cleaned logs for ' + appname.yellow)
        }
    },

    edit: function (appname) {
        if (!appname) return
        edit(getAppInfo(appname).repoPath + '/hooks/post-receive')
    },

    list: function () {

        var apps = findApps()
        if (!apps.length) {
            console.log('no apps found.')
            return
        }

        if (argv.p) {
            forever.list(true, function (err, info) {
                console.log(info ? info : 'no processes found.')
            })
            return
        }

        forever.list(false, function (err, list) {
            if (err) {
                warn(err)
            } else {
                var longest = getLongestName(apps)
                apps.forEach(function (appname) {
                    var app = getAppInfo(appname),
                        status = isRunning(list, app.script) ? 'ON'.green : 'OFF'.magenta
                    console.log('⚑ ' + appname.yellow + spaces(longest - appname.length) + ' - ' + status + ' : ' + app.port)
                })
            }
        })

    },

    start: function (appname, list) {
        if (!appname) return
        api.startApp(appname)
    },

    stop: function (appname) {
        if (!appname) return
        api.stopApp(appname)
    },

    restart: function (appname) {
        if (!appname) return

        var app = getAppInfo(appname),
            runner = forever.restart(app.script)

        runner.on('restart', function () {
            log(appname.yellow + ' restarted.')
        })

        runner.on('error', function (err) {
            console.log(err)
            log(appname.yellow + ' is not running, starting instead...')
            pod.start(appname)
        })

    },

    startall: function () {
        api.startAllApps()
        // forever.list(false, function (err, list) {
        //     if (err) {
        //         warn(err)
        //     } else {
        //         var apps = findApps()
        //         if (!apps.length) {
        //             console.log('no apps found.')
        //             return
        //         }
        //         apps.forEach(function (appname) {
        //             pod.start(appname, list)
        //         })      
        //     }
        // })
    },

    stopall: function () {
        var runner = forever.stopAll()
        runner.on('stopAll', function (processes) {
            if (processes && processes.length) {
                var appnameRE = new RegExp(globalConfig.dir + '/apps/(.+)/.+\.js')
                log('stopped:')
                processes.forEach(function (p) {
                    var match = p.file.match(appnameRE)
                    if (match) console.log('⚑ ' + match[1].yellow)
                })
            } else {
                console.log('no app is running.');
            }
        })
        runner.on('error', function (err) {
            console.log('no app is running.')
        })
    },

    restartall: function () {
        var runner = forever.restartAll()
        runner.on('restartAll', function (processes) {
            if (processes && processes.length) {
                var appnameRE = new RegExp(globalConfig.dir + '/apps/(.+)/.+\.js')
                log('restarted:')
                processes.forEach(function (p) {
                    var match = p.file.match(appnameRE)
                    if (match) console.log('⚑ ' + match[1].yellow)
                })
            } else {
                console.log('no app is running.');
            }
        })
        runner.on('error', function (err) {
            console.log('no app is running.')
        })
    }

}

// INIT

function initConfig () {
    prompt('Please specify a directory for Pod to store all the data (repos, logs, app files):', function (res) {
        res = path.resolve(cwd, res)
        if (fs.existsSync(res)) {
            if (!isDir(res)) {
                warn('target path ' + res.grey + ' is not a directory.')
                process.exit(-1)
            }
            initGlobalConfig(res)
            makeDirs()
        } else {
            prompt('target path ' + res.grey + ' doesn\'t exist. create it? y/n', function (reply) {
                if (reply === 'y') {
                    fs.mkdirSync(res)
                    initGlobalConfig(res)
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

// The main app info collection function

function getAppInfo (app, creating) {
    var info = {
        configPath  : globalConfigDirPath + '/app-configs/' + app,
        repoPath    : globalConfig.dir + '/repos/' + app + '.git',
        workPath    : globalConfig.dir + '/apps/' + app,
        logPath     : globalConfig.dir + '/logs/' + app
    }
    if (!creating) {
        info.config = readJSON(info.configPath)
        if (!info.config) {
            warn('app ' + app.yellow + ' doesn\'t seem to exist.')
            process.exit(-1)
        }
        info.script = info.workPath + '/' + (getAppMainScript(info.workPath) || globalConfig.defaultScript)
        info.port = info.config.port || sniffPort(info.script) || 'unknown port'
    }
    return info
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

function initGlobalConfig (res) {
    globalConfig.dir = res
    // write default values for global config
    globalConfig.env = 'development'
    globalConfig.defaultScript = 'app.js'
    globalConfig.editor = process.env.VISUAL || process.env.EDITOR || 'vi'
    globalConfig.apps = {}

    if (!fs.existsSync(globalConfigDirPath)) {
        fs.mkdirSync(globalConfigDirPath)
        fs.mkdirSync(globalConfigDirPath + '/app-configs')
    }

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

function findApps () {
    return fs.readdirSync(globalConfigDirPath + '/app-configs')
}

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
            portMatch = content.match(/\.listen\(.*(\d\d\d\d\d?).*\)/)
        return portMatch ? portMatch[1] : null
    } else {
        return null
    }
}

function isDir (path) {
    return fs.statSync(path).isDirectory()
}

// output formatting

function log (msg, callback) {
    if (!callback) {
        if (!silent) console.log('pod '.green + msg)
    } else {
        callback(null, msg)
    }
}

function warn (msg, callback) {
    if (!callback) {
        console.warn('pod '.green + 'WARN '.magenta + msg)
    } else {
        callback(new Error(msg))
    }
}

function spaces (length) {
    if (length < 0) return ''
    var ret = ''
    while (length--) {
        ret += ' '
    }
    return ret
}

function getLongestName (apps) {
    var longest = 0
    apps.forEach(function (a) {
        if (a.length > longest) longest = a.length
    })
    return longest
}

// Expose stuff

module.exports = {

    init: function (config) {
        globalConfig = loadGlobalConfig()
        return pod
    },

    initTest: function (config) {
        silent = true
        globalConfig = config
        globalConfigDirPath = config.dir + '/.podrc'
        globalConfigPath = globalConfigDirPath + '/global.json'
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