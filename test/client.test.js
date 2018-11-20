const should = require('should');
const fs = require('fs');
const Client = require('../lib/client');

const getClientInstance = async function () {
    const client = new Client({
        card: 'admin@sample-test',
        fs: fs,
        multiuser: false
    });
    await client.connect();
    return client;
};

describe('composer-client', function() {

    /**
     * CONNECT
     */
    describe('connect', function() {
        it('should connects  successfully', async function () {
            const client = await getClientInstance();

            client.should.not.be.empty();

        }).timeout(10000);

    });

    /**
     * FIND ALL
     */
    describe('findAll', function() {
        it('should loads an array successfully', async function () {

            try {
                const client = await getClientInstance();

                const list = await client.findAll('org.example.basic.SampleAsset');

                list.should.not.be.empty();
            } catch (e) {
                throw new Error(e.message);
            }

        }).timeout(10000);
    });


    /**
     * FIND BY ID
     */
    describe('findById', function () {
        it('should findById successfully', async function () {
            try {
                const client = await getClientInstance();
                const result = await client.findById('org.example.basic.SampleAsset', '1');

                result.should.not.be.empty();
                result.assetId.should.be.eql('1');

            } catch (e) {
                throw new Error(e.message);
            }

        }).timeout(10000);
    });

    /**
     * CREATE
     */
    describe('create', function() {
        it('should create an record successfully', async function () {

            try {
                const client = await getClientInstance();

                const assetId = 'newAssetId' + Date.now();
                await client.create('org.example.basic.SampleAsset', {
                    assetId: assetId,
                    owner: 'resource:org.hyperledger.composer.system.NetworkAdmin#admin',
                    value: 'New asset value'
                });

                const result = await client.findById('org.example.basic.SampleAsset', assetId);

                result.should.not.be.empty();

            } catch (e) {
                throw new Error(e.message);
            }

        }).timeout(10000);
    });

    /**
     * TRANSACTION
     */
    describe('submitTransaction', function () {
        it('should invoke SampleTransaction successfully', async function () {
            try {
                const client = await getClientInstance();

                const result = await client.submitTransaction({
                    $class: 'org.example.basic.SampleTransaction',
                    asset: 'resource:org.example.basic.SampleAsset#0',
                    newValue: 'Hello world',

                }, {
                    card: 'admin@sample-test'
                });

                result.should.not.be.empty();
                result.length.should.be.eql(64);
            } catch (e) {
                throw new Error(e.message);
            }

        }).timeout(10000);
    });

    /**
     * UPDATE
     */
    describe('update', function () {
        it('should update an record successfully', async function () {

            try {
                const client = await getClientInstance();

                const result = await client.update('org.example.basic.SampleAsset', '1', {value: 'New asset value !!!'});

                console.log(result);

                // result.should.not.be.empty();
            } catch (e) {
                throw new Error(e.message);
            }

        }).timeout(10000);
    });
});


