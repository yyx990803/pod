# POD - super simple Node.js deployment tool

Pod simplifies the workflow of setting up, updating and managing multiple Node.js apps on a single Linux server. It is built upon git hooks and [forever](https://github.com/nodejitsu/forever).

### Prerequisites

All you need is Node, git, and a ssh account.

### Installation

``` bash
$ [sudo] npm install -g pod
```

To make pod auto start all managed apps on system startup, you might also want write a simple [upstart](http://upstart.ubuntu.com) script that contains something like this:

``` bash
# /etc/init/pod.conf
start on startup
exec sudo -u <username> /path/to/node /path/to/pod startall
```

### Usage

```

  Usage: pod [command]

  Commands:

    create <appname>        Create a new app
    rm <appname>            Delete an app
    cleanlogs <appname>     Clean up logs for an app
    edit <appname>          Edit the app's post-receive hook
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

### Config

```

    dir                     Directory to hold the repos, apps and logs
    appfile                 The main file to look for in each app. Default is 'app.js'
    editor                  The editor to use when editing hook scripts
    
```

### Workflow

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

### Things to Know

The default script that `pod` looks for in each app is `app.js`. You can change this with `pod set appfile <filename>`.  

App should be automatically running after the push. For later pushes, app process will be restarted.  

You can edit the post-receive script of an app using `pod edit <appname>` to customize the actions after a git push, e.g. add `NODE_ENV=production` before `pod restart {{app}}`.