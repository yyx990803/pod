var fs     = require('fs'),
    path   = require('path'),
    spawn  = require('child_process').spawn,
    colors = require('colors'),
    mkdirp = require('mkdirp'),
    Table  = require('cli-table'),
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

    config: function () {
        edit(globalConfigPath)
    },

    create: function (appname) {
        if (!appname) process.exit(1)
        api.createApp(appname, output)
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
        if (!appname) process.exit(1)
        if (force) {
            return api.removeApp(appname, output)
        }
        rl.question('really delete ' + appname.yellow + '? (y/N)', function (reply) {
            if (reply.toLowerCase() === 'y') {
                api.removeApp(appname, output)
            } else {
                log('aborted.')
                process.exit(0)
            }
        })
    },

    start: function (appname) {
        if (!appname) process.exit(1)
        api.startApp(appname, output)
    },

    stop: function (appname) {
        if (!appname) process.exit(1)
        api.stopApp(appname, output)
    },

    restart: function (appname) {
        if (!appname) process.exit(1)
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
        if (!appname) process.exit(1)
        edit(api.getAppInfo(appname).repoPath + '/hooks/post-receive')
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
                apps.forEach(function (app) {
                    table.push(toArray(app))
                })
                console.log(table.toString())
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

    web: function (stop) {
        if (stop === 'stop') {
            api.stopApp(webInterfaceId, output)
        } else {
            api.startApp(webInterfaceId, output)
        }
    }
}

// Init
if (!fs.existsSync(globalConfigPath)) {
    console.log('Hello! It seems it\'s your first time running pod on this machine.')
    if (process.env.ROOT_DIR) return createRootDir(process.env.ROOT_DIR)
    rl.question('Please specify a root directory for pod to store your apps\' repos and work trees:', createRootDir)
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
            return warn('target path ' + dir.grey + ' is not a directory.')
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
        mkdirp.sync(dir)
        fs.mkdirSync(dir + '/repos')
        fs.mkdirSync(dir + '/apps')
        initConfig(dir)
        loadAPI()
    }
}

function initConfig (root) {
    var globalConfig = {
        root: root,
        nodeEnv: 'development',
        defaultScript: 'app.js',
        editor: stripArgs(process.env.VISUAL) || stripArgs(process.env.EDITOR) || 'vi',
        apps: {},
        web: {},
        remotes: {}
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

function edit (file) {
    process.stdin.setRawMode(true)
    var p = spawn(api.getConfig().editor, [file], {
        customFds: [ 0, 1, 2 ]
    })
    p.once('exit', function () {
        process.stdin.setRawMode(false)
        process.exit(0)
    })
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
    var l            = app.instances && app.instances.length,
        instances    = l > 1 ? (' (' + l + ')') : '',
        name         = app.name.yellow + instances,
        port         = app.port || '????',
        status       = app.broken
                       ? 'BROKEN'.red
                       : app.instances
                           ? 'ON '.green
                           : 'OFF'.magenta
    if (l) {
        var restarts = countTotalRestarts(app.instances),
            uptime   = formatTime(app.instances[0].pm2_env.pm_uptime).cyan,
            memory   = formatMemory(app.instances),
            cpu      = formatCPU(app.instances)
        if (restarts === 0) restarts = restarts.toString().green
        if (restarts > 0 && restarts < 10) restarts = restarts.toString().yellow
        if (restarts > 10) restarts = restarts.toString().red
    }
    return [name, status, port, restarts || '', uptime || '', memory || '', cpu || '']
}

function countTotalRestarts (instances) {
    var restarts = 0
    instances.forEach(function (ins) {
        restarts += ins.pm2_env.restart_time
    })
    return restarts
}

function formatTime (uptime) {
    uptime = Date.now() - uptime
    var sec_num = Math.floor(uptime / 1000),
        days    = Math.floor(sec_num / 86400),
        hours   = Math.floor(sec_num / 3600) % 24,
        minutes = Math.floor(sec_num / 60) % 60,
        seconds = sec_num % 60,
        ret     = []
    if (hours   < 10) hours   = "0" + hours
    if (minutes < 10) minutes = "0" + minutes
    if (seconds < 10) seconds = "0" + seconds
    ret.push(hours, minutes, seconds)
    return (days ? days + 'd ' : '')  + ret.join(':')
}

function formatMemory (instances) {
    var mem = 0,
        mb = 1048576
    instances.forEach(function (ins) {
        mem += ins.monit.memory
    })
    if (mem > mb) {
        return (mem / mb).toFixed(2) + ' mb'
    } else {
        return (mem / 1024).toFixed(2) + ' kb'
    }
}

function formatCPU (instances) {
    var total = 0
    instances.forEach(function (ins) {
        total += ins.monit.cpu
    })
    return total.toFixed(2) + '%'
}