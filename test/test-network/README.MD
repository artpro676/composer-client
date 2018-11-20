### Requires Node.JS 8.11.4

### Installing pre-requisites

```
curl -O https://hyperledger.github.io/composer/prereqs-ubuntu.sh

chmod u+x prereqs-ubuntu.sh

./prereqs-ubuntu.sh

```

### Installing components

```
npm install -g composer-cli@0.20
```

```
npm install -g composer-rest-server@0.20
```

```
npm install -g generator-hyperledger-composer@0.20
```

```
npm install -g composer-playground@0.20
```

### Install Hyperledger Fabric

```
mkdir ~/fabric-dev-servers && cd ~/fabric-dev-servers

curl -O https://raw.githubusercontent.com/hyperledger/composer-tools/master/packages/fabric-dev-servers/fabric-dev-servers.tar.gz
tar -xvf fabric-dev-servers.tar.gz
```

```
cd ~/fabric-dev-servers
export FABRIC_VERSION=hlfv12
./startFabric.sh
./createPeerAdminCard.sh
```

### Start network

```
./startNetwork.sh
```