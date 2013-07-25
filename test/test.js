var assert = require('assert'),
    fs     = require('fs'),
    path   = require('path'),
    http   = require('http'),
    exec   = require('child_process').exec,
    jsc    = require('jscoverage')

jsc.enableCoverage(true)

var temp         = path.resolve(__dirname, '../temp'),
    root         = temp + '/root',
    appsDir      = root + '/apps',
    reposDir     = root + '/repos',
    testConfPath = temp + '/.podrc',
    testConf     = fs.readFileSync(path.resolve(__dirname, 'fixtures/.podrc'), 'utf-8'),
    stubScript   = fs.readFileSync(path.resolve(__dirname, 'fixtures/app.js'), 'utf-8'),
    podhookStub  = fs.readFileSync(path.resolve(__dirname, 'fixtures/.podhook'), 'utf-8'),
    testPort     = process.env.PORT || 18080
    
process.env.POD_CONF = testConfPath

var pod

// setup ----------------------------------------------------------------------

before(function (done) {
    if (process.platform === 'darwin') {
        // kill the pm2 daemon first.
        // the daemon would malfunction if the Mac went to sleep mode.
        exec('killall "pm2: Satan Daemonizer"', function (err) {
            if (!err || err.toString().match(/No matching processes/)) {
                setup(done)
            } else {
                done(err)
            }
        })
    } else {
        setup(done)
    }
})

function setup (done) {
    exec('rm -rf ' + temp, function (err) {
        if (err) return done(err)
        fs.mkdirSync(temp)
        fs.writeFileSync(testConfPath, testConf.replace('{{root}}', root))
        pod = jsc.require(module, '../lib/api')
        pod.on('ready', done)
    })
}

// tests ----------------------------------------------------------------------

describe('API', function () {

    describe('.createApp( appname, [options,] callback )', function () {

        it('should complete without error and invoke callback', function (done) {
            pod.createApp(
                'test',
                {
                    port: testPort,
                    instances: 2
                },
                function (err, msgs, appInfo) {
                    if (err) return done(err)
                    assert.ok(appInfo, 'callback should receive appInfo object')
                    assert.equal(msgs.length, 4, 'should return 4 messages')
                    assert.equal(appInfo.config.port, testPort, 'options should be written to app config')
                    done()
                }
            )
        })

        it ('should update the config with app\'s entry', function () {
            var config = pod.getConfig()
            assert.ok(config.apps.test)
        })

        it('should create the app\'s directories', function () {
            assert.ok(fs.existsSync(appsDir + '/test'), 'should created working copy')
            assert.ok(fs.existsSync(reposDir + '/test.git'), 'should created git repo')
        })

        it('should return error if app with that name already exists', function (done) {
            pod.createApp('test', function (err) {
                assert.ok(err && err.code === 'EXISTS')
                done()
            })
        })

        it('should also work without the optional options', function (done) {
            pod.createApp('test2', function (err, msgs, appInfo) {
                if (err) return done(err)
                assert.ok(appInfo, 'callback should receive appInfo object')
                assert.equal(msgs.length, 4, 'should return 4 messages')
                done()
            })
        })

    })

    describe('.startApp( appname, callback )', function () {

        it('should get an error if cannot locate main script', function (done) {
            pod.startApp('test', function (err) {
                assert.ok(err && err.code === 'NO_SCRIPT', 'should get no script error')
                done()
            })
        })

        it('should complete without error and invoke callback', function (done) {
            var script = stubScript.replace('{{port}}', testPort - 1)
            fs.writeFileSync(appsDir + '/test/app.js', script)
            pod.startApp('test', done)
        })

        it('should give back message if app is already running', function (done) {
            pod.startApp('test', function (err, msg) {
                assert.ok(!err, 'should get no error')
                assert.ok(/already\srunning/.test(msg), 'should receive correct message')
                done()
            })
        })

        it('should accept http request on port ' + testPort, function (done) {
            expectWorkingPort(testPort, done)
        })

        it('should return error if app does not exist', function (done) {
            pod.startApp('doesnotexist', function (err) {
                assert.ok(err && err.code === 'NOT_FOUND')
                done()
            })
        })

    })

    describe('.stopApp( appname, callback )', function () {
        
        it('should stop the app', function (done) {
            pod.stopApp('test', function (err, msg) {
                if (err) return done(err)
                assert.ok(/stopped/.test(msg))
                done()
            })
        })

        it('should no longer be using port ' + testPort, function (done) {
            expectBadPort(testPort, done)
        })

        it('should return error if app does not exist', function (done) {
            pod.stopApp('doesnotexist', function (err) {
                assert.ok(err && err.code === 'NOT_FOUND')
                done()
            })
        })

    })

    describe('.startAllApps( callback )', function () {

        before(function () {
            var script = stubScript.replace('{{port}}', testPort + 1)
            fs.writeFileSync(appsDir + '/test2/app.js', script)
        })

        it('should start all apps', function (done) {
            pod.startAllApps(function (err, msgs) {
                if (err) return done(err)
                assert.ok(Array.isArray(msgs), 'should get an array of messages')
                assert.equal(msgs.length, 2, 'should get two messages')
                done()
            })
        })

        it('should accept http request on both ports', function (done) {
            expectWorkingPort(testPort, function () {
                expectWorkingPort(testPort + 1, done)
            })
        })

    })

    describe('.stopAllApps( callback )', function () {
        
        it('should not get an error', function (done) {
            pod.stopAllApps(function (err, msgs) {
                if (err) return done(err)
                assert.ok(Array.isArray(msgs), 'should get an array of messages')
                assert.equal(msgs.length, 2, 'should get two messages')
                done()
            })
        })

        it('should no longer be using the two ports', function (done) {
            expectBadPort(testPort, function () {
                expectBadPort(testPort + 1, done)
            })
        })

    })

    describe('.listApps( callback )', function () {

        var appsResult

        before(function (done) {
            pod.startApp('test', done)
        })
        
        it('should provide a list of apps\' info', function (done) {
            pod.listApps(function (err, apps) {
                if (err) return done(err)
                assert.equal(apps.length, 2, 'should get two apps')
                appsResult = apps
                done()
            })
        })

        it('should contain correct app running status', function () {
            appsResult.forEach(function (app) {
                if (app.name === 'test') {
                    assert.ok(app.instances, 'test should be on')
                }
                if (app.name === 'test2') {
                    assert.ok(!app.instances, 'test2 should be off')
                }
            })
        })

    })

    describe('.restartApp( appname, callback )', function () {

        var beforeRestartStamp
        
        it('should restart a running app without error', function (done) {
            beforeRestartStamp = Date.now()
            pod.restartApp('test', done)
        })

        it('should have indeed restarted the process', function (done) {
            expectRestart(testPort, beforeRestartStamp, done)
        })

        it('should get an error trying to restart a non-running app', function (done) {
            pod.restartApp('test2', function (err) {
                assert.ok(err && err.code === 'NOT_RUNNING')
                done()
            })
        })

        it('should return error if app does not exist', function (done) {
            pod.restartApp('doesnotexist', function (err) {
                assert.ok(err && err.code === 'NOT_FOUND')
                done()
            })
        })

    })

    describe('.restartAllApps()', function () {
        
        var beforeRestartStamp

        it('should stop all running instances', function (done) {
            beforeRestartStamp = Date.now()
            pod.restartAllApps(function (err, msgs) {
                if (err) return done(err)
                assert.ok(Array.isArray(msgs), 'should get an array of messages')
                assert.equal(msgs.length, 2, 'should get 2 messages (test has 2 instances)')
                done()
            })
        })

        it('should have indeed restarted the running process', function (done) {
            expectRestart(testPort, beforeRestartStamp, done)
        })

        it('should not start the non-running app', function (done) {
            expectBadPort(testPort + 1, done)
        })

    })

    describe('.removeApp( appname, callback )', function () {

        var app

        before(function (done) {
            app = pod.getAppInfo('test')
            pod.removeApp('test', function (err) {
                if (err) return done(err)
                done()
            })
        })

        it('should have deleted the app from config', function () {
            var config = pod.getConfig()
            assert.ok(!('test' in config.apps), 'test should no longer be in apps')
        })
        
        it('should have removed all the app files', function () {
            assert.ok(!fs.existsSync(app.workPath), 'working copy')
            assert.ok(!fs.existsSync(app.repoPath), 'git repo')
        })

        it('should have stopped the deleted app\'s process', function (done) {
            expectBadPort(testPort, done)
        })

        it('should return error if app does not exist', function (done) {
            pod.removeApp('doesnotexist', function (err) {
                assert.ok(err && err.code === 'NOT_FOUND')
                done()
            })
        })

    })

})

