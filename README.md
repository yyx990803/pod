# OK

### Simple Server Side Deployment Tool for Node.js

OK simplifies the workflow of setting up, updating and managing multiple Node.js apps on a single Linux server. Each project gets a bare Git repo that can be pushed to, and auto updates the working copy and restart the process with `forever` after a push. This is not on npm because it's probably a too personal use case and very premature. If you want to use it, simply clone it then `(sudo) npm link`.

## Prerequisites

- Git
- Node.js
- [Forever](https://github.com/nodejitsu/forever) - currently it needs to be installed globally. Planning to switch to using only the monitor module instead of CLI.
- A user account with SSH access and proper privileges

## Commands

```
ok
```

Prints the directory OK uses to keep stuff. If no config file is found it will create `~/.okconfig`, and ask you to enter a directory. You account should be able to read/write/execute in the directory. OK will create 3 directories in it:

- `repos`: the directory to hold your bare git repos (the remotes you push to)
- `apps`: the directory to hold your working copies
- `logs`: the directory to hold logs.

---

```
ok create appname
```

- sets up a bare git repo `appname.git` in `repos`, then adds a post-update hook that does: (cutomizable in `hooks/post-update`)

    - git pull
    - npm install
    - start/restart the process with forever

- creates an empty working copy in `apps` using `git clone`.
- creates a folder in `logs` that logs the process' stdout and errors from `forever`.

---

```
ok rm appname
```

Deletes the app. Will prompt before deleting.

---

```
ok list
```

Lists existing apps and attempts to sniff the port they're listening to, and whether they're currently running.

---

```
ok set dir path
```

Sets the config path.

---

```
ok start appname
ok stop appname
ok restart appname
ok startall
ok stopall
ok restartall
```

These simply proxies the commands to `forever`.

---

## Workflow

Make sure your app's main file is named `app.js`.

### On the server

1. `ok create myapp`

### In your local repo

1. `git clone ssh://username@host[:port]/ok_dir/repos/myapp.git`
2. hack hack hack, commit
3. `git push`

Or for existing repo:

1. `git remote add deploy ssh://username@host[:port]/ok_dir/repos/myapp.git`
2. `git push deploy master`

App should be automatically running after push. For later pushes app process will be restarted.