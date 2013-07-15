var assert = require('assert'),
	fs     = require('fs'),
	http   = require('http'),
	exec   = require('child_process').exec

var testConfig = {
    dir: __dirname + '/../temp',
    env: 'development',
    defaultScript: 'app.js',
    editor: 'vi',
    apps: {}
}

var testPort   = process.env.PORT || 18080,
	stubScript = fs.readFileSync(__dirname + '/fixtures/app.js', 'utf-8')

var	pod        = require('../lib/pod').initTest(testConfig),
	appsDir    = testConfig.dir + '/apps',
	reposDir   = testConfig.dir + '/repos',
	logsDir    = testConfig.dir + '/logs',
	confDir    = testConfig.dir + '/.podrc'

describe('API', function () {

	before(function (done) {
	    exec('rm -rf ' + testConfig.dir, function (err) {
	        if (err) throw err
	        fs.mkdirSync(testConfig.dir)
			fs.mkdirSync(appsDir)
			fs.mkdirSync(reposDir)
			fs.mkdirSync(logsDir)
			fs.mkdirSync(confDir)
			done()
		})
	})

	describe('.createApp(appname, [options,] callback)', function () {

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

	})

	describe('.startApp(appname, callback)', function () {

		before(function () {
			var script = stubScript.replace('{{port}}', testPort)
			fs.writeFileSync(appsDir + '/test/app.js', script)
		})

		it('should complete without error and invoke callback', function (done) {
        	pod.startApp('test', function (err, msg, monitor) {
        		if (err) return done(err)
        		assert.ok(monitor, 'callback should receive a monitor process')
        		setTimeout(done, 500) // wait for monitor to start script
        	})
    	})

    	it('should abort if app is already running', function (done) {
		    pod.startApp('test', function (err, msg, monit) {
		    	if (err) return done(err)
    	        assert.ok(/already\srunning/.test(msg), 'callback should receive correct message')
    	        assert.ok(!monit, 'callback should receive no monitor process')
    	        done()
    	    })
    	})

    	it('should accept http request on port ' + testPort, function (done) {
	        http.get('http://localhost:' + testPort, function (res) {
    	        assert.equal(res.statusCode, 200)
    	        res.setEncoding('utf-8')
    	        res.on('data', function (data) {
    	            assert.equal(data, 'ok!')
    	            done()
    	        })
    	    })
    	})

	})

	describe('.stopApp(appname, callback)', function () {
	    
		it('should stop the app', function (done) {
		    pod.stopApp('test', function (err, msg) {
		    	if (err) return done(err)
		    	assert.ok(/stopped/.test(msg))
		        done()
		    })
		})

		it('should no longer be using port ' + testPort, function (done) {
			var req = http.get('http://localhost:' + testPort)
			req.on('error', function (err) {
			    assert.equal(err.code, 'ECONNREFUSED')
			    done()
			})
		})

	})

	describe('.startAllApps()', function () {

		before(function (done) {
		    pod.createApp('test2', function () {
		    	var script = stubScript.replace('{{port}}', testPort + 1)
				fs.writeFileSync(appsDir + '/test2/app.js', script)
				done()
		    })
		})

		it('should start all apps', function (done) {
		    pod.startAllApps(function (err, msgs) {
		    	assert.ok(!err, 'should get no error')
		        assert.equal(msgs.length, 2, 'should get two message')
		        setTimeout(done, 500)
		    })
		})

		it('should accept http request on both ports', function (done) {
			// first port
	        http.get('http://localhost:' + testPort, function (res) {
    	        assert.equal(res.statusCode, 200)
    	        res.setEncoding('utf-8')
    	        res.on('data', function (data) {
    	            assert.equal(data, 'ok!')
    	            // second port
    	            http.get('http://localhost:' + (testPort + 1), function (res) {
		    	        assert.equal(res.statusCode, 200)
		    	        res.setEncoding('utf-8')
		    	        res.on('data', function (data) {
		    	            assert.equal(data, 'ok!')
		    	            done()
		    	        })
		    	    })

    	        })
    	    })
    	})

	})

	describe('.stopAllApps()', function () {
	    
		it('should stop all apps', function (done) {
		    pod.stopAllApps(function (err, msgs) {
		    	assert.ok(!err, 'should get no error')
		        assert.equal(msgs.length, 2, 'should get two message')
		        done()
		    })
		})

		it('should no longer be using the two ports', function (done) {
			// port1
			var req = http.get('http://localhost:' + testPort)
			req.on('error', function (err) {
			    assert.equal(err.code, 'ECONNREFUSED')
			    // port 2
			    var req2 = http.get('http://localhost:' + (testPort + 1))
			    req2.on('error', function (err) {
			        assert.equal(err.code, 'ECONNREFUSED')
			        done()
			    })
			})
		})

	})

	after(function () {
		// kill test processes in case not stopped in test
		// http://stackoverflow.com/questions/3510673/find-and-kill-a-process-in-one-line-using-bash-and-regex
		exec("kill $(ps ax | grep '[t]emp/apps/test.*/app\.js' | awk '{print $1}')", function (err) {
		    if (err) throw err
		})
	})

})