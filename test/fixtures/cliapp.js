require('http').createServer(function (req, res) {
    res.end('ok! process started on: (' + Date.now() + ')' , 'utf-8')
}).listen(process.env.PORT)