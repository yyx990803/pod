# OK

A simple personal tool that simplifies the workflow of setting up and updating a new Node.js app on a Linux server with Git.
Each project gets a bare Git repo that can be pushed to, and auto updates the working copy and restart the process with `forever` after a push.
This is not on npm because it's probably a too personal use case and very naive solution. If you want to use it, simply clone it then `(sudo) npm link`.

**Note** - It's supposed to be used on the server.

## Prerequisites

- Git
- Node.js
- [Forever](https://github.com/nodejitsu/forever) - you can edit `hooks/post-update` to remove this dependency.
- A user account with SSH access and proper privileges

## Commands

    ok

Prints config for current paths:

- `git_dir`: the directory to hold your bare git repos (the remotes you push to)
- `srv_dir`: the directory to hold your working copies

You account should be able to read/write/execute in `git_dir` and read/write in `srv_dir`. The config file is `~/.okconfig`. If no config file is found it will create a new one with both paths pointing to your home folder.

    ok create appname

Sets up a bare git repo `appname.git` in `git_dir`, then adds a post-update hook that does:

- git pull
- npm install
- start/restart the process with forever

Finally creates an empty working copy in `srv_dir` using `git clone`.

    ok rm appname

Deletes the app. Will prompt before deleting.

    ok list

Lists existing apps and attempts to sniff the port they're listening to, and whether they're running.
Note that it does this by first checking if a repo and a working copy with the same name exists in `git_dir` and `srv_dir`.

    ok set key val

Sets the config path, e.g. `ok set srv_dir /srv`.

## Workflow

### On the server

1. `ok create myapp`

### In your local repo

1. Make sure your main file is named `app.js`
2. `git remote add deploy ssh://username@host[:port]/git_dir/myapp.git`
3. `git push deploy master`
4. App should be running after push. For later pushes app process will be restarted.