const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'})
const sinon = require('sinon')
const Algolia = require('../controller/db_algolia')
const CryptoJS = require("crypto-js")

const EncryptionKey = process.env.ENCRYPTION_KEY

const AlgoliaParams = {
  appID: process.env.ALGOLIA_APP,
  apiKey: process.env.ALGOLIA_ADMIN_API_KEY
}


/**
 * Retrieves and decrypts data
 *
 * @param  {String} index [Required]
 * @param  {Object} data [Required]
 * @param  {String} data.objectID [Optional] - (required if updating)
 * @return {Object}
 */
exports.getData = async (index, objectID) => {
  const encryptedData = await Algolia.connect(AlgoliaParams.appID, AlgoliaParams.apiKey, index).getObject(objectID)
  const decryptedData = decryptData(encryptedData)
  return decryptedData
}

/**
 * Retrieves and decrypts data. @NOTE: Only keys starting with '__' (two underscores) are decrypted
 *
 * @param  {String} index [Required]
 * @return {Object}
 */
exports.getAllData = async (index) => {
  const allEncryptedData = await Algolia.connect(AlgoliaParams.appID, AlgoliaParams.apiKey, index).searchObjects({query: ''})
  const allDecryptedData = allEncryptedData.hits.map(encryptedData => {
    return decryptData(encryptedData)
  })
  return allDecryptedData
}

/**
 * Encrypts and stores data. @NOTE: Only keys starting with '__' (two underscores) are encrypted
 *
 * @param  {String} index [Required]
 * @param  {Object} data [Required]
 * @param  {String} data.objectID [Optional] - (required if updating)
 * @return {Object}
 */
exports.setData = async (index, data) => {
  const encryptedData = encryptData(data)
  const result = await Algolia.connect(AlgoliaParams.appID, AlgoliaParams.apiKey, index).saveObject({}, encryptedData)
  return result
}

/**
 * Encrypts and adds data to object without replacing other values (on first level) - i.e. a Partial Update. @NOTE: Only keys starting with '__' (two underscores) are encrypted
 *
 * @param  {String} index [Required]
 * @param  {Object} data [Required]
 * @param  {String} data.objectID [Required]
 * @return {Object}
 */
exports.addData = async (index, data) => {
  const encryptedData = encryptData(data)
  const result = await Algolia.connect(AlgoliaParams.appID, AlgoliaParams.apiKey, index).partialUpdateObject({}, encryptedData)
  return result
}


const decryptData = data => {
  logger.trace(decryptData, data)
  const decryptedData = {}
  Object.keys(data).forEach(key => {
    const val = data[key]
    if (typeof val === 'array' || typeof val === 'object')
      decryptedData[key] = decryptData(val)
    else if (key === 'objectID' || key.substring(0, 2) !== '__')
      decryptedData[key] = val
    else
      decryptedData[key] = CryptoJS.AES.decrypt(val, EncryptionKey).toString(CryptoJS.enc.Utf8)
  })
  logger.trace('decryptedData:', decryptedData)
  return decryptedData
}

const encryptData = data => {
  logger.trace(encryptData, data)
  const encryptedData = {}
  Object.keys(data).forEach(key => {
    const val = data[key]
    if (typeof val === 'array' || typeof val === 'object')
      encryptedData[key] = encryptData(val)
    else if (key === 'objectID' || key.substring(0, 2) !== '__')
      encryptedData[key] = val
    else
      encryptedData[key] = CryptoJS.AES.encrypt(val, EncryptionKey).toString()
  })
  logger.trace('encryptedData:', encryptedData)
  return encryptedData
}
