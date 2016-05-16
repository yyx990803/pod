var fs         = require('fs'),
    path       = require('path'),
    async      = require('async'),
    mkdirp     = require('mkdirp'),
    colors     = require('colors'),
    pm2        = require('pm2/lib/CLI.js'),
    pm2cst     = require('pm2/constants.js'),
    pm2prepare = require('pm2/lib/Common.js').prepareAppConf,
    // Satan is pm2's RPC daemon, we have to use it to get
    // some custom behavior that is not exposed by pm2's CLI.
    Satan      = require('pm2/lib/Satan.js'),
    exec       = require('child_process').exec,
    Emitter    = require('events').EventEmitter,
    debug      = require('debug')('api')

var conf         = require('./conf'),
    ERRORS       = require('./errors'),
    formatter    = require('./formatter'),
    hookTemplate = fs.readFileSync(__dirname + '/../hooks/post-receive', 'utf-8')

// Load config data
var globalConfigPath = conf.path,
    webInterfaceId   = conf.webId,
    globalConfig     = readJSON(globalConfigPath)

upgradeConf()

// If env var is present, overwrite root dir
// mostly for testing.
if (process.env.POD_ROOT_DIR) globalConfig.root = process.env.POD_ROOT_DIR

// create default folders
if (!fs.existsSync(globalConfig.root)) mkdirp.sync(globalConfig.root)
if (!fs.existsSync(globalConfig.root + '/apps')) fs.mkdirSync(globalConfig.root + '/apps')
if (!fs.existsSync(globalConfig.root + '/repos')) fs.mkdirSync(globalConfig.root + '/repos')

// The api is an emitter
var api = new Emitter()

// init and connect to pm2
pm2.pm2Init()
pm2.connect(function () {
  api.emit('ready')
})

api.version = require('../package.json').version

api.createApp = function (appname, options, callback) {

    if (typeof options === 'function') {
        callback = options
        options = null
    }

    if (globalConfig.apps[appname] || appname === webInterfaceId) {
        return abort(ERRORS.EXISTS, callback, { appname: appname })
    }

    var paths = getAppPaths(appname)
    async.parallel([
        function (done) {
            // write config file
            var opts = {}
            // merge options
            if (options) {
                for (var o in options) {
                    opts[o] = options[o]
                }
            }
            globalConfig.apps[appname] = opts
            var data = JSON.stringify(globalConfig, null, 4)
            fs.writeFile(globalConfigPath, data, function (err) {
                done(err, 'updated config.')
            })
        },
        function (done) {
            // create repo
            if (options && options.remote) {
                createRemoteApp(paths, options.remote, done)
            } else {
                createAppRepo(paths, done)
            }
        }
    ],
    function (err, msgs) {
        var repoMsgs = msgs.pop()
        msgs = msgs.concat(repoMsgs)
        callback(err, msgs, api.getAppInfo(appname))
    })
}

