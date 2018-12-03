# Composer client utility

Library bases on [loopback-composer-connector](https://github.com/hyperledger/composer/tree/master/packages/loopback-connector-composer)

Contains methods which allows to communicate with Hyperledger Composer client.

##### Note

Actually this library is under development, but you can use some features right now. 

Read how to setup and use [Hyperledger Composer](https://hyperledger.github.io/composer/latest/installing/installing-index)

## Installation

```
npm install composer-client-util //Sorry, not published yet
```

## Usage  
  
This library doesn`t manage any cards, but just applies it as parameter and tries to find it on local filesystem.
Read more about that  (here)[https://hyperledger.github.io/composer/latest/business-network/cloud-wallets]

There four major types of registries in Hyperledger :

* Assets
* Participants
* Transactions
* Events

You don't have to specify which registry use for any operations, this library automaticly do that for you, 
just insert full path of class defined in bussiness network. `Example: 'org.example.basic.SampleAsset'`

### Connect

##### Note. Here `asset` means  `asset` or `participant`.

```
const ComposerClientUtil = require('composer-client-util');
const fs = require('fs');

const client = new ComposerClientUtil({
        card: 'admin@sample-test', // default card, which is using for connection and(or) other requests  
        fs: fs,
        multiuser: false
    });
    await client.connect();

```

### Get list of assets from registry

```

const filter = { 
    where : {   
        name: ".."
    }
}

const options = { 
    card: 'admin@sample-test' 
}

 const list = await client.findAll('org.example.basic.SampleAsset', filter, options);
 // Here first parameter always should be string full name of class
```

### Get one by id

```
 const result = await client.findById('org.example.basic.SampleAsset', '1');
```

### Add asset to registry

```
 await client.create('org.example.basic.SampleAsset', {
                     assetId: assetId, // any unique value
                     owner: 'resource:org.hyperledger.composer.system.NetworkAdmin#admin',
                     value: 'New asset value'
 });
```

### Update asset by id

```
await client.update('org.example.basic.SampleAsset', '1', {value: 'New asset value !!!'});
```

### Transaction

```

const txInput = {
    $class: 'org.example.basic.SampleTransaction',
    asset: 'resource:org.example.basic.SampleAsset#0',
    newValue: 'Hello world'
};
                
 const result = await client.submitTransaction(txInput, options);
```

### Queries

```
Not tested yet ....
```

## Contributing

You may fork this lib or create pull requests.
