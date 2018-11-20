/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const IdCard = require('composer-common').IdCard;
const LoopbackVisitor = require('composer-common').LoopbackVisitor;
const AssetDeclaration = require('composer-common').AssetDeclaration;
const ConceptDeclaration = require('composer-common').ConceptDeclaration;
const ParticipantDeclaration = require('composer-common').ParticipantDeclaration;
const TransactionDeclaration = require('composer-common').TransactionDeclaration;
const QueryAnalyzer = require('composer-common').QueryAnalyzer;
const Logger = require('composer-common').Logger;

const _ = require('lodash');
const crypto = require('crypto');
const EventEmitter = require('events');
const NodeCache = require('node-cache');
const util = require('util');

const ConnectionWrapper = require('./connection');
const QueryBuilder = require('./query-builder');

const debug = require('debug')('loopback:connector:composer');


/**
 * A Loopback connector for exposing the Blockchain Solution Framework to Loopback enabled applications.
 */
class Client {

    /**
     * Constructor.
     * @param {Object} settings the settings used by the call to BusinessNetworkConnection
     */
    constructor(settings) {
        debug('constructor');

        // Check for required properties.
        if (!settings.card) {
            throw new Error('card not specified');
        }

        this.classDeclarations = new Map();

        // Assign defaults for any optional properties.
        this.settings = settings;
        this.settings.namespaces = this.settings.namespaces || 'always';
        this.settings.multiuser = !!this.settings.multiuser;

        // Create a new visitor for generating LoopBack models.
        this.visitor = new LoopbackVisitor(this.settings.namespaces === 'always');

        // Create the cache, which will automatically close connections after 5 minutes.
        this.connectionWrappers = new NodeCache({
            stdTTL: 5 * 60,
            useClones: false
        });
        this.connectionWrappers.on('del', (key, value) => {
            return value.disconnect()
                .catch((error) => {
                    console.error(error);
                });
        });
        this.defaultConnectionWrapper = new ConnectionWrapper(settings);

        // Create the event handler for this connector.
        this.eventemitter = new EventEmitter();

    }

    /**
     * Get a connection wrapper for the specified LoopBack options.
     * @param {Object} options The options from LoopBack.
     * @return {ConnectionWrapper} The connection wrapper.
     */
    getConnectionWrapper(options) {

        // If multiple user mode has been specified, and an accessToken has been specified,
        // then handle the request by using a user specific connection.
        if (this.settings.multiuser && options && options.accessToken) {

            // Check that the LoopBack application has supplied the required information.
            if (!options.card) {
                throw new Error('A business network card has not been specified');
            } else if (!options.cardStore) {
                throw new Error('A business network card store has not been specified');
            }

            // The connection wrapper key is a hash of the access token and business network card.
            const key = crypto.createHmac('sha256', 'such secret')
                .update(options.accessToken.id)
                .update(options.card)
                .digest('hex');

            // Check to see if a connection wrapper already exists for the key, if not create one.
            let connectionWrapper = this.connectionWrappers.get(key);
            if (!connectionWrapper) {
                debug('Creating new connection wrapper for key', key);
                const settings = Object.assign(this.settings, {
                    cardStore: options.cardStore,
                    card: options.card
                });
                connectionWrapper = new ConnectionWrapper(settings);
                this.connectionWrappers.set(key, connectionWrapper);
            }
            return connectionWrapper;

        }

        // Otherwise, return the default connection wrapper.
        return this.defaultConnectionWrapper;

    }

    /**
     * Ensure that the connector has connected to Composer.
     * @param {Object} options The options from LoopBack.
     * @return {Promise} A promise that is resolved with a {@link BusinessNetworkConnection}
     * when the connector has connected, or rejected with an error.
     */
    ensureConnected(options) {
        debug('ensureConnected');
        return this.getConnectionWrapper(options).ensureConnected();
    }

