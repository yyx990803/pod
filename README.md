# Pod - Simple Deployment Tool for Node.js

Pod simplifies the workflow of setting up, updating and managing multiple Node.js apps on a single Linux server. Each project gets a bare Git repo that can be pushed to, and auto updates the working tree and restart the process with `forever` after a push.

### Installation

``` bash
$ npm install -g pod
```

### Usage

```

  Usage: pod [command]

  Commands:

    create <appname>        Create a new app
    rm <appname>            Delete an app
    cleanlog <appname>      Clean up logs for an app
    list [-p]               List apps and status. [-p] = List processes
    config                  Print current config options
    set <key> <val>         Set a config option
    start <appname>         Start an app with forever
    stop <appname>          Stop an app
    restart <appname>       Restart an app, start if not already running
    startall                Start all apps not already running
    stopall                 Stop all apps
    restartall              Restart all running apps
    help                    You are reading it right now

```

### Workflow

Make sure your app's main file is named `app.js`.

On the server:

``` bash
$ pod create myapp # will print path to repo and working tree
```

On your local machine:

``` bash
$ git clone ssh://username@host[:port]/pod_dir/repos/myapp.git
# hack hack hack, commit
$ git push
```

Or use an existing local repo:

``` bash
$ git remote add deploy ssh://username@host[:port]/pod_dir/repos/myapp.git
$ git push deploy master
```

App should be automatically running after the push. For later pushes, app process will be restarted.  
You can edit the post-update script or add other hooks for each app in its repo's `hooks` directory.