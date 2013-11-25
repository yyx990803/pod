var fs      = require('fs'),
    path    = require('path'),
    async   = require('async'),
    mkdirp  = require('mkdirp'),
    colors  = require('colors'),
    Satan   = require('pm2/lib/Satan'),
    pm2cst  = require('pm2/constants'),
    exec    = require('child_process').exec,
    Emitter = require('events').EventEmitter

var hookTemplate = fs.readFileSync(__dirname + '/../hooks/post-receive', 'utf-8')

// Load config data
var conf = require('./conf'),
    globalConfigPath = conf.path,
    webInterfaceId = conf.webId,
    globalConfig = readJSON(globalConfigPath)
if (process.env.ROOT_DIR) globalConfig.root = process.env.ROOT_DIR

// Error codes and message
var ERRORS = {
    EXISTS      : 'an app with the name ' + '{{appname}}'.yellow + ' already exists.',
    NOT_FOUND   : 'app ' + '{{appname}}'.yellow + ' does not exist.',
    NO_SCRIPT   : 'cannot locate main script for ' + '{{appname}}'.yellow + ' ({{script}})'.grey,
    NOT_RUNNING : '{{appname}}'.yellow + ' is not running.'
}
for (var errKey in ERRORS) {
    ERRORS[errKey] = {
        msg: ERRORS[errKey],
        code: errKey
    }
}

// create default folders
if (!fs.existsSync(globalConfig.root)) mkdirp.sync(globalConfig.root)
if (!fs.existsSync(globalConfig.root + '/apps')) fs.mkdirSync(globalConfig.root + '/apps')
if (!fs.existsSync(globalConfig.root + '/repos')) fs.mkdirSync(globalConfig.root + '/repos')

// also do this for pm2
if (!fs.existsSync(pm2cst.DEFAULT_FILE_PATH)) {
    fs.mkdirSync(pm2cst.DEFAULT_FILE_PATH)
    fs.mkdirSync(pm2cst.DEFAULT_LOG_PATH)
    fs.mkdirSync(pm2cst.DEFAULT_PID_PATH)
}

// The api is an emitter
// and is only ready when Satan (pm2's background manager) is ready
var api = new Emitter()
process.once('satan:client:ready', function () {
    api.emit('ready')
})

api.version = require('../package.json').version

api.createApp = function (appname, options, callback) {

    if (typeof options === 'function') {
        callback = options
        options = null
    }

    if (globalConfig.apps[appname]) {
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

    fs.exists(app.script, function (exists) {
        if (!exists) {
            return abort(ERRORS.NO_SCRIPT, callback, { appname: appname, script: app.script })
        }
        Satan.executeRemote('findByFullPath', app.script, function (err, proc) {
            if (err) return callback(err)
            if (proc) return callback(null, appname.yellow + ' already running.')

            var appConf = prepareConfig(app)
            appConf.NODE_ENV = app.config.nodeEnv || globalConfig.nodeEnv
            if (app.config.port) appConf.PORT = app.config.port

            Satan.executeRemote('prepare', appConf, function (err) {
                if (err) return callback(err)
                callback(null, appname.yellow + ' running on ' + (app.port || 'unknown port'))
            })
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
            callback(null, appname.yellow + ' is not running')
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
    var apps = Object.keys(globalConfig.apps)
    if (!apps.length) {
        return process.nextTick(function () {
            callback(null, [])
        })
    }
    Satan.executeRemote('getMonitorData', {}, function (err, list) {
        if (err) return callback(err)
        var ret = apps.map(format),
            web = format(webInterfaceId)
        if (web.instances) ret.push(web)
        callback(null, ret)

        function format (appname) {
            var app = api.getAppInfo(appname)
            app.instances = findInList(appname, list)
            if (app.instances) {
                app.uptime = Date.now() - app.instances[0].pm2_env.pm_uptime
            }
            app.broken = isBroken(app)
            return app
        }
    })
}

api.prune = function (callback) {
    var apps = Object.keys(globalConfig.apps),
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
                    if (apps.indexOf(f) < 0) {
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
                    if (apps.indexOf(base) < 0 || f.indexOf('.git') === -1) {
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
    var apps = Object.keys(globalConfig.apps),
        updated = []
    async.map(apps, function (app, next) {
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
    info.script = info.workPath + '/' + (getAppMainScript(info.workPath) || globalConfig.defaultScript)
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

// helpers

function restart (app, callback) {
    Satan.executeRemote('restartProcessId', app.pm_id, function (err) {
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
    }
}

function isBroken (app) {
    return app.name !== webInterfaceId &&
        (!fs.existsSync(app.repoPath) || !fs.existsSync(app.workPath))
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

    var app = {
        name: appInfo.name,
        script: appInfo.script
    }

    for (var o in appInfo.config) {
        if (o !== 'port' && o !== 'nodeEnv') {
            app[o] = appInfo.config[o]
        }
    }

    app['exec_interpreter'] = 'node'
    app['exec_mode']       = 'cluster'

    app["pm_exec_path"]    = app.script

    app["pm_out_log_path"] = app.fileOutput || path.resolve(pm2cst.DEFAULT_LOG_PATH, [app.name, '-out.log'].join(''))
    app.fileOutput         = app["pm_out_log_path"]

    app["pm_err_log_path"] = app.fileError  || path.resolve(pm2cst.DEFAULT_LOG_PATH, [app.name, '-err.log'].join(''))
    app.fileError          = app["pm_err_log_path"]

    app["pm_pid_path"]     = app.pidFile    || path.resolve(pm2cst.DEFAULT_PID_PATH, [app.name, '.pid'].join(''))
    app.pidFile            = app["pm_pid_path"]

    app["min_uptime"]      = app.minUptime  || globalConfig.minUptime || undefined
    app["max_restarts"]    = app.maxRestarts || globalConfig.maxRestarts || undefined

    return app
}

function abort (e, callback, data) {
    var msg = e.msg
    for (var prop in data) {
        msg = msg.replace('{{' + prop + '}}', data[prop])
    }
    var err = new Error(msg)
    err.code = e.code
    process.nextTick(function () {
        callback(err)
    })
}

module.exports = api