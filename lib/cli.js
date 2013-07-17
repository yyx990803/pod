var fs     = require('fs'),
    path   = require('path'),
    spawn  = require('child_process').spawn,
    argv   = require('optimist').argv,
    colors = require('colors')
    api    = require('./api')

var globalConfigPath = require('./conf')

api.on('ready', init)

var cli    = {

    help: function () {
        console.log('\n  POD '.green + 'v' + api.version)
        console.log(fs.readFileSync(__dirname + '/../help/usage', 'utf-8'))
        process.exit(0)
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
        prompt('really delete ' + appname.yellow + '? (y/N)', function (reply) {
            if (reply.toLowerCase() === 'y') {
                api.removeApp(appname, output)
            } else {
                log('aborted.')
                process.exit(0)
            }
        })
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

    cleanlogs: function (appname) {
        if (!appname) return
        api.cleanAppLog(appname, output)
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
            process.exit(0)
        })
    }

}

function init () {
    if (!fs.existsSync(globalConfigPath)) {
        console.log('Hello! It seems it\'s your first time running pod on this machine.')
        prompt('Please specify a root directory for pod to store all the files (repos, logs, apps):', function (dir) {
            dir = path.resolve(process.cwd(), dir)
            if (fs.existsSync(dir)) {
                if (!fs.statSync(dir).isDirectory()) {
                    return warn('target path ' + dir.grey + ' is not a directory.')
                    process.exit(1)
                } else {
                    initConfig(dir)
                    parseCommand()
                }
            } else {
                prompt('target path ' + dir.grey + ' doesn\'t exist. create it? (y/N)', function (reply) {
                    if (reply.toLowerCase() === 'y') {
                        fs.mkdirSync(dir)
                        initConfig(dir)
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
}

function initConfig (root) {
    globalConfig = {
        root: root,
        nodeEnv: 'development',
        defaultScript: 'app.js',
        editor: process.env.VISUAL || process.env.EDITOR || 'vi',
        apps: {}
    }
    fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 4))
}

function parseCommand () {
    var command = argv._[0] || 'help'
    if (cli[command]) {
        cli[command](argv._[1])
    } else {
        if (command) {
            warn('unknown command ' + command.red)
            process.exit(1)
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

function edit (file) {
    process.stdin.setRawMode(true)
    var p = spawn(api.getConfig().editor, [file], {
        customFds: [ 0, 1, 2 ]
    })
    p.on('exit', function () {
        process.stdin.setRawMode(false)
        process.exit(0)
    })
}

function output (err, msg) {
    if (err) {
        warn(err)
        process.exit(0)
    } else {
        log(msg)
        process.exit(1)
    }
}

function log (msg) {
    if (!Array.isArray(msg)) {
        console.log('POD '.green + msg)
    } else {
        msg.forEach(function (m) {
            console.log('POD '.green + m)
        })
    }
}

function warn (err) {
    err = err.toString().replace('Error: ', '')
    console.warn('POD '.green + 'ERR '.red + err)
}