    /**
     * Connect to the Business Network
     * @param {function} callback the callback to call when complete.
     * @return {Promise} A promise that is resolved when complete.
     */
    connect(callback) {
        debug('connect');
        const connectionWrapper = this.getConnectionWrapper(null);
        return connectionWrapper.connect()
            .then(() => {

                // Store required objects from the connection wrapper.
                this.businessNetworkDefinition = connectionWrapper.getBusinessNetworkDefinition();
                this.serializer = connectionWrapper.getSerializer();
                // this.modelManager = connectionWrapper.getModelManager();
                this.introspector = connectionWrapper.getIntrospector();

                // Register an event handler.
                connectionWrapper.getBusinessNetworkConnection().on('event', (event) => {
                    const json = this.serializer.toJSON(event);
                    this.eventemitter.emit('event', json);
                });
            })
            .then(() => {
                return this.discoverClassDefinitions(this.settings);
            })
            .then((classDeclarations) => {

                classDeclarations.forEach( classDeclaration => {
                    this.classDeclarations.set(classDeclaration.getFullyQualifiedName(), classDeclaration);
                });

                if (callback) {
                    callback();
                }
            })
            .catch((error) => {
                if (callback) {
                    callback(error);
                }
            });
    }

    /**
     * Test the connection to Composer.
     * @param {Object} [options] The options provided by Loopback.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    ping(options, callback) {
        let actualOptions = null, actualCallback = null;
        if (arguments.length === 1) {
            // LoopBack API, called with (callback).
            actualCallback = options;
        } else {
            // Composer API, called with (options, callback).
            actualOptions = options;
            actualCallback = callback;
        }
        debug('ping', actualOptions);
        return this.ensureConnected(actualOptions)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.ping();
            })
            .then((result) => {
                actualCallback(null, result);
            })
            .catch((error) => {
                actualCallback(error);
            });
    }

    /**
     * Disconnect from the Business Network.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    disconnect(callback) {
        debug('disconnect');
        return this.getConnectionWrapper().disconnect()
            .then(() => {
                callback();
            })
            .catch((error) => {
                callback(error);
            });
    }

    /**
     * Subscribe to events that are published from the business network.
     * @param {function} listener The callback to call when an event is received.
     */
    subscribe(listener) {
        this.eventemitter.on('event', listener);
    }

    /**
     * Subscribe to events that are published from the business network.
     * @param {function} listener The callback to call when an event is received.
     */
    unsubscribe(listener) {
        this.eventemitter.removeListener('event', listener);
    }

    /**
     * Get the registry that stores the resources of the specified model type.
     * @param {BusinessNetworkConnection} businessNetworkConnection the business network connection to use.
     * @param {string} ClassName The name of the model.
     * @return {Promise} A promise that will be resolved with the {@link Registry},
     * or rejected with an error.
     */
    getRegistryForClass(businessNetworkConnection, ClassName) {
        debug('getRegistryForClass', ClassName);

        let classDeclaration = _.get(this.models, ClassName);

        if (!classDeclaration) {
            throw new Error(`ClassDeclaration is not defined for  ClassName '${ClassName}'.`);
        }

        if (classDeclaration instanceof AssetDeclaration) {
            return businessNetworkConnection.getAssetRegistry(ClassName);
        } else if (classDeclaration instanceof ParticipantDeclaration) {
            return businessNetworkConnection.getParticipantRegistry(ClassName);
        } else if (classDeclaration instanceof TransactionDeclaration) {
            return businessNetworkConnection.getTransactionRegistry(ClassName);
        } else {
            return Promise.reject(new Error('No registry for specified model name'));
        }
    }

