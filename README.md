# POD - git push deploy for Node.js

![screenshot](http://i.imgur.com/pda21KY.png)

[![Build Status](https://travis-ci.org/yyx990803/pod.png?branch=master)](https://travis-ci.org/yyx990803/pod)

Core API JSCoverage: **98.79%**

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
$ git push
```

You can also just add it as a remote to an existing local repo:

``` bash
$ git remote add deploy ssh://your-server/pod_dir/myapp.git
$ git push deploy master
```

That's it! App should be automatically running after the push. For later pushes, app process will be restarted. There's more to it though, read on to find out more.

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Web Interface](#web-interface)
- [Using a Remote GitHub Repo](#using-a-remote-github-repo)
- [Configuration](#configuration)
- [Using PM2 Directly](#using-pm2-directly)
- [Custom Post-Receive Hook](#custom-post-receive-hook)
- [Using the API](#using-the-api)
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
start on startup
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

## Web Interface

``` bash
$ pod web [stop|restart|status]
```

This command will start the pod web interface, by default at port 19999, which provides several functionalities:

- `/` : a web page display current apps status.
- `/json` : returns app status data in json format.
- `/jsonp` : accepts jsonp, must be enabled in config.
- `/hooks/appname` : trigger fetch/restart for corresponding remote apps.

## Using a remote GitHub repo

You can setup an app to track a remote GitHub repo by using the `pod remote` command:

``` bash
$ pod remote my-remote-app username/repo
```

After this, add a webhook to your GitHub repo pointing at your web interface's `/hooks/my-remote-app`. The webhook will trigger a fetch and restart just like local apps. By default a remote app will be tracking the master branch only, if you want to track a different branch, you can change it in the config file.

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

            // *** any valid pm2 config here gets passed to pm2. ***

            // spin up 2 instances using cluster module
            "instances": 2,

            // pass in additional command line args to the app
            "args": "['--toto=heya coco', '-d', '1']",

            // file paths for stdout, stderr logs and pid.
            // will be in ~/.pm2/ if not specified
            "error_file": "/absolute/path/to/stdout.log",
            "out_file": "/absolute/path/to/stderr.log"
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
    }
}
```

## Using PM2 Directly

Since pod uses pm2 under the hood, logging is delegated to `pm2`. If you didn't set an app's `out_file` and `error_file` options, logs will default to be saved at `~/.pm2/logs`.

It's recommended to link `path/to/pod/node_modules/pm2/bin/pm2` to your `/usr/local/bin` so that you can use `pm2 monit` and `pm2 logs` for real-time monitoring.

If things go wrong and restarting is not fixing them, try `pm2 kill`. It terminates all pm2-managed processes and resets potential env variable problems.

All pod commands only concerns apps present in pod's config file, so it's fine if you use pm2 separately to run additional processes.

## Custom Post-receive Hook

To run additional shell script after a push and before the app is restarted, just include a `.podhook` file in your app. If `.podhook` exits with code other than 0, the app will not be restarted and will hard reset to the commit before the push.

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
```

You can also directly edit the post-receive script of an app found in `pod-root-dir/repos/my-app.git/hooks/post-receive` if you wish.

## Using the API

NOTE: the API can only be used after you've initiated the config file via command line.

`require('pod')` will return the API. You have to wait till it's ready to do anything with it:

``` js
var pod = require('pod')
pod.on('ready', function () {
    // ... do stuff
})
```

The API methods follow a conventional error-first callback style. Refer to the source for more details.

## Changelog

### 0.7.0

- **BREAKING CHANGE** Config file now conforms to underscore-style naming: `nodeEnv` is now `node_env`, and `defaultScript` is now `default_script`. Consult the [configuration](#configuration) section for more details.
- Added `pod web` and `pod remote` commands. See [web interface](#web-interface) and [using a remote github repo](#using-a-remote-github-repo) for more details.
- Removed `pod config` and `pod edit`.
- Drop support for Node v0.8.

### 0.6.0

- The post receive hook now uses `git fetch --all` + `git reset --hard origin/master` instead of a pull. This allows users to do forced pushes that isn't necesarrily ahead of the working copy.
- Added `pod prune` and `pod hooks` commands. Make sure to run `pod hooks` after upgrading pod, as you will want to update the hooks that are already created in your existing apps.
- Upgraded to pm2 0.6.7

## License

[MIT](http://opensource.org/licenses/MIT)