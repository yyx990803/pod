var startTime = Date.now()
require('http').createServer(function (req, res) {
    res.end('ok! process started on: (' + startTime + ')' , 'utf-8')
}).listen(process.env.PORT || {{port}})