    /**
     * Retrieves all the instances of objects in the Business Network.
     * @param {string} className The name of the model.
     * @param {Object} filter The filter of which objects to get
     * @param {Object} options The options like {card: ..., cardStore:...}.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    findAll(className, filter = {}, options, callback) {
        debug('findAll', className, filter, options);

        let networkConnection = null;

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                networkConnection = businessNetworkConnection;
                return this.getRegistryForClass(businessNetworkConnection, className);
            })
            .then((registry) => {

                // check for resolve include filter
                let doResolve = this.isResolveSet(filter);
                let filterKeys = Object.keys(filter);

                if (filterKeys.indexOf('where') !== -1) {
                    const keys = Object.keys(filter.where);
                    const nKeys = keys.length;
                    if (nKeys === 0) {
                        throw new Error('The Loopback ALL operation, without a full WHERE clause, is not supported');
                    }
                    let identifierField = this.getClassIdentifier(className);

                    // Check if the filter is a simple ID query
                    // - will be undefined if no identifier involved
                    // - will have a single string objectId if a simple query on the identifier
                    // - will have an object if identifier is involved with more complex query
                    let objectId = filter.where[identifierField];

                    if (objectId && typeof objectId === 'string') {
                        if (doResolve) {
                            return registry.resolve(objectId)
                                .then((result) => {
                                    debug('registry.resolve result:', result);
                                    return [result];
                                });
                        } else {
                            return registry.get(objectId)
                                .then((result) => {
                                    debug('registry.get result:', result);
                                    return [this.serializer.toJSON(result)];
                                });
                        }
                    } else {
                        // perform filter query when id is not the first field
                        const queryString = QueryBuilder.create(filter, className);
                        const query = networkConnection.buildQuery(queryString);
                        if (typeof query === 'undefined') {
                            throw Error('Invalid property name specified in the filter');
                        }
                        return networkConnection.query(query, {})
                            .then((results) => {
                                debug('networkConnection.query result:', results);
                                if (doResolve) {
                                    let ress = [];
                                    for (let i = 0; i < results.length; i++) {
                                        let id = results[i][identifierField];
                                        let result = registry.resolve(id);
                                        ress.push(result);
                                    }
                                    return Promise.all(ress);
                                } else {

                                    return results.map((res) => {
                                        return this.serializer.toJSON(res);
                                    });
                                }
                            });
                    }
                } else if (doResolve) {
                    debug('No `where` filter, about to perform resolveAll');
                    // get all resolved objects
                    return registry.resolveAll()
                        .then((result) => {
                            debug('Got Result:', result);
                            return result;
                        });

                } else {
                    // get all unresolved objects
                    debug('No `where` filter, about to perform getAll');
                    return registry.getAll()
                        .then((result) => {
                            debug('Got Result:', result);
                            return result.map((res) => {
                                return this.serializer.toJSON(res);
                            });
                        });
                }
            })
            .then((result) => {
                if(callback) {
                    callback(null, result);
                }
                return result;
            })
            .catch((error) => {
                if (error.message.match(/Object with ID.*does not exist/)) {
                    if(callback) {
                        callback(null, []);
                    }
                    return;
                }
                debug('all', 'error thrown doing all', error);
                if(callback) {
                    callback(error);
                }
                return error;
            });
    }

    /**
     * check if the filter contains an Include filter
     * @param {Object} filter The filter of which objects to get
     * @return {boolean} true if there is an include that specifies to resolve
     */
    isResolveSet(filter) {
        debug('isResolveSet', filter);
        let filterKeys = Object.keys(filter);
        if (filterKeys.indexOf('include') >= 0) {
            if (filter.include === 'resolve') {
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    /**
     * Get the identifier for the given class
     * @param {string} ClassName The fully qualified Composer name of the class.
     * @return {string} the identifier for this class
     */
    getClassIdentifier(ClassName) {
        debug('getClassIdentifier', ClassName);
        let classDeclaration = this.classDeclarations.get(className);
        return classDeclaration.getIdentifierFieldName();
    }


    /**
     * Check that the identifier provided matches that in the model.
     * @param {string} className The fully qualified Composer model name.
     * @param {id} id The filter to identify the asset or participant to be removed.
     * @return {boolean} true if the identifier is valid, false otherwise
     */
    isValidId(className, id) {
        debug('isValidId', className, id);
        let classDeclaration = this.classDeclarations.get(className);
        if (classDeclaration.getIdentifierFieldName() === id) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Check that the class name provided matches that in the model.
     * @param {string} className The fully qualified Composer model name.
     * @return {boolean} true if the identifier is valid, false otherwise
     */
    isValidClassName(className) {
        debug('isValidId', className, id);
        return this.classDeclarations.has(className);
    }

    /**
     * counts the number of instances of the specified object in the blockchain
     * @param {string} className class name.
     * @param {string} where The LoopBack filter with the ID apply.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The Callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    count(className, where, options, callback) {
        debug('count', className, where, options);

        let networkConnection = null;

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                networkConnection = businessNetworkConnection;
                return this.getRegistryForClass(businessNetworkConnection, className);
            })
            .then((registry) => {
                const fields = Object.keys(where || {});
                const numFields = fields.length;
                if (numFields > 0) {
                    // Check if the filter is a simple ID query
                    let idField = null;
                    let bFound = false;
                    // find the valid id from the list of fields
                    for (let i = 0; i < numFields; i++) {
                        if (this.isValidId(className, fields[i])) {
                            idField = fields[i];
                            bFound = true;
                            break;
                        }
                    }
                    // find the key in the list fields
                    if (bFound) {
                        // Just a basic existence check for now
                        return registry.exists(where[idField])
                            .then((exists) => {
                                return exists ? 1 : 0;
                            });
                    } else {
                        const queryConditions = QueryBuilder.parseWhereCondition(where, className);
                        const queryString = 'SELECT ' + className + ' WHERE ' + queryConditions;
                        const query = networkConnection.buildQuery(queryString);

                        return networkConnection.query(query, {})
                            .then((result) => {
                                debug('Got Result:', result);
                                return result.length;
                            });
                    }
                } else {
                    return registry.getAll()
                        .then((resources) => {
                            return resources.length;
                        });
                }
            })
            .then((result) => {
                callback(null, result);
            })
            .catch((error) => {
                debug('count', 'error thrown doing count', error);
                callback(error);
            });
    }

    /**
     * Runs the callback with whether the object exists or not.
     * @param {string} className The composer model name.
     * @param {string} id The LoopBack filter with the ID apply.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The Callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    exists(className, id, options, callback) {
        debug('exists', className, id);

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return this.getRegistryForClass(businessNetworkConnection, className);
            })
            .then((registry) => {
                return registry.exists(id);
            })
            .then((result) => {
                callback(null, result);
            })
            .catch((error) => {
                debug('exists', 'error thrown doing exists', error);
                callback(error);
            });
    }

    /**
     * Updates the properties of the specified object in the Business Network.
     * This function is called by the PATCH API.
     * @param {string} className The name of the model.
     * @param {string} objectId The id of the object to update
     * @param {Object} data The object data to use for modification
     * @param {Object} options The LoopBack options.
     * @param {Object} callback The object data to use for modification
     * @returns {Promise} A promise that is resolved when complete.
     */
    update(className, objectId, data, options, callback) {
        debug('update', className, objectId, data);

        // If the $class property has not been provided, add it now.
        if (!data.$class) {
            data.$class = className;
        }

        let registry;
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return this.getRegistryForClass(businessNetworkConnection, className);
            })
            .then((registry_) => {
                registry = registry_;
                return registry.get(objectId);
            })
            .then((resource) => {
                const object = this.serializer.toJSON(resource);
                Object.keys(data).forEach((key) => {
                    object[key] = data[key];
                });
                resource = this.serializer.fromJSON(object);
                return registry.update(resource);
            })
            .then((result) => {
                if(callback) {
                    callback(null, result);
                }
                return result;
            })
            .catch((error) => {
                debug('updateAttributes', 'error thrown doing update', error);
                if(callback) {
                    callback(error);
                }
                return error;
            });

    }

    /**
     * Create an instance of an object in Composer. For assets, this method
     * adds the asset to the default asset registry. For transactions, this method
     * submits the transaction for execution.
     * @param {string} className class name.
     * @param {Object} data the data for the asset or transaction.
     * @param {Object} options the options like {card: ..., cardStore:...}.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    create(className, data, options, callback) {
        debug('create', data, options);

        if (!data.$class) {
            data.$class = className
        }

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {

                // For assets and participants, we add the resource to its default registry.
                // Ensure we return undefined so that we don't tell LoopBack about a generated
                // identifier, as it was specified by the user.
                return this.getRegistryForClass(businessNetworkConnection, className)
            })
            .then((registry) => {
                // Convert the JSON data into a resource.
                let serializer = this.businessNetworkDefinition.getSerializer();
                let resource = serializer.fromJSON(data);

                return registry.add(resource);
            })
            .then((identifier) => {
                if(callback) {
                    callback(null, identifier);
                }
                return identifier
            })
            .catch((error) => {
                debug('create', 'error thrown doing create', error);
                if(callback) {
                    callback(error);
                }
                return error;
            });
    }

    /**
     * Submits the transaction for execution.
     * @param {Object} data the data for the asset or transaction.
     * @param {Object} options the options like {card: ..., cardStore:...}.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    submitTransaction(data, options, callback) {
        debug('submitTransaction', data, options);

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                // Convert the JSON data into a resource.
                let serializer = this.businessNetworkDefinition.getSerializer();
                let resource = serializer.fromJSON(data);

                // The create action is based on the type of the resource.
                // If it's a transaction, it's a transaction submit.
                let classDeclaration = resource.getClassDeclaration();
                if (!(classDeclaration instanceof TransactionDeclaration)) {
                    throw new Error('classDeclaration is not type of transaction.')
                }

                // For transactions, we submit the transaction for execution.
                // Ensure we return the generated identifier, so that LoopBack can return
                // the generated identifier back to the user.
                return businessNetworkConnection.submitTransaction(resource)
                    .then((response) => {

                        // Return the response for returning transactions
                        if (response) {

                            // If transactions returns a concept, convert to JSON the Resource
                            if (response instanceof Object && !(response instanceof Array)) {
                                return this.businessNetworkDefinition.getSerializer().toJSON(response);

                            } else if (response instanceof Array) {
                                // If transactions returns an array of concept, convert all Concepts to JSON
                                let conceptArray = [];

                                response.forEach(item => {
                                    if (item instanceof Object) {
                                        let obj = this.businessNetworkDefinition.getSerializer().toJSON(item);
                                        if (obj) {
                                            conceptArray.push(obj);
                                        }
                                    } else {
                                        conceptArray.push(item);
                                    }
                                });

                                return conceptArray;
                            }
                            // Otherwise (Primitives and ENUMs) return the response
                            return response;
                        }
                        return resource.getIdentifier();
                    });

            })
            .then((identifier) => {
                if(callback) {
                    callback(null, identifier);
                }
                return identifier
            })
            .catch((error) => {
                debug('create', 'error thrown doing submit transaction', error);
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Destroy instances of the specified objects in the Business Network.
     * @param {string} className The fully qualified model name.
     * @param {string} objectId The filter to identify the asset or participant to be removed.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    destroy(className, objectId, options, callback) {
        debug('destroy', className, objectId, options);

        let registry;
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return this.getRegistryForClass(businessNetworkConnection, className);
            })
            .then((registry_) => {
                registry = registry_;
                return registry.get(objectId);
            })
            .then((resourceToRemove) => {
                return registry.remove(resourceToRemove);
            })
            .then((identifier) => {
                if(callback) {
                    callback(null, identifier);
                }
                return identifier
            })
            .catch((error) => {
                debug('destroy', 'error thrown doing remove', error);
                if (error.message.match(/Object with ID.*does not exist/)) {
                    error.statusCode = error.status = 404;
                }
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Get an instance of an object in Composer. For assets, this method
     * gets the asset from the default asset registry.
     * @param {string} className the fully qualified model name.
     * @param {string} id the identifier of the asset or participant to retrieve.
     * @param {Object} options the options like {card: ..., cardStore:...}.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    findById(className, id, options, callback) {
        debug('retrieve', className, id, options);

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {

                // For assets, we add the asset to its default asset registry
                return this.getRegistryForClass(businessNetworkConnection, className)
                    .then((registry) => {
                        return registry.get(id);
                    })
                    .then((resource) => {
                        let serializer = this.serializer;
                        return serializer.toJSON(resource);
                    });

            })
            .then((result) => {
                if(callback) {
                    callback(null, result);
                }
                return result;
            })
            .catch((error) => {
                debug('retrieve', 'error thrown doing retrieve', error);
                if(callback) {
                    callback(error);
                }
                return error;
            });
    }

    /**
     * Destroy all instances of the specified objects in the Business Network.
     * @param {string} className The fully qualified model name.
     * @param {string} where The filter to identify the asset or participant to be removed.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    destroyAll(className, where, options, callback) {
        debug('destroyAll', className, where, options);

        let idField, registry;
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                const keys = Object.keys(where);
                if (keys.length === 0) {
                    throw new Error('The destroyAll operation without a where clause is not supported');
                }
                idField = keys[0];
                if (!this.isValidId(className, idField)) {
                    throw new Error('The specified filter does not match the identifier in the model');
                }
                return this.getRegistryForClass(businessNetworkConnection, className);
            })
            .then((registry_) => {
                registry = registry_;
                return registry.get(where[idField]);
            })
            .then((resourceToRemove) => {
                return registry.remove(resourceToRemove);
            })
            .then((result) => {
                if(callback) callback(null, result);
                return result;
            })
            .catch((error) => {
                debug('destroyAll', 'error thrown doing remove', error);
                if (error.message.match(/Object with ID.*does not exist/)) {
                    error.statusCode = error.status = 404;
                }
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Get all of the identities from the identity registry.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    getAllIdentities(options, callback) {
        debug('getAllIdentities', options);
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.getIdentityRegistry();
            })
            .then((identityRegistry) => {
                return identityRegistry.getAll();
            })
            .then((identities) => {
                const result = identities.map((identity) => {
                    return this.serializer.toJSON(identity);
                });
                if(callback) {
                    callback(null, result);
                }
                return result;
            })
            .catch((error) => {
                debug('getAllIdentities', 'error thrown doing getAllIdentities', error);
                if(callback) {
                    callback(error);
                }
                return error

            });
    }

    /**
     * Get the identity with the specified ID from the identity registry.
     * @param {string} id The ID for the identity.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    getIdentityByID(id, options, callback) {
        debug('getIdentityByID', options);
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.getIdentityRegistry();
            })
            .then((identityRegistry) => {
                return identityRegistry.get(id);
            })
            .then((identity) => {
                const result = this.serializer.toJSON(identity);

                if(callback) {
                    callback(null, result);
                }
                return result
            })
            .catch((error) => {
                debug('getIdentityByID', 'error thrown doing getIdentityByID', error);
                if (error.message.match(/Object with ID.*does not exist/)) {
                    error.statusCode = error.status = 404;
                }
                if(callback) {
                    callback(error);
                }
                return error

            });

    }

    /**
     * Issue an identity to the specified participant.
     * @param {string} participant The fully qualified participant ID.
     * @param {string} userID The user ID for the new identity.
     * @param {Object} issueOptions Options for creating the new identity.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    issueIdentity(participant, userID, issueOptions, options, callback) {
        debug('issueIdentity', participant, userID, issueOptions, options);
        let issuingCard;
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                // Save the current business network card so we can create a new one.
                issuingCard = businessNetworkConnection.getCard();
                return businessNetworkConnection.issueIdentity(participant, userID, issueOptions);
            })
            .then((result) => {
                const metadata = {
                    userName: result.userID,
                    version: 1,
                    enrollmentSecret: result.userSecret,
                    businessNetwork: issuingCard.getBusinessNetworkName()
                };
                const newCard = new IdCard(metadata, issuingCard.getConnectionProfile());
                return newCard.toArchive({type: 'nodebuffer'});
            })
            .then((result) => {
                if(callback) {
                    callback(null, result);
                }
                return result;
            })
            .catch((error) => {
                debug('issueIdentity', 'error thrown doing issueIdentity', error);
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Bind an identity to the specified participant.
     * @param {string} participant The fully qualified participant ID.
     * @param {string} certificate The certificate for the new identity.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    bindIdentity(participant, certificate, options, callback) {
        debug('bindIdentity', participant, certificate, options);
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.bindIdentity(participant, certificate);
            })
            .then((result) => {
                if(callback) {
                    callback(null, result);
                }
                return result;
            })
            .catch((error) => {
                debug('bindIdentity', 'error thrown doing bindIdentity', error);
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Revoke the specified identity by removing any existing mapping to a participant.
     * @param {string} userID The user ID for the identity.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    revokeIdentity(userID, options, callback) {
        debug('revokeIdentity', userID, options);
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.revokeIdentity(userID);
            })
            .then((result) => {
                if(callback) {
                    callback(null, result);
                }
                return result
            })
            .catch((error) => {
                debug('revokeIdentity', 'error thrown doing revokeIdentity', error);
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Get all of the HistorianRecords from the Historian
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    getAllHistorianRecords(options, callback) {
        debug('getAllHistorianRecords', options);
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.getHistorian();
            })
            .then((historian) => {
                return historian.getAll();
            })
            .then((records) => {
                const result = records.map((transaction) => {
                    return this.serializer.toJSON(transaction);
                });
                if(callback) {
                    callback(null, result);
                }
                return result
            })
            .catch((error) => {
                debug('getAllHistorianRecords', 'error thrown doing getAllHistorianRecords', error);
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Execute a named query and returns the results
     * @param {string} queryName The name of the query to execute
     * @param {object} queryParameters The query parameters
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    executeQuery(queryName, queryParameters, options, callback) {
        debug('executeQuery', options);
        debug('queryName', queryName);
        debug('queryParameters', util.inspect(queryParameters));

        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                // all query parameters come in as string
                // so we need to coerse them to their correct types
                // before executing a query
                // TODO (DCS) not sure this should be done here, as it will also
                // need to be done on the runtime side
                const query = businessNetworkConnection.getBusinessNetwork().getQueryManager().getQuery(queryName);

                if (!query) {
                    throw new Error('Named query ' + queryName + ' does not exist in the business network.');
                }

                const qa = new QueryAnalyzer(query);
                const parameters = qa.analyze();

                for (let n = 0; n < parameters.length; n++) {
                    const param = parameters[n];
                    const paramValue = queryParameters[param.name];

                    if (typeof paramValue === 'undefined' || paramValue === null) {
                        throw new Error('The value of the parameter type: ' + param.type + ' is null or undefined.');
                    }

                    switch (param.type) {
                        case 'Integer':
                        case 'Long':
                            queryParameters[param.name] = parseInt(paramValue, 10);
                            break;
                        case 'Double':
                            queryParameters[param.name] = parseFloat(paramValue);
                            break;
                        case 'DateTime':
                            queryParameters[param.name] = paramValue;
                            break;
                        case 'Boolean':
                            queryParameters[param.name] = (paramValue === 'true');
                            break;
                    }
                }

                return businessNetworkConnection.query(queryName, queryParameters);
            })
            .then((queryResult) => {
                const result = queryResult.map((item) => {
                    return this.serializer.toJSON(item);
                });
                if(callback) {
                    callback(null, result);
                }
                return result
            })
            .catch((error) => {
                if(callback) {
                    callback(error);
                }
                return error
            });
    }

    /**
     * Get the Historian Record with the specified ID from the historian.
     * @param {string} id The ID for the transaction.
     * @param {Object} options The LoopBack options.
     * @param {function} callback The callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    getHistorianRecordByID(id, options, callback) {
        debug('getHistorianRecordByID', options);
        return this.ensureConnected(options)
            .then((businessNetworkConnection) => {
                return businessNetworkConnection.getHistorian();
            })
            .then((historian) => {
                return historian.get(id);
            })
            .then((transaction) => {
                const result = this.serializer.toJSON(transaction);
                if(callback) {
                    callback(null, result);
                }
                return result
            })
            .catch((error) => {
                debug('getHistorianRecordByID', 'error thrown doing getHistorianRecordByID', error);
                if (error.message.match(/Object with ID.*does not exist/)) {
                    error.statusCode = error.status = 404;
                }
                if(callback) {
                    callback(error);
                }
                return error
            });

    }

    /**
     * Retrieve the list of all available model names, or the model names in a
     * specified namespace.
     * @param {Object} options the options like {card: ..., cardStore:...}.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    discoverClassDefinitions(options, callback) {
        debug('discoverClassDeclarations', options);
        return this.ensureConnected(options)
            .then(() => {
                // Find all the types in the business network.
                const classDeclarations = this.introspector.getClassDeclarations()
                    .filter((classDeclaration) => {

                        // Filter out anything that isn't a type we want to represent, including returning transactions
                        return (classDeclaration instanceof AssetDeclaration) ||
                            (classDeclaration instanceof ConceptDeclaration) ||
                            (classDeclaration instanceof ParticipantDeclaration) ||
                            (classDeclaration instanceof TransactionDeclaration && !classDeclaration.getDecorator('returns'));

                    })
                    .filter((classDeclaration) => {

                        // Filter out any system types.
                        return !classDeclaration.isSystemType();
                    });

                debug('discoverClassDefinitions', 'returning list of model class declarations', _.map(classDeclarations, model => model.getFullyQualifiedName()));

                if(callback) {
                    callback(null, classDeclarations);
                }
                return classDeclarations
            })
            .catch((error) => {
                debug('discoverClassDefinitions', 'error thrown discovering list of model class declarations', error);
                if(callback) {
                    callback(error);
                }
                return error
            });
    }


    /**
     * Retrieve the list of all named queries in the business network
     * @param {Object} options the options like {card: ..., cardStore:...}.
     * @param {function} callback the callback to call when complete.
     * @returns {Promise} A promise that is resolved when complete.
     */
    discoverQueries(options, callback) {
        debug('discoverQueries', options);
        return this.ensureConnected(options)
            .then(() => {
                const queries = this.businessNetworkDefinition.getQueryManager().getQueries();
                if(callback) {
                    callback(null, queries);
                }
                return queries
            })
            .catch((error) => {
                debug('discoverQueries', 'error thrown discovering list of query declarations', error);
                if(callback) {
                    callback(error);
                }
                return result
            });
    }
}

module.exports = Client;
