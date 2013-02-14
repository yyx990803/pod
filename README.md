## Personal Deployment Tool

### Stack

Node.js + Varnish.
Other prerequisites: Git
Make sure your account can connect via ssh and owns home and srv directories.

### Commands

`ng create appname`

- setup a bare git repo in home folder
- edit the post-update hook to do:
    - git pull
    - npm install
    - start/restart the process with forever
- create working tree in /srv by git clone

`ng remove appname`

- deletes the app

`ng proxy 8888 example.youyuxi.com`

- run this after setting A Records in service provider's control panel
- edit `/etc/varnish/default.vcl`:
    - add new backend
    - add match rule in `sub vcl_recv`
- restart varnish

`ng repo appname`

- shows path to app's bare repo

`ng config key val`

- set config values and save in config.json