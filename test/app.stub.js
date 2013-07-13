require('http').createServer(function (req, res) {
    res.end('ok!', 'utf-8')
}).listen(8080)