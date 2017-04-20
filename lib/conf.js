const os = require('os');
module.exports = {
    path: process.env.POD_CONF || ((process.env.HOME || os.homedir()) + '/.podrc'),
    webId: 'pod-web-service'
}