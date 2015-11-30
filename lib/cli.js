var fs     = require('fs'),
    path   = require('path'),
    spawn  = require('child_process').spawn,
    colors = require('colors'),
    mkdirp = require('mkdirp'),
    Table  = require('cli-table'),
    format = require('./formatter').format,
    api

var rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
})

var conf = require('./conf'),
    globalConfigPath = conf.path,
    webInterfaceId   = conf.webId

var tableOptions = {
    style: { compact: true, 'padding-left': 4 },
    chars: { 'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': ''
     , 'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' , 'bottom-right': ''
     , 'left': '' , 'left-mid': '' , 'mid': '' , 'mid-mid': ''
     , 'right': '' , 'right-mid': '' , 'middle': ' ' },
    head: ['name', 'status', 'port', 'restarts', 'uptime', 'memory', 'CPU'].map(function (field) {
        return field.grey
    })
}

var cli = {

    help: function () {
        console.log('\n  POD '.green + 'v' + api.version)
        console.log(fs.readFileSync(__dirname + '/../help/usage', 'utf-8'))
        process.exit(0)
    },

    create: function (appname) {
        if (!appname) exit()

        rl.close()
        api.createApp(appname, output)
    },

    remote: function (appname, repo, branch) {
        if (!appname || !repo) exit()

        rl.close()
        api.createApp(appname, {
            remote: repo,
            branch: branch
        }, output)
    },

    rm: function (arg1, arg2) {
        var force = false,
            appname = arg1
        if (arg1 === '-f') {
            force = true
            appname = arg2
        } else if (arg2 === '-f') {
            force = true
        }
        if (!appname) exit()
        if (force) {
            rl.close()
            return api.removeApp(appname, output)
        }
        rl.question('really delete ' + appname.yellow + '? (y/N)', function (reply) {
            if (reply.toLowerCase() === 'y') {
                rl.close()
                api.removeApp(appname, output)
            } else {
                log('aborted.')
                process.exit(0)
            }
        })
    },

    start: function (appname) {
        if (!appname) exit()
        api.startApp(appname, output)
    },

    stop: function (appname) {
        if (!appname) exit()
        api.stopApp(appname, output)
    },

    restart: function (appname) {
        if (!appname) exit()
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

    list: function () {
        api.listApps(function (err, apps) {
            if (err) {
                warn(err)
                process.exit(1)
            }
            if (!apps || !apps.length) {
                log('no apps found.')
            } else {
                var table = new Table(tableOptions)
                table.push(new Array(7))
                apps.forEach(function (app) {
                    table.push(toArray(app))
                })
                console.log()
                console.log(table.toString())
                console.log()
            }
            process.exit(0)
        })
    },

    prune: function () {
        api.prune(output)
    },

    hooks: function () {
        api.updateHooks(output)
    },

    web: function (action) {
        if (action === 'stop') {
            api.stopApp(webInterfaceId, output)
        } else if (action === 'restart') {
            api.restartApp(webInterfaceId, output)
        } else if (action === 'status') {
            logStatus()
        } else {
            api.startApp(webInterfaceId, function (err, msg) {
                if (msg && msg.indexOf('already') > 0) { // web interface already on
                    logStatus()
                } else {
                    output(err, msg)
                }
            })
        }

        function logStatus () {
            api.proxy('getMonitorData', {}, function (err, list) {
                if (err) return output(err)
                list.forEach(function (proc) {
                    if (proc.pm2_env.name === webInterfaceId) {
                        var app = api.getAppInfo(webInterfaceId)
                        app.instances = [proc]
                        var table = new Table(tableOptions)
                        table.push(toArray(format(app)))
                        console.log(table.toString())
                        process.exit(0)
                    }
                })
                output(null, 'web interface is not running.')
            })
        }
    }
}

// Init
if (!fs.existsSync(globalConfigPath)) {
    if (process.env.POD_ROOT_DIR) return createRootDir(process.env.POD_ROOT_DIR)
    console.log(
        'Hello! It seems it\'s your first time running pod on this machine.\n' +
        'Please specify a directory for pod to put stuff in.\n' +
        '- Make sure your account has full access to that directory.\n' +
        '- You can use relative paths (resolved against your cwd).'
    )
    rl.question('path: ', createRootDir)
} else {
    loadAPI()
}

function createRootDir (dir) {
    if (dir.charAt(0) === '~') { // home path
        dir = process.env.HOME + dir.slice(1)
    } else {
        dir = path.resolve(process.cwd(), dir)
    }
    if (fs.existsSync(dir)) {
        if (!fs.statSync(dir).isDirectory()) {
            warn('target path ' + dir.grey + ' is not a directory.')
            process.exit(1)
        } else {
            initConfig(dir)
            loadAPI()
        }
    } else {
        if (process.env.TEST) return make()
        rl.question('target path ' + dir.grey + ' doesn\'t exist. create it? (y/N)', function (reply) {
            if (reply.toLowerCase() === 'y') {
                make()
            } else {
                process.exit(0)
            }
        })
    }

    function make () {
        console.log()
        mkdirp.sync(dir)
        log('created root directory: ' + dir.grey)
        fs.mkdirSync(dir + '/repos')
        log('created repos directory: ' + (dir + '/repos').grey)
        fs.mkdirSync(dir + '/apps')
        log('created apps directory: ' + (dir + '/apps').grey)
        initConfig(dir)
        log('created config file at: ' + globalConfigPath.grey)
        loadAPI()
    }
}

function initConfig (root) {
    var globalConfig = {
        root: root,
        node_env: 'development',
        default_script: 'app.js',
        apps: {},
        web: {}
    }
    mkdirp.sync(globalConfigPath.slice(0, globalConfigPath.lastIndexOf('/')))
    fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 4))
}

// env editor vars might contain args, which breaks edit()
function stripArgs (cmd) {
    if (cmd) return cmd.split(' ')[0]
}

function loadAPI () {
    api = require('./api')
    api.once('ready', parseCommand)
}

function parseCommand () {
    var args = process.argv.slice(2),
        command = args[0] || 'help'
    if (cli[command]) {
        cli[command].apply(null, args.slice(1))
    } else {
        if (command) {
            warn('unknown command ' + command.red)
            process.exit(1)
        }
    }
}

function output (err, msg) {
    if (err) {
        warn(err)
        process.exit(1)
    } else {
        log(msg)
        process.exit(0)
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

function toArray (app) {

    var restarts = app.restarts
    if (restarts === 0) restarts = restarts.toString().green
    if (restarts > 0 && restarts < 10) restarts = restarts.toString().yellow
    if (restarts > 10) restarts = restarts.toString().red

    var status = app.status
    if (status === 'ON') status = status.green
    if (status === 'OFF') status = status.magenta
    if (status === 'BROKEN' || status === 'ERROR') status = status.red

    var uptime = app.uptime
    if (uptime) uptime = uptime.cyan

    return [
        app.name.yellow,
        status,
        app.port,
        restarts || '',
        uptime || '',
        app.memory || '',
        app.cpu || ''
    ]
}

function exit () {
    warn('invalid command arguments')
    process.exit(1)
}
