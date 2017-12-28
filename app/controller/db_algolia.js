const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'})
const AlgoliaSearch = require('algoliasearch')

Index = class Index {
  constructor(appID, apiKey, indexID) {
    logger.trace('constructor', appID, apiKey, indexID)
    const client = AlgoliaSearch(appID, apiKey, { protocol: 'https:' })
    this.AlgoliaIndex = client.initIndex(indexID)
  }
  getObject(objectID, attributesToRetrieve) {
    const self = this
    return new Promise((resolve, reject) => {
      self.AlgoliaIndex.getObject(objectID, attributesToRetrieve, (err, content) => {
        if (err) {
          logger.error(err)
          reject(err)
        } else {
          resolve(content)
        }
      })
    })
  }
  searchObjects(apiKey, index, params) {
    const self = this
    return new Promise((resolve, reject) => {
      self.AlgoliaIndex.search(params, (err, content) => {
    		if (err) {
          logger.error(err);
    			reject(err)
    		} else {
          resolve(content)
    		}
    	})
    })
  }
  deleteObject(sender, organisationID, objectID) {
    // IS THIS SECURE? DOES IT DIFFERENTIATE BY SENDER????
    logger.trace('deleteObject', sender, organisationID, objectID)
    const self = this
    return new Promise((resolve, reject) => {
    	self.AlgoliaIndex.deleteObject(objectID, (err, content) => {
    		if (err) {
    			logger.error(err)
    			reject(err)
    		} else {
    			logger.trace('User memory deleted successfully!')
    			resolve()
    		}
    	})
    })
  }
}

exports.Index = Index

exports.connect = (appID, apiKey, indexID) => {
  logger.trace('connect', appID, apiKey, indexID)
  const index = new Index(appID, apiKey, indexID)
  return {
    getObject: index.getObject,
    searchObjects: index.searchObjects,
    deleteObject: index.deleteObject,
  }
}
