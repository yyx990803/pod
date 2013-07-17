var fs      = require('fs'),
    path    = require('path'),
    async   = require('async'),
    colors  = require('colors'),
    exec    = require('child_process').exec

var globalConfig,
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
        return callback(new Error('app ' + appname.yellow + ' does not exist.'))
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
    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist.'))
    }
    fs.exists(app.script, function (exists) {
        if (!exists) {
            return callback(new Error('cannot locate main script for ' + appname.yellow + '\n' +('(' + app.script + ')').grey))
        }
        exec('pm2 start ' + app.script, function (err, stdout, stderr) {
            if (err) {
                if (stdout.indexOf('already launched') > 0) {
                    callback(new Error(appname.yellow + ' is already running.'))
                }
            } else {
                callback(null, appname.yellow + ' running on port ' + app.port)
            }
        })
    })
}

api.startAllApps = function (callback) {
    async.map(
        Object.keys(globalConfig.apps),
        function (appname, done) {
            api.startApp(appname, done)
        },
        callback
    )
}

api.stopApp = function (appname, callback) {

    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist.'))
    }
    getPmId(app.script, function (err, id) {
        if (err) return callback(err)
        exec('pm2 stop ' + id, function (err) {
            if (err) {
                callback(err)
            } else {
                callback(null, appname.yellow + ' stopped.')
            }
        })
    })
}

api.stopAllApps = function (callback) {
    exec('pm2 stopAll', function (err) {
        if (err) return callback(err)
        callback(null, 'all apps stopped.')
    })
}

api.restartApp = function (appname, callback) {
    
    var app = api.getAppInfo(appname)
    if (!app) {
        return callback(new Error('app ' + appname.yellow + ' does not exist'))
    }
    getPmId(app.script, function (err, id) {
        if (err) return callback(err)
        exec('pm2 restart ' + id, function (err) {
            if (err) return callback(err)
            callback(null, appname.yellow + ' restarted.')
        })
    })
}

api.restartAllApps = function (callback) {
    exec('pm2 restartAll', function (err) {
        if (err) return callback(err)
        callback(null, 'all running apps restarted.')
    })
}

api.listApps = function (callback) {
    var apps = Object.keys(globalConfig.apps)
    if (!apps.length) {
        return callback(null, [])
    }
    exec('pm2 jlist', function (err, list) {
        if (err) return callback(err)
        callback(null, apps.map(function (appname) {
            var app = api.getAppInfo(appname)
            app.isRunning = isRunning(list, app.script)
            return app
        }))
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

function getPmId (script, callback) {
    exec('pm2 jlist', function (err, list) {
        if (err) return callback(err)
        var m = list.match(new RegExp(escapeRegExp(script)+ '[\\s\\S]*?pm_id: (\\d+)'))
        if (!m) return callback(new Error('app is not running.'))
        callback(null, m[1])
    })
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

function isRunning(list, script) {
    // if (!list || !list.length) return false
    // for (var i = 0, j = list.length; i < j; i++) {
    //     if (list[i].script === script) {
    //         console.log(list[i].script, script)
    //         return true
    //     }
    // }
    if (!list) return false
    return list.indexOf(script) > 0
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

    initAPI: function () {
        if (fs.existsSync(globalConfigPath)) {
            globalConfig = readJSON(globalConfigPath)
            return api
        } else {
            throw new Error(
                'cannot locate pod config file. ' +
                'run pod in the command line once first!'
            )
        }
    },

    initCLI: function () {
        if (fs.existsSync(globalConfigPath)) {
            globalConfig = readJSON(globalConfigPath)
            return api
        } else {
            return null
        }
    },

    initConfig: function (root) {
        globalConfig = {
            dir: root,
            env: 'development',
            defaultScript: 'app.js',
            editor: process.env.VISUAL || process.env.EDITOR || 'vi',
            apps: {}
        }
        fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 4))
        var makeDir = function (dir) {
            dir = globalConfig.dir + '/' + dir
            if (!fs.existsSync(dir)) fs.mkdirSync(dir)
        }
        ;['apps', 'repos', 'logs'].forEach(makeDir)
        return api
    }

}

function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}