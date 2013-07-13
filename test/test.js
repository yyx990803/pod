var assert = require('assert'),
	fs     = require('fs'),
	exec   = require('child_process').exec

var testConfig = {
    dir: __dirname + '/../temp',
    env: 'development',
    defaultScript: 'app.js',
    editor: 'vi',
    apps: {}
}

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
fs.mkdirSync(appConfDir)

describe('API', function () {

	describe('.createApp', function () {
	  	it('should complete without error and invoke callback', function (done) {
        	pod.createApp('test', done)
    	})
    	it ('should update the config with app\'s entry', function () {
    	    var config = pod.getConfig()
    	    assert.ok(config.apps.test)
    	})
    	it('should create the app\'s directories', function () {
    	    assert.ok(fs.existsSync(appsDir + '/test'), 'working copy')
    	    assert.ok(fs.existsSync(reposDir + '/test.git'), 'git repo')
    	    assert.ok(fs.existsSync(logsDir + '/test'), 'logs dir')
    	})
    	it('should abort if app with that name already exists', function (done) {
    	    pod.createApp('test', function (msg) {
    	        assert.equal(msg, 'an app with that name already exists.')
    	        done()
    	    })
    	})
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