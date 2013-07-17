var assert = require('assert'),
	fs     = require('fs'),
	path   = require('path'),
	http   = require('http'),
	exec   = require('child_process').exec

var testConfig = {
    dir: path.resolve(__dirname, '../temp'),
    env: 'development',
    defaultScript: 'app.js',
    editor: 'vi',
    apps: {}
}

var appsDir    = testConfig.dir + '/apps',
	reposDir   = testConfig.dir + '/repos',
	logsDir    = testConfig.dir + '/logs'
	testPort   = process.env.PORT || 18080,
	stubScript = fs.readFileSync(__dirname + '/fixtures/app.js', 'utf-8')

var	pod        = require('../lib/core').initTest(testConfig),
	ready      = false

pod.on('ready', function () {
    if (ready) {
    	ready()
    } else {
    	ready = true
    }
})

describe('API', function () {

	before(function (done) {
	    exec('rm -rf ' + testConfig.dir, function (err) {
	        if (err) return done(err)
	        fs.mkdirSync(testConfig.dir)
			fs.mkdirSync(appsDir)
			fs.mkdirSync(reposDir)
			fs.mkdirSync(logsDir)
			if (ready) {
				done()
			} else {
				ready = done
			}
		})
	})

	describe('.createApp( appname, [options,] callback )', function () {

	  	it('should complete without error and invoke callback', function (done) {
        	pod.createApp(
        		'test',
        		{ port: testPort },
        		function (err, msgs, appInfo) {
        			if (err) return done(err)
        			assert.ok(appInfo, 'callback should receive appInfo object')
        			assert.equal(msgs.length, 5, 'should return 5 messages')
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
    	    assert.ok(fs.existsSync(logsDir + '/test'), 'should created logs dir')
    	})

    	it('should return error if app with that name already exists', function (done) {
    	    pod.createApp('test', function (err) {
    	        assert.ok(err)
    	        done()
    	    })
    	})

    	it('should also work without the optional options', function (done) {
    	    pod.createApp('test2', function (err, msgs, appInfo) {
		    	if (err) return done(err)
        		assert.ok(appInfo, 'callback should receive appInfo object')
        		assert.equal(msgs.length, 5, 'should return 5 messages')
				done()
		    })
    	})

	})

	describe('.startApp( appname, callback )', function () {

		before(function () {
			var script = stubScript.replace('{{port}}', testPort)
			fs.writeFileSync(appsDir + '/test/app.js', script)
		})

		it('should complete without error and invoke callback', function (done) {
        	pod.startApp('test', done)
    	})

    	it('should abort if app is already running', function (done) {
		    pod.startApp('test', function (err, msg) {
    	        assert.ok(/already\srunning/.test(msg), 'callback should receive right error')
    	        done()
    	    })
    	})

    	it('should accept http request on port ' + testPort, function (done) {
	        expectWorkingPort(testPort, done)
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
		        assert.equal(msgs.length, 2, 'should get two message')
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
		    	// assert.ok(Array.isArray(msgs), 'should get an array of messages')
		     	// assert.equal(msgs.length, 2, 'should get two message')
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
			    	assert.ok(app.isRunning, 'test should be on')
			    }
			    if (app.name === 'test2') {
			    	assert.ok(!appsResult[1].isRunning, 'test2 should be off')
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
		        assert.ok(/is not running/.test(err.toString()))
		        done()
		    })
		})

	})

	describe('.restartAllApps()', function () {
	    
		var beforeRestartStamp

		it('should get no error', function (done) {
		    beforeRestartStamp = Date.now()
		    pod.restartAllApps(done)
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
	    
		it('should remove all the app files', function () {
		    assert.ok(!fs.existsSync(app.workPath), 'working copy')
		    assert.ok(!fs.existsSync(app.logPath), 'logs dir')
		    assert.ok(!fs.existsSync(app.repoPath), 'git repo')
		})

		it('should have stopped the deleted app\'s process', function (done) {
		    expectBadPort(testPort, done)
		})

	})

	describe('.cleanAppLog( appname, callback )', function () {
	    
		it('should remove all log files for the app', function (done) {
			var app = pod.getAppInfo('test2')
		    pod.cleanAppLog('test2', function (err) {
		        if (err) return done(err)
		        assert.ok(!fs.existsSync(app.logPath + '/forever.log'), 'forever')
		    	assert.ok(!fs.existsSync(app.logPath + '/stdout.log'), 'stdout')
		    	assert.ok(!fs.existsSync(app.logPath + '/stderr.log'), 'stderr')
		    	done()
		    })
		})

	})

})

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
    http.get('http://localhost:' + port, function (res) {
        assert.equal(res.statusCode, 200)
        res.setEncoding('utf-8')
        res.on('data', function (data) {
            assert.ok(/ok!/.test(data))
            done()
        })
    })
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