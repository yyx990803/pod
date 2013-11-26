var ERRORS = module.exports = {
    EXISTS      : 'an app with the name ' + '{{appname}}'.yellow + ' already exists.',
    NOT_FOUND   : 'app ' + '{{appname}}'.yellow + ' does not exist.',
    NO_SCRIPT   : 'cannot locate main script for ' + '{{appname}}'.yellow + ' ({{script}})'.grey,
    NOT_RUNNING : '{{appname}}'.yellow + ' is not running.',
    WEB         : 'You cannot remove the web interface!'
}

for (var errKey in ERRORS) {
    ERRORS[errKey] = {
        msg: ERRORS[errKey],
        code: errKey
    }
}