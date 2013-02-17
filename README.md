# OK

## Simple Deployment Tool for Node.js

OK simplifies the workflow of setting up, updating and managing multiple Node.js apps on a single Linux server. Each project gets a bare Git repo that can be pushed to, and auto updates the working copy and restart the process with `forever` after a push.

### Installation

This is not on npm because it's probably a too personal use case and very premature.  
If you want to try it out, simply clone it then `(sudo) npm link`.

### Usage

```

  Usage: ok [command]

  Commands:

    create <appname>        Create a new app
    rm <appname>            Delete an app
    cleanlog <appname>      Clean up logs for an app
    list                    List all apps with port and running status
    procs                   Prints detailed info for running processes
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

#### On the server

1. `ok create myapp`

#### On your local machine

1. `git clone ssh://username@host[:port]/ok_dir/repos/myapp.git`
2. hack hack hack, commit
3. `git push`

#### Or use an existing repo:

1. `git remote add deploy ssh://username@host[:port]/ok_dir/repos/myapp.git`
2. `git push deploy master`

App should be automatically running after push. For later pushes app process will be restarted.