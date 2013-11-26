var http     = require('http'),
    fs       = require('fs'),
    path     = require('path'),
    spawn    = require('child_process').spawn,
    express  = require('express'),
    confPath = require('../lib/conf').path,
    conf     = JSON.parse(fs.readFileSync(confPath)),
    pod      = require('../lib/api'),
    app      = express()

var username = conf.web.username || 'admin',
    password = conf.web.password || 'admin',
    auth     = express.basicAuth(username, password)

app.configure(function(){
    app.set('views', __dirname + '/views')
    app.set('view engine', 'ejs')
    app.use(express.favicon())
    app.use(reloadConf)
    app.use(app.router)
    app.use(express.static(path.join(__dirname, 'static')))
})

app.get('/', auth, function (req, res) {
    pod.listApps(function (err, list) {
        if (err) return res.end(err)
        res.render('index', {
            apps: list
        })
    })
})

app.get('/json', auth, function (req, res) {
    pod.listApps(function (err, list) {
        if (err) return res.end(err)
        res.json(list)
    })
})

if (conf.web.jsonp === true) {
    app.get('/jsonp', function (req, res) {
        pod.listApps(function (err, list) {
            if (err) return res.end(err)
            res.jsonp(list)
        })
    })
}

app.post('/hooks/:appid', express.bodyParser(), function (req, res) {
    var appid = req.params.appid,
        payload = req.body.payload,
        app = conf.apps[appid]

    try {
        payload = JSON.parse(payload)
    } catch (e) {
        return res.end(e.toString())
    }

    if (app && verify(req, app, payload)) {
        executeHook(appid, app, payload, function () {
            res.end()
        })
    } else {
        res.end()
    }
})

app.listen(process.env.PORT || 19999)

function verify (req, app, payload) {
    // not even a remote app
    if (!app.remote) return
    // check repo match
    var repo = payload.repository
    console.log('\nreceived webhook request from: ' + repo.url)
    if (strip(repo.url) !== strip(app.remote)) {
        console.log('aborted.\n')
        return
    }
    // skip it with [pod skip] message
    var commit = payload.head_commit
    console.log('commit message: ' + commit.message)
    if (/\[pod skip\]/.test(commit.message)) {
        console.log('aborted.\n')
        return
    }
    // check branch match
    var branch = payload.ref.replace('refs/heads/', ''),
        expected = app.branch || 'master'
    console.log('expected branch: ' + expected + ', got branch: ' + branch)
    if (branch !== expected) {
        console.log('aborted.\n')
        return
    }
    return true
}

function executeHook (appid, app, payload, cb) {
    fs.readFile(path.resolve(__dirname, '../hooks/post-receive'), 'utf-8', function (err, template) {
        if (err) return cb(err)
        var hookPath = conf.root + '/temphook.sh',
            hook = template
                .replace(/\{\{pod_dir\}\}/g, conf.root)
                .replace(/\{\{app\}\}/g, appid)
        if (app.branch) {
            hook = hook.replace('origin/master', 'origin/' + app.branch)
        }
        fs.writeFile(hookPath, hook, function (err) {
            if (err) return cb(err)
            fs.chmod(hookPath, '0777', function (err) {
                if (err) return cb(err)
                console.log('excuting github webhook for ' + appid + '...')
                var child = spawn('bash', [hookPath])
                child.stdout.pipe(process.stdout)
                child.stderr.pipe(process.stderr)
                child.on('exit', function (code) {
                    fs.unlink(hookPath, cb)
                })
            })
        })
    })
}

function reloadConf (req, res, next) {
    try {
        conf = JSON.parse(fs.readFileSync(confPath))
    } catch (e) {
        console.error('config file seems to be broken!')
    }
    next()
}

function strip (url) {
    return url.replace(/(https?|git):\/\/github\.com\/|\.git/g, '')
}