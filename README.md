# POD - git push deploy for Node.js

![screenshot](http://i.imgur.com/pda21KY.png)

[![NPM version](https://badge.fury.io/js/pod.svg)](http://badge.fury.io/js/pod) [![Build Status](https://img.shields.io/travis/yyx990803/pod/master.svg)](https://travis-ci.org/yyx990803/pod)

Core API JSCoverage: **95.52%**

Pod simplifies the workflow of setting up, updating and managing multiple Node.js apps on a Linux server. Perfect for hosting personal Node stuff on a VPS. There are essentially two parts: 1. `git push` deploy (by using git hooks) and 2. process management (by using [pm2](https://github.com/Unitech/pm2))

It doesn't manage DNS routing for you (personally I'm doing that in Nginx) but you can use pod to run a [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) server on port 80 that routes incoming requests to other apps.

## A Quick Taste

**On the server:**

``` bash
$ pod create myapp
```

**On your local machine:**

``` bash
$ git clone ssh://your-server/pod_dir/myapp.git
# hack hack hack, commit
# make sure your main file is app.js
# or specify "main" in package.json
$ git push
```

You can also just add it as a remote to an existing local repo:

``` bash
$ git remote add deploy ssh://your-server/pod_dir/myapp.git
$ git push deploy master
```

That's it! App should be automatically running after the push. For later pushes, app process will be restarted. There's more to it though, read on to find out more.

- [First Time Walkthrough](https://github.com/yyx990803/pod/wiki/Setup-Walkthrough)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Web Interface](#web-interface)
- [Using a Remote GitHub Repo](#using-a-remote-github-repo)
- [Configuration](#configuration)
- [Using PM2 Directly](#using-pm2-directly)
- [Custom Post-Receive Hook](#custom-post-receive-hook)
- [Using the API](#using-the-api)
- [Docker images](#Docker-images)
- [Changelog](#changelog)

## Prerequisites

- Node >= 0.10.x
- git
- properly set up ssh so you can push to a repo on the VPS via ssh

## Installation

``` bash
$ [sudo] npm install -g pod
```

To make pod auto start all managed apps on system startup, you might also want to write a simple [upstart](http://upstart.ubuntu.com) script that contains something like this:

``` bash
# /etc/init/pod.conf
start on (local-filesystems and net-device-up IFACE!=lo)
exec sudo -u <username> /path/to/node /path/to/pod startall
```

The first time you run `pod` it will ask you where you want to put your stuff. The structure of the given directory will look like this:

``` bash
.
├── repos # holds the bare .git repos
│   └── example.git
└── apps # holds the working copies
    └── example
        ├──app.js
        └──.podhook
```

## CLI Usage

```

  Usage: pod [command]

  Commands:

    create <app>            Create a new app
    remote <app> <repo>     Create a app from a remote GitHub repo
    rm <app>                Delete an app
    start <app>             Start an app monitored by pm2
    stop <app>              Stop an app
    restart <app>           Restart an app that's already running
    list                    List apps and status
    startall                Start all apps not already running
    stopall                 Stop all apps
    restartall              Restart all running apps
    prune                   Clean up dead files
    hooks                   Update hooks after a pod upgrade
    web [command]           Start/stop/restart the web interface
    help                    You are reading it right now

```

## Web Service

``` bash
$ pod web [stop|restart|status]
```

This command will start the pod web service, by default at port 19999, which provides several functionalities:

- `/` : a web interface that displays current apps status.
- `/json` : returns app status data in json format.
- `/jsonp` : accepts jsonp. This route must be enabled in config.
- `/hooks/appname` : trigger fetch/restart for corresponding remote apps.

Both `/` and `/json` require a basic http authentication. Make sure to set the username and password in the config file.

## Using a remote GitHub repo

[Walkthrough](https://github.com/yyx990803/pod/wiki/Using-a-remote-repo)

You can setup an app to track a remote GitHub repo by using the `pod remote` command:

``` bash
$ pod remote my-remote-app username/repo
```

After this, add a webhook to your GitHub repo pointing at your web interface's `/hooks/my-remote-app`. The webhook will trigger a fetch and restart just like local apps. By default a remote app will be tracking the master branch only, if you want to track a different branch, you can change it in the config file.

You can also set up a remote app to track an arbitrary git address. However in that case you need to manually make a POST request conforming to the [GitHub webhook payload](https://help.github.com/articles/post-receive-hooks).

Starting in 0.8.2, GitLab webhooks are also supported.

Starting in 0.8.6, Bitbucket webhooks are also supported.

## Configuration

The config file lives at `~/.podrc`. Note since 0.7.0 all fields follow the underscore format so check your config file if things break after upgrading.

Example Config:

``` js
{
    // where pod puts all the stuff
    "root": "/srv",

    // default env
    "node_env": "development",

    // this can be overwritten in each app's package.json's "main" field
    // or in the app's configuration below using the "script" field
    "default_script": "app.js",

    // minimum uptime to be considered stable,
    // in milliseconds. If not set, all restarts
    // are considered unstable.
    "min_uptime": 3600000,

    // max times of unstable restarts allowed
    // before the app is auto stopped.
    "max_restarts": 10

    // config for the web interface
    "web": {
        // set these! default is admin/admin
        "username": "admin",
        "password": "admin",
        "port": 19999,
        // allow jsonp for web interface, defaults to false
        "jsonp": true
    },

    "apps": {
        "example1": {

            // passed to the app as process.env.NODE_ENV
            // if not set, will inherit from global settings
            "node_env": "production",

            // passed to the app as process.env.PORT
            // if not set, pod will try to parse from app's
            // main file (for displaying only), but not
            // guarunteed to be correct.
            "port": 8080,

            // pod will look for this script before checking
            // in package.json of the app.
            "script": "dist/server.js",

            // *** any valid pm2 config here gets passed to pm2. ***

            // spin up 2 instances using cluster module
            "instances": 2,

            // pass in additional command line args to the app
            "args": "['--toto=heya coco', '-d', '1']",

            // file paths for stdout, stderr logs and pid.
            // will be in ~/.pm2/ if not specified
            "error_file": "/absolute/path/to/stderr.log",
            "out_file": "/absolute/path/to/stdout.log"
        },
        "example2": {
            // you can override global settings
            "min_uptime": 1000,
            "max_restarts": 200
        },
        "my-remote-app": {
            "remote": "yyx990803/my-remote-app", // github shorthand
            "branch": "test" // if not specified, defaults to master
        }
    },
    
    // pass environment variables to all apps
    "env": {
        "SERVER_NAME": "Commodore",
        "CERT_DIR": "/path/to/certs"
    }  
}
```

## Using PM2 Directly

Pod relies on pm2 for process management under the hood. When installing pod, the `pm2` executable will also be linked globally. You can invoke `pm2` commands for more detailed process information.

Logging is delegated to `pm2`. If you didn't set an app's `out_file` and `error_file` options, logs will default to be saved at `~/.pm2/logs`.

If things go wrong and restarting is not fixing them, try `pm2 kill`. It terminates all pm2-managed processes and resets potential env variable problems.

All pod commands only concerns apps present in pod's config file, so it's fine if you use pm2 separately to run additional processes.

## Custom Post-receive Hook

By default pod will run `npm install` for you everytime you push to the repo. To override this behavior and run custom shell script before restarting the app, just include a `.podhook` file in your app. If `.podhook` exits with code other than 0, the app will not be restarted and will hard reset to the commit before the push.

Example `.podhook`:

``` bash
component install
npm install
grunt build
grunt test
passed=$?
if [[ $passed != 0 ]]; then
    # test failed, exit. app's working tree on the server will be reset.
    exit $passed
fi
# restart is automatic so no need to include that here
```

You can also directly edit the post-receive script of an app found in `pod-root-dir/repos/my-app.git/hooks/post-receive` if you wish.

## Using the API

NOTE: the API can only be used after you've initiated the config file via command line.

`require('pod')` will return the API. You have to wait till it's ready to do anything with it:

``` js
var pod = require('pod')
pod.once('ready', function () {
    // ... do stuff
})
```

The API methods follow a conventional error-first callback style. Refer to the source for more details.

## Docker images

Ready to go docker images:

* [alpine linux](https://github.com/coderofsalvation/docker.alpine.nodejs.pod) 
* [ubuntu linux](https://github.com/raiscui/docker-pod)

## Changelog

### 0.8.6

- Added support for Bitbucket webhooks.
- Added ability to specify entry point in app's config in `.podrc` by using the `script` field.
- Fixed issue with the `readline` module blocking stdin. This caused issues when attempting to clone a repository that required a username/password.

### 0.8.0

- Upgrade pm2 to 0.12.9, which should make pod now work properly with Node 0.11/0.12 and latest stable iojs.
- Fix web services to accommodate github webhook format change (#29)
- Now links the pm2 executable automatically when installed

### 0.7.4

- Fix web service `strip()` function so it processes github ssh urls correctly. (Thanks to @mathisonian)
- Behavior regarding `main` field in `package.json` is now more npm compliant. (e.g. it now allows omitting file extensions)

### 0.7.3

- Add a bit more information for first time use
- Renamed the web service process name to `pod-web-service` from `pod-web-interface`.
- Fixed web service not refreshing config on each request

### 0.7.2

- Add styling for the web interface.

### 0.7.1

- Now pod automatically converts outdated config files to 0.7.0 compatible format.

### 0.7.0

- Config file now conforms to underscore-style naming: `nodeEnv` is now `node_env`, and `defaultScript` is now `default_script`. Consult the [configuration](#configuration) section for more details.
- Added `pod web` and `pod remote` commands. See [web interface](#web-interface) and [using a remote github repo](#using-a-remote-github-repo) for more details.
- Removed `pod config` and `pod edit`.
- Drop support for Node v0.8.

### 0.6.0

- The post receive hook now uses `git fetch --all` + `git reset --hard origin/master` instead of a pull. This allows users to do forced pushes that isn't necesarrily ahead of the working copy.
- Added `pod prune` and `pod hooks` commands. Make sure to run `pod hooks` after upgrading pod, as you will want to update the hooks that are already created in your existing apps.
- Upgraded to pm2 0.6.7

## License

[MIT](http://opensource.org/licenses/MIT)
