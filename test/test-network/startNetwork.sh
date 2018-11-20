set -ev
VERSION=$(node -e 'console.log(require("./package.json").version)' | cut -d '-' -f 1)
TIME=$(date +"%s")
BUILD_VERSION="$VERSION-build.$TIME"

npm version ${BUILD_VERSION} --no-git-tag-version

#if docker ps -q
#then
#    docker kill $(docker ps -q)
#    docker rm $(docker ps -aq)
#    docker rmi $(docker images dev-* -q)
#fi

export FABRIC_VERSION=hlfv12
~/fabric-dev-servers/startFabric.sh
~/fabric-dev-servers/createPeerAdminCard.sh

if composer card list --card admin@sample-test
then
    composer card delete --card admin@sample-test
fi

composer archive create -t dir -n . -a sample-test@0.0.1.bna
composer network install -a sample-test@0.0.1.bna -c PeerAdmin@hlfv1
composer network start --networkName sample-test --networkVersion ${BUILD_VERSION} -A admin -S adminpw --card PeerAdmin@hlfv1 --file admin.card
composer card import --file admin.card
composer identity list -c admin@sample-test
composer transaction submit -c admin@sample-test -d '{"$class":"org.example.basic.CreateMockAssets"}'

composer-playground
