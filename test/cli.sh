#!/usr/bin/env bash

# Test Steup ==================================================================

node="`type -P node`"
nodeVersion="`$node -v`"
pod="`type -P node` `pwd`/bin/pod"
pm2="`type -P node` `pwd`/node_modules/pm2/bin/pm2"
conf="`pwd`/temp/conf/.podrc"
err="`pwd`/temp/error"

function fail {
  echo -e "\033[31m      ✘  $1\033[0m"
  echo -e "         \033[30;1m$(<$err)"
  echo
  exit 1
}

function success {
  echo -e "\033[32m      ✔  \033[30;1m$1\033[0m"
}

function spec {
  [ $? -eq 0 ] || fail "$1"
  success "$1"
}

function ispec {
  [ $? -eq 1 ] || fail "$1"
  success "$1"
}

$node -e "var os = require('os'); console.log('> arch : %s\n> platform : %s\n> release : %s\n> type : %s\n> mem : %d', os.arch(), os.platform(), os.release(), os.type(), os.totalmem())"

echo
echo "  CLI"

# Reset Env ===================================================================

# kill daemon, clean temp
$pm2 kill > /dev/null
rm -rf `pwd`/temp
mkdir `pwd`/temp

# First time use ==============================================================

echo "    First time use"

POD_CONF=$conf POD_ROOT_DIR=temp/files TEST=true $pod >/dev/null 2>$err
spec "should initialize with no error"

msg="should create config file with correct root path"
OUT=`cat \`pwd\`/temp/conf/.podrc 2>\`pwd\`/temp/error | grep \`pwd\`/temp/files | wc -l`
[ $OUT -eq 1 ] || fail "$msg"
success "$msg"

ls `pwd`/temp/files >/dev/null 2>$err
spec "should create root dir"

ls `pwd`/temp/files/apps >/dev/null 2>$err
spec "should create apps dir"

ls `pwd`/temp/files/repos >/dev/null 2>$err
spec "should create repos dir"

# Commands ====================================================================

echo "    Commands"

msg="create"
OUT=`POD_CONF=$conf $pod create test 2>$err | wc -l`
[ $OUT -eq 4 ] || fail "$msg" 
success "$msg"

msg="start"
# app script
cp `pwd`/test/fixtures/cliapp.js `pwd`/temp/files/apps/test/app.js
# add conf
sed s/'"test": {}'/'"test": { "port": 19787 }'/ `pwd`/temp/conf/.podrc > `pwd`/temp/conf/replace
cat `pwd`/temp/conf/replace > `pwd`/temp/conf/.podrc
OUT=`POD_CONF=$conf $pod start test 2>$err | grep 19787 | wc -l`
[ $OUT -eq 1 ] || fail "$msg"
success "$msg"

msg="restart"
OUT=`POD_CONF=$conf $pod restart test 2>$err | grep "test.*restarted" | wc -l`
[ $OUT -eq 1 ] || fail "$msg"
success "$msg"

msg="stop"
OUT=`POD_CONF=$conf $pod stop test 2>$err | grep "test.*stopped" | wc -l`
[ $OUT -eq 1 ] || fail "$msg"
success "$msg"

msg="startall"
# make another app.
POD_CONF=$conf $pod create test2 >/dev/null 2>$err
cp `pwd`/test/fixtures/cliapp.js `pwd`/temp/files/apps/test2/app.js
sed s/'"test2": {}'/'"test2": { "port": 19788 }'/ `pwd`/temp/conf/.podrc > `pwd`/temp/conf/replace
cat `pwd`/temp/conf/replace > `pwd`/temp/conf/.podrc
OUT=`POD_CONF=$conf $pod startall 2>$err | grep "test.*running" | wc -l`
[ $OUT -eq 2 ] || fail "$msg : expect 2 running, got $OUT"
success "$msg"

msg="restartall"
OUT=`POD_CONF=$conf $pod restartall 2>$err | grep "test.*restarted" | wc -l`
[ $OUT -eq 2 ] || fail "$msg : expect 2 restarts, got $OUT"
success "$msg"

msg="stopall"
OUT=`POD_CONF=$conf $pod stopall 2>$err | grep "test.*stopped" | wc -l`
[ $OUT -eq 2 ] || fail "$msg : expect 2 stopped, got $OUT"
success "$msg"

msg="list"
POD_CONF=$conf $pod start test >/dev/null 2>$err
OUT=`POD_CONF=$conf $pod list 2>$err | wc -l`
[ $OUT -eq 6 ] || fail "$msg : expect 6 lines, got $OUT"
OUT=`POD_CONF=$conf $pod list 2>$err | grep ON | wc -l`
[ $OUT -eq 1 ] || fail "$msg : expect 1 ON, got $OUT"
OUT=`POD_CONF=$conf $pod list 2>$err | grep OFF | wc -l`
[ $OUT -eq 1 ] || fail "$msg : expect 1 OFF, got $OUT"
success "$msg"

msg="rm"
POD_CONF=$conf $pod rm -f test >/dev/null 2>$err
OUT=`ls -l \`pwd\`/temp/files/apps | grep test | wc -l`
[ $OUT -eq 1 ] || fail "$msg : expect 1 app left, got $OUT"
OUT=`ls -l \`pwd\`/temp/files/repos | grep test | wc -l`
[ $OUT -eq 1 ] || fail "$msg : expect 1 repo left, got $OUT"
OUT=`POD_CONF=$conf $pod list 2>$err | wc -l`
[ $OUT -eq 5 ] || fail "$msg : expect 5 lines from list, got $OUT"
success "$msg"

msg="prune"
touch `pwd`/temp/files/prunefile
mkdir `pwd`/temp/files/prunedir
touch `pwd`/temp/files/apps/prunefile
mkdir `pwd`/temp/files/apps/prunedir
touch `pwd`/temp/files/repos/prunefile
mkdir `pwd`/temp/files/repos/prunedir
POD_CONF=$conf $pod prune >/dev/null 2>$err
OUT=`find \`pwd\`/temp/files -name prunefile | wc -l`
[ $OUT -eq 0 ] || fail "$msg : prunefiles should be removed"
OUT=`find \`pwd\`/temp/files -name prunedir | wc -l`
[ $OUT -eq 0 ] || fail "$msg : prunedirs should be removed"
success "$msg"

rm -rf `pwd`/temp
unset POD_CONF
unset POD_ROOT_DIR
pm2 kill
echo