cd ~
curl -O https://hyperledger.github.io/composer/latest/prereqs-ubuntu.sh
chmod u+x prereqs-ubuntu.sh
cat ./prereqs-ubuntu.sh
sh ./prereqs-ubuntu.sh

mkdir ~/fabric-dev-servers
cd ~/fabric-dev-servers
curl -O https://raw.githubusercontent.com/hyperledger/composer-tools/master/packages/fabric-dev-servers/fabric-dev-servers.tar.gz
tar -xvf fabric-dev-servers.tar.gz
export FABRIC_VERSION=hlfv12
./downloadFabric.sh

npm i -g node-gyp --unsafe-perm
npm i -g grpc
npm install -g composer-cli@0.20
npm install -g composer-rest-server@0.20
npm install -g generator-hyperledger-composer@0.20
npm install -g composer-playground@0.20
