const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'trace'})
const request = require('request')

exports.process = (sender, text, contexts) => new Promise(function(resolve, reject) {
  logger.trace('process', sender, text, contexts)
  try {
    const messageToApiai = text.substring(0, 256).replace(/\'/g, '\\\'').replace(/([\uE000-\uF8FF]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDDFF])/g, '').replace(/\/|\*/gi,''); // Only sends API.AI the first 256 characters as it can't handle more than that
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': 'Bearer ' + process.env.DIALOGFLOW_CLIENT_ACCESS_TOKEN
    };
    const dataString = JSON.stringify({
      query: messageToApiai,
      timezone: 'GMT+1',
      lang: 'en',
      sessionId: sender.uid,
      contexts: contexts
    })
    const options = {
      url: 'https://api.api.ai/v1/query?v=20150910',
      method: 'POST',
      headers: headers,
      body: dataString
    }
    logger.trace('dataString', dataString)
    logger.trace('options', options)
    function callback(error, response, body) {
      if (!error && response.statusCode == 200) {
        const result = JSON.parse(body).result
        result.intent = result.metadata.intentName
        result.query = text //Should actually just not rely on query later on
        logger.trace('DialogFlow Result:', result)
        resolve(result)
      } else {
        logger.error(response && response.statusCode)
        logger.error(response && response.statusMessage)
        logger.error(error)
        // reject(error)
        // Need to handle this properly
        result = {
          intent: 'query',
          query: text,
        }
        resolve(result)
      }
    }
    request(options, callback);
  } catch(e) {
    logger.error(e);
    reject(e)
  }
})
