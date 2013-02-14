## Personal Deployment Tool

### Stack

Node.js + Varnish.
Other prerequisites: Git, an account with properly set up ssh key and sudo privilege.

### Commands

`do create appname`

- setup a bare git repo in home folder
- edit the post-update hook to do:
    - git pull
    - npm install
    - start/restart the process with forever
- create working tree in /srv by git clone

`do proxy 8888 example.youyuxi.com`

- run this after setting A Records in service provider's control panel
- edit `/etc/varnish/default.vcl`:
    - add new backend
    - add match rule in `sub vcl_recv`
- restart varnish

`do repo appname`

- shows path to app's bare repo

`do config key val`

- set config values and save in config.json