api.removeApp = function (appname, callback) {

    if (appname === webInterfaceId) {
        return abort(ERRORS.WEB, callback)
    }

    var app = api.getAppInfo(appname)
    if (!app) {
        return abort(ERRORS.NOT_FOUND, callback, { appname: appname })
    }

    api.stopApp(appname, function (err) {
        if (!err || /is not running/.test(err.toString())) {
            async.parallel([
                function (done) {
                    // remove files
                    exec('rm -rf ' +
                        app.repoPath + ' ' +
                        app.workPath,
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

    var app = api.getAppInfo(appname)
    if (!app) {
        return abort(ERRORS.NOT_FOUND, callback, { appname: appname })
    }

    debug('checking if app main script exists...')
    fs.exists(app.script, function (exists) {
        if (!exists) {
            return abort(ERRORS.NO_SCRIPT, callback, { appname: appname, script: app.script })
        }
        debug('checking if app is already running...')
        Satan.executeRemote('findByFullPath', app.script, function (err, procs) {
            if (err) return callback(err)
            if (procs) {
                if (procs[0].pm2_env.status == pm2cst.STOPPED_STATUS ||
                    procs[0].pm2_env.status == pm2cst.STOPPING_STATUS ||
                    procs[0].pm2_env.status == pm2cst.ERRORED_STATUS) {
                    return pm2._restart(procs[0].pm2_env.name, callback)
                } else {
                    return callback(null, appname.yellow + ' already running.')
                }
            } else {
                var conf = prepareConfig(app)
                if (conf instanceof Error) {
                    return callback(conf)
                }
                debug('attempting to start app...')
                Satan.executeRemote('prepare', conf, function (err) {
                    if (err) return callback(err)
                    callback(null, appname.yellow + ' running on ' + (app.port || 'unknown port'))
                })
            }
        })
    })
}

api.startAllApps = function (callback) {
    async.map(
        Object.keys(globalConfig.apps),
        api.startApp,
        callback
    )
}

api.stopApp = function (appname, callback) {

    var app = api.getAppInfo(appname)
    if (!app) {
        return abort(ERRORS.NOT_FOUND, callback, { appname: appname })
    }

    Satan.executeRemote('getMonitorData', {}, function (err, list) {
        if (err) return callback(err)
        var runningProcs = findInList(appname, list)
        if (!runningProcs) {
            callback(null, appname.yellow + ' is not running.')
        } else {
            async.map(runningProcs, function (proc, done) {
                Satan.executeRemote('stopProcessId', proc.pm_id, function (err) {
                    if (err) return done(err)
                    Satan.executeRemote('deleteProcessId', proc.pm_id, done)
                })
            }, function (err) {
                if (err) return callback(err)
                var l = runningProcs.length
                callback(
                    null,
                    appname.yellow + ' stopped.' +
                    (l > 1 ? (' (' + l + ' instances)').grey : '')
                )
            })
        }
    })
}

api.stopAllApps = function (callback) {
    // only stop ones in the config
    async.map(
        Object.keys(globalConfig.apps),
        api.stopApp,
        callback
    )
}

api.restartApp = function (appname, callback) {

    var app = api.getAppInfo(appname)
    if (!app) {
        return abort(ERRORS.NOT_FOUND, callback, { appname: appname })
    }

    Satan.executeRemote('getMonitorData', {}, function (err, list) {
        if (err) return callback(err)
        var runningProcs = findInList(appname, list)
        if (!runningProcs) {
            return abort(ERRORS.NOT_RUNNING, callback, { appname: appname })
        } else {
            async.map(runningProcs, restart, function (err) {
                if (err) return callback(err)
                var l = runningProcs.length
                callback(
                    null,
                    appname.yellow + ' restarted.' +
                    (l > 1 ? (' (' + l + ' instances)').grey : '')
                )
            })
        }
    })
}

api.restartAllApps = function (callback) {
    Satan.executeRemote('getMonitorData', {}, function (err, list) {
        if (err) return callback(err)
        var runningProcs = []
        list.forEach(function (proc) {
            if (proc.pm2_env.name in globalConfig.apps) {
                runningProcs.push(proc)
            }
        })
        async.map(runningProcs, restart, function (err, msgs) {
            callback(err, msgs.map(function (msg) {
                return 'instance of ' + msg
            }))
        })
    })
}

api.listApps = function (callback) {
    var appList = Object.keys(globalConfig.apps)
    if (!appList.length) {
        return process.nextTick(function () {
            callback(null, [])
        })
    }
    Satan.executeRemote('getMonitorData', {}, function (err, list) {
        if (err) return callback(err)
        callback(null, appList.map(function (appname) {
            var app = api.getAppInfo(appname)
            app.instances = findInList(appname, list)
            app.broken = isBroken(app)
            return formatter.format(app)
        }))
    })
}

api.prune = function (callback) {
    var appList = Object.keys(globalConfig.apps),
        pruned = []
    async.parallel([
        // clean root dir
        function (done) {
            fs.readdir(globalConfig.root, function (err, files) {
                if (err) return callback(err)
                async.map(files, function (f, next) {
                    if (f !== 'apps' && f !== 'repos') {
                        f = globalConfig.root + '/' + f
                        pruned.push(f)
                        removeFile(f, next)
                    } else {
                        next()
                    }
                }, done)
            })
        },
        // clean apps dir
        function (done) {
            fs.readdir(globalConfig.root + '/apps', function (err, files) {
                if (err) return callback(err)
                async.map(files, function (f, next) {
                    if (appList.indexOf(f) < 0) {
                        f = globalConfig.root + '/apps/' + f
                        pruned.push(f)
                        removeFile(f, next)
                    } else {
                        next()
                    }
                }, done)
            })
        },
        // clean repos dir
        function (done) {
            fs.readdir(globalConfig.root + '/repos', function (err, files) {
                if (err) return callback(err)
                async.map(files, function (f, next) {
                    var base = f.replace('.git', '')
                    if (appList.indexOf(base) < 0 || f.indexOf('.git') === -1) {
                        f = globalConfig.root + '/repos/' + f
                        pruned.push(f)
                        removeFile(f, next)
                    } else {
                        next()
                    }
                }, done)
            })
        }
    ], function (err) {
        var msg = pruned.length
            ? 'pruned:\n' + pruned.join('\n').grey
            : 'root directory is clean.'
        callback(err, msg)
    })
}

api.updateHooks = function (callback) {
    var appList = Object.keys(globalConfig.apps),
        updated = []
    async.map(appList, function (app, next) {
        var info = getAppPaths(app)
        createHook(info, function (err) {
            if (!err) updated.push(info.name)
            next(err)
        })
    }, function (err) {
        callback(err, 'updated hooks for:\n' + updated.join('\n').yellow)
    })
}

api.getAppInfo = function (appname) {
    if (appname === webInterfaceId) {
        return webConfig()
    }
    var info = getAppPaths(appname)
    info.config = globalConfig.apps[appname]
    if (!info.config) return
    info.script = path.resolve(info.workPath, getAppMainScript(info.workPath, appname) || globalConfig.default_script)
    info.port = info.config.port || sniffPort(info.script) || null
    return info
}

api.getConfig = function () {
    return globalConfig
}

api.reloadConfig = function () {
    globalConfig = readJSON(globalConfigPath)
    return globalConfig
}

api.proxy = function () {
    return Satan.executeRemote.apply(Satan, arguments)
}

// helpers

function restart (app, callback) {
    Satan.executeRemote('restartProcessId', { id: app.pm_id }, function (err) {
        if (err) return callback(err)
        callback(null, app.pm2_env.name.yellow + ' restarted')
    })
}

function getAppPaths (app) {
    return {
        name: app,
        repoPath    : globalConfig.root + '/repos/' + app + '.git',
        workPath    : globalConfig.root + '/apps/' + app
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

function createRemoteApp (info, remote, done) {
    remote = expandRemote(remote)
    exec('git clone ' + remote + ' ' + info.workPath, function (err) {
        done(err, [
            'created remote app at ' + info.workPath.yellow,
            'tracking remote: ' + remote.cyan
        ])
    })
}

function expandRemote (remote) {
    var m = remote.match(/^([\w-_]+)\/([\w-_]+)$/)
    return m
        ? 'https://github.com/' + m[1] + '/' + m[2] + '.git'
        : remote
}

function createHook (info, done) {
    var hookPath = info.repoPath + '/hooks/post-receive'
    async.waterfall([
        function (next) {
            var data = hookTemplate
                .replace(/\{\{pod_dir\}\}/g, globalConfig.root)
                .replace(/\{\{app\}\}/g, info.name)
            fs.writeFile(hookPath, data, next)
        },
        function (next) {
            fs.chmod(hookPath, '0777', next)
        }
    ], done)
}

function findInList (appname, list) {
    if (!list || !list.length) return false
    var ret = [], proc
    for (var i = 0, j = list.length; i < j; i++) {
        proc = list[i]
        if (
            proc.pm2_env.status !== 'stopped' &&
            proc.pm2_env.name === appname
        ) {
            ret.push(list[i])
        }
    }
    return ret.length > 0 ? ret : null
}

function getAppMainScript (workPath, appname) {
    var pkg = readJSON(workPath + '/package.json')
    var main

    if (globalConfig.apps[appname].script) {
        main = globalConfig.apps[appname].script
    } else if (pkg && pkg.main) {
        main = pkg.main
    }

    if (main) {
        if (/\.js$/.test(main)) {
            return main
        } else {
            var mainPath = path.resolve(workPath, main)
            if (fs.existsSync(mainPath)) {
                return fs.statSync(mainPath).isDirectory()
                    ? main + '/index.js'
                    : main
            } else {
                return main + '.js'
            }
        }
    }
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

        if (!portMatch) {
            var portVariableMatch = content.match(/\.listen\(\s*([a-zA-Z_$]+)\s*/)

            if (portVariableMatch) {
                portMatch = content.match(new RegExp(portVariableMatch[1] + '\\s*=\\D*(\\d\\d\\d\\d\\d?)\\D'))
            }
        }

        return portMatch ? portMatch[1] : null
    }
}

function isBroken (app) {
    return app.name !== webInterfaceId &&
        (
            (!app.config.remote && !fs.existsSync(app.repoPath)) ||
            !fs.existsSync(app.workPath)
        )
}

function removeFile (f, cb) {
    var isDir = fs.statSync(f).isDirectory()
    fs[isDir ? 'rmdir' : 'unlink'](f, cb)
}

function webConfig () {
    var p = path.resolve(__dirname, '../web')
    return {
        name: webInterfaceId,
        workPath: p,
        config: globalConfig.web,
        script: p + '/app.js',
        port: globalConfig.web.port || 19999
    }
}

function prepareConfig (appInfo) {

    var conf = {
        name: appInfo.name,
        script: appInfo.script,
        env: {
            NODE_ENV: appInfo.config.node_env || globalConfig.node_env || 'development',
            PORT: appInfo.config.port
        }
    }

    // copy other options and pass it to pm2
    for (var o in appInfo.config) {
        if (
            o !== 'port' &&
            o !== 'node_env' &&
            o !== 'remote' &&
            o !== 'username' &&
            o !== 'password' &&
            o !== 'jsonp'
        ) {
            conf[o] = appInfo.config[o]
        }
    }

    for (o in globalConfig.env) {
        conf.env[o] = globalConfig.env[o]
    }

    // constraints, fallback to global config
    conf.min_uptime   = conf.min_uptime || globalConfig.min_uptime || undefined
    conf.max_restarts = conf.max_restarts || globalConfig.max_restarts || undefined

    // invoke pm2's prepare function
    // if the conf has problems it will return an error
    return pm2prepare(conf)
}

function abort (e, callback, data) {
    var msg = e.msg
    if (data) {
        msg = msg.replace(/{{(.+?)}}/g, function (m, p1) {
            return data[p1] || ''
        })
    }
    var err = new Error(msg)
    err.code = e.code
    process.nextTick(function () {
        callback(err)
    })
}

function upgradeConf () {
    if (
        globalConfig.web &&
        globalConfig.node_env &&
        globalConfig.default_script
    ) return

    if (!globalConfig.web) globalConfig.web = {}
    var fieldsToConvert = {
        'nodeEnv': 'node_env',
        'defaultScript': 'default_script',
        'fileOutput': 'out_file',
        'fileError': 'error_file',
        'pidFile': 'pid_file',
        'minUptime': 'min_uptime',
        'maxRestarts': 'max_restarts'
    }
    convert(globalConfig)
    fs.writeFile(globalConfigPath, JSON.stringify(globalConfig, null, 4))

    function convert (conf) {
        for (var key in conf) {
            var converted = fieldsToConvert[key]
            if (converted) {
                conf[converted] = conf[key]
                delete conf[key]
            } else if (Object.prototype.toString.call(conf[key]) === '[object Object]') {
                convert(conf[key])
            }
        }
    }
}

module.exports = api