describe('git push', function () {

    var app, git, beforeRestartStamp

    before(function (done) {
        app = pod.getAppInfo('test2')
        git = 'git' +
            ' --git-dir=' + app.workPath + '/.git' +
            ' --work-tree=' + app.workPath
        
        // add custom hook
        fs.writeFileSync(app.workPath + '/.podhook', podhookStub)
        
        // modify git post-receive hook for test
        var hookPath = app.repoPath + '/hooks/post-receive',
            hook = fs.readFileSync(hookPath, 'utf-8').replace(/^pod\s/g, 'POD_CONF=' + testConfPath + ' pod ')
        fs.writeFileSync(hookPath, hook)
        
        exec(
            git + ' add ' + app.workPath + '; ' +
            git + ' commit -m \'test\'',
            done
        )
    })

    it('shoud complete without error', function (done) {
        beforeRestartStamp = Date.now()
        exec(git + ' push origin master', done)
    })

    it('should have restarted the app', function (done) {
        expectRestart(testPort + 1, beforeRestartStamp, done)
    })

    it('should have executed the custom hook', function () {
        assert.ok(fs.existsSync(app.workPath + '/testfile'))
    })
    
})

// clean up -------------------------------------------------------------------

after(function (done) {
    pod.stopAllApps(function (err) {
        if (err) return done(err)
        exec('rm -rf ' + temp, done)
    })
})

// helpers --------------------------------------------------------------------

function expectRestart (port, beforeRestartStamp, done) {
    http.get('http://localhost:' + port, function (res) {
        assert.equal(res.statusCode, 200)
        res.setEncoding('utf-8')
        res.on('data', function (data) {
            var restartStamp = data.match(/\((\d+)\)/)[1]
            restartStamp = parseInt(restartStamp, 10)
            assert.ok(restartStamp > beforeRestartStamp)
            done()
        })
    })
}

function expectWorkingPort (port, done) {
    setTimeout(function () {
        http.get('http://localhost:' + port, function (res) {
            assert.equal(res.statusCode, 200)
            res.setEncoding('utf-8')
            res.on('data', function (data) {
                assert.ok(/ok!/.test(data))
                done()
            })
        })
    }, 100) // small interval to make sure it has finished
}

function expectBadPort (port, done) {
    var timeout = false,
        refused = false
    var req = http.get('http://localhost:' + port, function (res) {
        res.on('data', function () {
            if (!timeout) done(new Error('should not get data back'))
        })
    })
    req.on('error', function (err) {
        if (err.code === 'ECONNREFUSED') {
            refused = true
            done()
        }
    })
    setTimeout(function () {
        timeout = true
        if (!refused) done()
    }, 300)
}

// report coverage ------------------------------------------------------------

process.on('exit', function () {
    jsc.coverage()
})