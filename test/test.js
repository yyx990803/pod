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

var testPort   = process.env.PORT || 18080

var	pod        = require('../lib/pod').initTest(testConfig),
	appsDir    = testConfig.dir + '/apps',
	reposDir   = testConfig.dir + '/repos',
	logsDir    = testConfig.dir + '/logs',
	confDir    = testConfig.dir + '/.podrc'

// prepare temp dir
if (fs.existsSync(testConfig.dir)) {
	deleteDir(testConfig.dir)
}

fs.mkdirSync(testConfig.dir)
fs.mkdirSync(appsDir)
fs.mkdirSync(reposDir)
fs.mkdirSync(logsDir)
fs.mkdirSync(confDir)

describe('API', function () {

	var monitor

	describe('.createApp', function () {

	  	it('should complete without error and invoke callback', function (done) {
        	pod.createApp('test', function (err, msg, appInfo) {
        		assert.ok(!err)
        		assert.ok(appInfo)
        		done()
        	})
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

	describe('.startApp', function () {

		before(function () {
			// create stub for app.js
		    var stub = fs.readFileSync(__dirname + '/app.stub.js', 'utf-8')
		    stub = stub.replace('{{port}}', testPort)
			fs.writeFileSync(appsDir + '/test/app.js', stub)
		})

		it('should complete without error and invoke callback', function (done) {
        	pod.startApp('test', function (err, msg, monit) {
        		assert.ok(!err, 'callback should receive no error')
        		assert.ok(monit, 'callback should receive a monitor process')
        		monitor = monit
        		setTimeout(done, 500) // wait for monitor to start script
        	})
    	})

    	it('should abort if app is already running', function (done) {
		    pod.startApp('test', function (err, msg, monit) {
    	        assert.ok(!err, 'callback should receive no error')
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

	describe('.stopApp', function () {
	    
		it('should stop the app', function (done) {
		    pod.stopApp('test', function (err, msg) {
		    	assert.ok(!err)
		    	assert.ok(/stopped/.test(msg))
		        done()
		    })
		})

	})

	after(function () {
		// kill monitor in case not stopped in test
		monitor && monitor.kill()
	})

})

function deleteDir (path) {
  	if( fs.existsSync(path) ) {
    	fs.readdirSync(path).forEach(function(file,index){
      		var curPath = path + "/" + file
      		if(fs.statSync(curPath).isDirectory()) { // recurse
        		deleteDir(curPath)
      		} else { // delete file
        		fs.unlinkSync(curPath)
      		}
    	})
    	fs.rmdirSync(path)
  	}
}