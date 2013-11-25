var http     = require('http'),
    fs       = require('fs'),
    express  = require('express'),
    confPath = require('../lib/conf').path,
    conf     = JSON.parse(fs.readFileSync(confPath))

http.createServer(function (req, res) {
    res.end(conf.web.password)
}).listen(process.env.PORT || 19999)