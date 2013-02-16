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

- sets up a bare git repo `appname.git` in `repos`, then adds a post-update hook that does:

    - git pull
    - npm install
    - start/restart the process with forever

- creates an empty working copy in `apps` using `git clone`.
- creates a folder in `logs` that logs the process' stdout and errors from Forever.

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

These simply proxies the command to Forever.

---

## Workflow

### On the server

1. `ok create myapp`

### In your local repo

1. Make sure your main file is named `app.js`
2. `git remote add deploy ssh://username@host[:port]/repos/myapp.git`
3. `git push deploy master`
4. App should be running after push. For later pushes app process will be restarted.