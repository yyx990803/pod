var r = require('request')
r({
    url: 'http://localhost:19999/hooks/test3',
    method: 'POST',
    headers: {
        'User-Agent': 'GitHub Hookshot'
    },
    form: {
        payload: JSON.stringify({
            ref: 'refs/heads/test',
            head_commit: {
                message: '123'
            },
            repository: {
                url: '/Users/yyou/Personal/pod/local/repos/test.git'
            }
        })
    }
})