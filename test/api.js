var assert  = require('assert'),
    fs      = require('fs'),
    path    = require('path'),
    http    = require('http'),
    exec    = require('child_process').exec,
    request = require('request')

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
process.on('exit', function () {
    delete process.env.POD_CONF
})

var pod

// setup ----------------------------------------------------------------------

before(function (done) {
    if (process.platform === 'darwin') {
        // kill the pm2 daemon first.
        // the daemon would malfunction if the Mac went to sleep mode.
        exec('./node_modules/pm2/bin/pm2 kill', function (err) {
            if (!err) {
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
        pod = require('../lib/api')
        pod.once('ready', done)
    })
}

// tests ----------------------------------------------------------------------

describe('API', function () {

    describe('.reloadConfig', function () {

        it('should reload the conf', function () {
            var modified = JSON.parse(fs.readFileSync(testConfPath, 'utf-8'))
            modified.default_script = 'app.js'
            fs.writeFileSync(testConfPath, JSON.stringify(modified))
            var newConf = pod.reloadConfig()
            assert.deepEqual(newConf, modified)
        })

    })

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

        it('should return correct msg if app is not running', function (done) {
            pod.stopApp('test', function (err, msg) {
                assert.ok(!err)
                assert.ok(/not running/.test(msg))
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
            pod.createApp('test3', function () {
                exec('rm -rf ' + appsDir + '/test3', function () {
                    pod.startApp('test', done)
                })
            })
        })

        it('should provide a list of apps\' info', function (done) {
            pod.listApps(function (err, apps) {
                if (err) return done(err)
                assert.equal(apps.length, 3, 'should get three apps')
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

        it('should list broken apps', function () {
            appsResult.forEach(function (app) {
                if (app.name === 'test3') {
                    assert.ok(app.broken)
                }
            })
        })

        after(function (done) {
            pod.removeApp('test3', done)
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

    describe('prune()', function () {

        var files = [
            root + '/prunefile',
            appsDir + '/prunefile',
            reposDir + '/prunefile'
        ]

        var dirs = [
            root + '/prunedir',
            appsDir + '/prunedir',
            reposDir + '/prunedir'
        ]

        before(function () {
            files.forEach(function (f) {
                fs.writeFileSync(f)
            })
            dirs.forEach(function (d) {
                fs.mkdirSync(d)
            })
        })

        it('should remove all extraneous file and directories', function () {
            pod.prune(function (err, msg) {
                assert.ok(!err)
                var fcount = msg.match(/prunefile/g).length,
                    dcount = msg.match(/prunedir/g).length
                assert.equal(fcount, 3)
                assert.equal(dcount, 3)
                files.forEach(function (f) {
                    assert.ok(!fs.existsSync(f))
                })
                dirs.forEach(function (d) {
                    assert.ok(!fs.existsSync(d))
                })
            })
        })

    })

    describe('updateHooks()', function () {

        it('should update the hook to the current template', function (done) {
            var app = pod.getAppInfo('test2'),
                hookPath = app.repoPath + '/hooks/post-receive',
                template = fs.readFileSync(__dirname + '/../hooks/post-receive', 'utf-8'),
                expected = template
                    .replace(/\{\{pod_dir\}\}/g, root)
                    .replace(/\{\{app\}\}/g, app.name)
            fs.writeFileSync(hookPath, '123', 'utf-8')
            pod.updateHooks(function (err) {
                assert.ok(!err)
                var hook = fs.readFileSync(hookPath, 'utf-8')
                assert.strictEqual(hook, expected)
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

    it('should reset working tree if podhook exits with code other than 0', function (done) {

        var commit,
            clonePath = root + '/clone',
            cloneGit = 'git' +
                ' --git-dir=' + clonePath + '/.git' +
                ' --work-tree=' + clonePath

        exec('cp -r ' + app.workPath + ' ' + clonePath, function (err) {
            if (err) return done(err)
            exec(git + ' log -1 | awk \'NR==1 {print $2}\'', function (err, cmt) {
                if (err) return done(err)
                commit = cmt
                modifyHook()
            })
        })

        function modifyHook () {
            // modify hook in a different copy of the repo
            // and push it.
            fs.writeFileSync(clonePath + '/.podhook', 'touch testfile2; exit 1')
            exec(
                cloneGit + ' add ' + clonePath + '; ' +
                cloneGit + ' commit -m \'test2\'; ' +
                cloneGit + ' push origin master',
                function (err) {
                    if (err) return done(err)
                    checkCommit()
                }
            )
        }

        function checkCommit () {
            exec(git + ' log -1 | awk \'NR==1 {print $2}\'', function (err, cmt) {
                if (err) return done(err)
                // make sure the hook is actually executed
                assert.ok(fs.existsSync(app.workPath + '/testfile2'))
                // the restart should have failed
                // and the working copy should have been reverted
                // to the old commit
                assert.equal(cmt, commit)
                done()
            })
        }

    })

})

describe('web interface', function () {

    var webInterfaceId = 'pod-web-service'

    it('should prevent user from deleting it', function (done) {
        pod.removeApp(webInterfaceId, function (err) {
            assert.equal(err.code, 'WEB')
            done()
        })
    })

    it('should start with no problem', function (done) {
        pod.startApp(webInterfaceId, function (err, msg) {
            if (err) return done(err)
            assert.ok(/pod-web-service.*running.*19999/.test(msg))
            done()
        })
    })

    it('should require auth at / and /json', function (done) {
        expectWorkingPort(19999, next, {
            code: 401,
            abort: true,
            delay: 300
        })

        function next () {
            expectWorkingPort(19999, done, {
                path: '/json',
                code: 401,
                abort: true,
                delay: 0
            })
        }
    })

    it('should return html at /', function (done) {
        expectWorkingPort(19999, done, {
            auth: 'admin:admin@',
            delay: 0,
            expect: function (res) {
                assert.ok(/ul id="apps"/.test(res))
                assert.ok(/test2/.test(res))
            }
        })
    })

    it('should return json at /json', function (done) {
        expectWorkingPort(19999, done, {
            path: '/json',
            auth: 'admin:admin@',
            delay: 0,
            expect: function (res) {
                var json
                try {
                    json = JSON.parse(res)
                } catch (e) {
                    done(e)
                }
                assert.equal(json.length, 1)
                assert.equal(json[0].name, 'test2')
            }
        })
    })

})

describe('remote app', function () {

    var repoPath = temp + '/remote-test.git',
        workPath = temp + '/remote-test',
        appPath  = appsDir + '/remote-test',
        port = testPort + 2,
        git = 'git --git-dir=' + workPath + '/.git --work-tree=' + workPath

    before(function (done) {
        exec('git --git-dir=' + repoPath + ' --bare init', function () {
            exec('git clone ' + repoPath + ' ' + workPath, function () {
                fs.writeFileSync(workPath + '/app.js', stubScript.replace('{{port}}', port))
                done()
            })
        })
    })

    it('should create a remote app', function (done) {
        pod.createApp('remote-test', {
            remote: repoPath
        }, function (err, msg) {
            assert.ok(!err)
            assert.equal(msg.length, 3)
            assert.ok(/remote app/.test(msg[1]))
            assert.ok(msg[2].indexOf(repoPath) > 0)
            assert.ok(fs.existsSync(appPath))
            exec(
                git + ' add app.js; ' +
                git + ' commit -m "test"; ' +
                git + ' push origin master',
                done
            )
        })
    })

    it('should refuse webhook if branch doesn\'t match', function (done) {
        request({
            url: 'http://localhost:19999/hooks/remote-test',
            method: 'POST',
            form: {
                ref: 'refs/heads/test',
                head_commit: {
                    message: '123'
                },
                repository: {
                    url: repoPath
                }
            }
        }, function (err) {
            if (err) return done(err)
            setTimeout(function () {
                assert.ok(!fs.existsSync(appPath + '/app.js'))
                done()
            }, 300)
        })
    })

    it('should refuse webhook if repo url doesn\'t match', function (done) {
        request({
            url: 'http://localhost:19999/hooks/remote-test',
            method: 'POST',
            form: {
                ref: 'refs/heads/master',
                head_commit: {
                    message: '123'
                },
                repository: {
                    url: 'lolwut'
                }
            }
        }, function (err) {
            if (err) return done(err)
            setTimeout(function () {
                assert.ok(!fs.existsSync(appPath + '/app.js'))
                done()
            }, 300)
        })
    })

    it('should skip if head commit message contains [pod skip]', function (done) {
        request({
            url: 'http://localhost:19999/hooks/remote-test',
            method: 'POST',
            form: {
                ref: 'refs/heads/master',
                head_commit: {
                    message: '[pod skip]'
                },
                repository: {
                    url: repoPath
                }
            }
        }, function (err) {
            if (err) return done(err)
            setTimeout(function () {
                assert.ok(!fs.existsSync(appPath + '/app.js'))
                done()
            }, 300)
        })
    })

    it('should fetch and run if all requirements are met', function (done) {
        request({
            url: 'http://localhost:19999/hooks/remote-test',
            method: 'POST',
            form: {
                ref: 'refs/heads/master',
                head_commit: {
                    message: '123'
                },
                repository: {
                    url: repoPath
                }
            }
        }, function (err) {
            if (err) return done(err)
            setTimeout(function () {
                assert.ok(fs.existsSync(appPath + '/app.js'))
                expectWorkingPort(port, done, { delay: 1000 })
            }, 300)
        })
    })

    it('should return 200 if request is a webhook ping', function (done) {
        request({
            url: 'http://localhost:19999/hooks/remote-test',
            method: 'POST',
            headers: {
                'X-Github-Event': 'ping'
            },
            form: {
                repository: {
                    url: repoPath
                }
            }
        }, function (err, res) {
            if (err) return done(err)
            assert.equal(res.statusCode, 200)
            done()
        })
    })

    it('should return 500 if request is a webhook ping but path is wrong', function (done) {
        request({
            url: 'http://localhost:19999/hooks/remote-test',
            method: 'POST',
            headers: {
                'X-Github-Event': 'ping'
            },
            form: {
                repository: {
                    url: 'lolwut'
                }
            }
        }, function (err, res) {
            if (err) return done(err)
            assert.equal(res.statusCode, 500)
            done()
        })
    })

})

// clean up -------------------------------------------------------------------

after(function (done) {
    pod.stopAllApps(function (err) {
        if (err) return done(err)
        exec('rm -rf ' + temp + '; pm2 kill', done)
    })
})

// helpers --------------------------------------------------------------------

function expectRestart (port, beforeRestartStamp, done) {
    setTimeout(function () {
        request('http://localhost:' + port, function (err, res, body) {
            if (err) return done (err)
            assert.equal(res.statusCode, 200)
            var restartStamp = body.match(/\((\d+)\)/)[1]
            restartStamp = parseInt(restartStamp, 10)
            assert.ok(restartStamp > beforeRestartStamp)
            done()
        })
    }, 300)
}

function expectWorkingPort (port, done, options) {
    options = options || {}
    setTimeout(function () {
        request('http://' + (options.auth || '') + 'localhost:' + port + (options.path || ''), function (err, res, body) {
            if (err) return done(err)
            assert.equal(res.statusCode, options.code || 200)
            if (options.abort) return done()
            if (options.expect) {
                options.expect(body)
            } else {
                assert.ok(/ok!/.test(body))
            }
            done()
        })
    }, options.delay || 300) // small interval to make sure it has finished
}

function expectBadPort (port, done) {
    request({
        url: 'http://localhost:' + port,
        timeout: 500
    }, function (err, res, body) {
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
            return done()
        }
        if (!err && body) {
            return done(new Error('should not get data back'))
        }
        done(err)
    })
}
