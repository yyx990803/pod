# POD - git push deploy for Node.js [![Build Status](https://travis-ci.org/yyx990803/pod.png?branch=master)](https://travis-ci.org/yyx990803/pod)

![screenshot](http://i.imgur.com/dMcKWiJ.png)

Core API JSCoverage: **95.72%**

Pod simplifies the workflow of setting up, updating and managing multiple Node.js apps on a Linux server. Perfect for hosting personal Node stuff on a VPS. There are essentially two parts: 1. `git push` deploy (by using git hooks) and 2. process management (by using [pm2](https://github.com/Unitech/pm2))

It doesn't manage DNS routing for you (personally I'm doing that in Nginx) but you can use pod to run a [node-http-proxy](https://github.com/nodejitsu/node-http-proxy) server on port 80 that routes incoming requests to other apps.

## Prerequisites

- Node >= 0.8.x
- git
- properly set up ssh so you can push to a repo on the VPS via ssh

## Example Workflow

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

**Or, if you have an existing local repo:**

``` bash
$ git remote add deploy ssh://your-server/pod_dir/myapp.git
$ git push deploy master
```

That's it! App should be automatically running after the push. For later pushes, app process will be restarted.

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
    rm <app>                Delete an app
    start <app>             Start an app monitored by pm2
    stop <app>              Stop an app
    restart <app>           Restart an app that's already running
    list                    List apps and status
    startall                Start all apps not already running
    stopall                 Stop all apps
    restartall              Restart all running apps
    edit <app>              Edit the app's post-receive hook
    config                  Edit config file
    help                    You are reading it right now

```

## Config

Example Config:

``` js
{
    "root": "/srv",
    "nodeEnv": "development",
    "defaultScript": "app.js", // this can be overwritten in each app's package.json's "main" field
    "editor": "vi",
    "apps": {
        "example1": {

            // passed to the app as process.env.NODE_ENV
            // if not set, will inherit from global settings
            "nodeEnv": "production",

            // passed to the app as process.env.PORT
            // if not set, pod will try to sniff from app's
            // main file (for displaying only), but not
            // guarunteed to be correct.
            "port": 8080,

            // *** any valid pm2 config here gets passed to pm2. ***

            // spin up 2 instances using cluster module
            "instances": 2

            // pass in additional command line args to the app
            "args": "['--toto=heya coco', '-d', '1']",

            // file paths for stdout, stderr logs and pid.
            // will be in ~/.pm2/ if not specified
            "fileOutput": "/absolute/path/to/stdout.log",
            "fileError": "/absolute/path/to/stderr.log",
            "pidFile": "/absolute/path/to/example1.pid"
        },
        "example2": {

            // minimum uptime to be considered stable,
            // in milliseconds. If not set, all restarts
            // are considered unstable.
            "minUptime": 3600000,

            // max times of unstable restarts allowed
            // before the app is auto stopped.
            "maxRestarts": 10
        }
    }
}
```

## Logging & Monitoring

Since pod uses pm2 under the hood, logging is delegated to `pm2`. It's recommended to link `path/to/pod/node_modules/pm2/bin/pm2` to your `/usr/local/bin` so that you can use `pm2 monit` and `pm2 logs` to analyze more detailed app info. Note that all pod commands only concerns apps present in pod's config file, so it's fine if you use pm2 separately to run additional processes.

## Custom post-receive hook

You can edit the post-receive script of an app using `pod edit <appname>` to customize the actions after a git push.

Or, if you prefer to include the hook with the repo, just place a `.podhook` file in your app, which can contain shell scripts that will be executed after push, and before restarting the app. If `.podhook` exits with code other than 0, the app will not be restarted and will hard reset to the commit before the push.

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

## Using the API

NOTE: the API can only be used after POD has been initiated via the command line.

`require('pod')` will return the API. For now you'll have to refer to the source before further documentation becomes available.

## License

[MIT](http://opensource.org/licenses/MIT)