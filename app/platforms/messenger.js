//@TODO: Sort delays (currently always 0)
//@TODO: Sort endpoints (currently always message endpoint - not attachment)
//@TODO: Investigate the default quick replies now being on all types of message...
//@TODO: Link attachments seem to break it?

process.env.TZ = 'Europe/London' // Forces the timezone to be London

const chatbotController = require('../controller/chatbot');

const request = require('request');
const properties = require('../config/properties.js');
const schedule = require('node-schedule');
const chrono = require('chrono-node')
const crypto = require("crypto");
const Q = require("q");


const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'log'});
// tracer.setLevel('error');


// check token for connecting to facebook webhook
exports.tokenVerification = function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === properties.facebook_challenge) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
}


const receiveMessagesToSend = function(data) {
  const d = Q.defer()
  handleMessageGroup(data)
  .then(function(res) {
    d.resolve(res)
  }).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
  return d.promise
}

chatbotController.acceptClientMessageFunction(receiveMessagesToSend)


const requestPromise = function(params) {
	var d = Q.defer();
	request(params, function (error, response) {
		if (error) {
			d.reject(error)
		} else {
			d.resolve(response)
		}
	});
	return d.promise
}


var setupGetStartedButton = function() {
	const d = Q.defer();
	// Check whether button exists
	const check = {
    uri: properties.facebook_profile_endpoint,
    qs: {
			fields: 'get_started',
			access_token: (process.env.FACEBOOK_TOKEN || properties.facebook_token)
		},
    method: 'GET'
  };

	// request(check, function (error, response, body) {
	// 	if (error) {
	// 		console.log(error);
	// 		d.reject(error)
	// 	} else {
	// 		console.log(body);
	// 		d.resolve(response, body)
	// 	}
	// });

	requestPromise(check)
	.then(function(response) {
		const body = response.body;
    if (response.statusCode == 200 && (!body.data || body.data.length == 0)) {
			const create = {
		    uri: properties.facebook_profile_endpoint,
		    qs: {
					access_token: (process.env.FACEBOOK_TOKEN || properties.facebook_token)
				},
		    method: 'POST',
				json: {
				  "get_started": {
				    "payload": properties.facebook_get_started_payload
					},
			  }
		  };
			return requestPromise(create)
    } else {
			throw new Error("Unable to read get started code.");
    }
	}).then(function(response) {
    d.resolve()
  }).catch(function(e) {
		console.error("Unable to proceed", e);
		d.reject(error)
	})
	return d.promise
}

setupGetStartedButton().done()


exports.handleMessage = function(req, res) {
  logger.trace()
  // logger.log(req)
  chatbotController.handleMessage(req.body)
  .then(function(res) {
    logger.log(res)
    return handleMessageGroup(res)
  }).then(function() {
    res.sendStatus(200);
  }).catch(function(e) {
    logger.error(e)
    res.sendStatus(200);
    // res.sendStatus(400);
  })
}

const handleMessageGroup = function(result) {
  const d = Q.defer();
  const promises = []
  if (result && result.messageData) {
    result.messageData.forEach(function(singleMessage) {
      promises.push(prepareAndSendMessages(singleMessage.data, singleMessage.delay || 0, properties.facebook_message_endpoint))
    })
  }
  Q.allSettled(promises)
  .then(function() {
    d.resolve()
  }).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
  return d.promise;
}



function prepareAndSendMessages(messageData, delay, endpoint) {
	logger.trace(prepareAndSendMessages);
	if (messageData.json) console.log(messageData.json.message); // ???
	const d = Q.defer();
	const textArray = (messageData.message && messageData.message.text) ? longMessageToArrayOfMessages(messageData.message.text, 640) : [false];
	const messageDataArray = textArray.map(function(text) {
		const data = JSON.parse(JSON.stringify(messageData));
    delete data.message.attachment
		if (text) data.message.text = text;
		return data;
	});
  if (messageData.message.attachment) {
    const attachmentMessageData = JSON.parse(JSON.stringify(messageData))
    delete attachmentMessageData.message.text
    messageDataArray.push(attachmentMessageData)
  }
  logger.trace()
	Q.allSettled(
		messageDataArray.map(function(message, i, array) {
      if (message.message.attachment) i = Math.max(i-1, 0) // Stop attachements from delaying before sending
			return sendMessageAfterDelay(message, delay + i*2000, endpoint);
		})
	).then(function(results) {
		logger.log(results)
		d.resolve(results)
	}).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
	return d.promise;
}


function longMessageToArrayOfMessages(message, limit) { // limit is in characters
	logger.trace(longMessageToArrayOfMessages);
	var counter = 0;
	var messageArray = [];
	while (message.length > limit && counter < 30) { // Once confident this loop won't be infinite we can remove the counter
		const split = splitChunk(message, limit);
		messageArray.push(split[0]);
		message = split[1];
		counter++;
	}
	messageArray.push(message);
	return messageArray;
}
function splitChunk(message, limit) {
	logger.trace(splitChunk);
	var shortened = message.substring(0, limit)
	if (shortened.indexOf("\n") > -1) shortened = shortened.substring(0, shortened.lastIndexOf("\n"));
	else if (shortened.indexOf(". ") > -1) shortened = shortened.substring(0, shortened.lastIndexOf(". ")+1);
	else if (shortened.indexOf(": ") > -1) shortened = shortened.substring(0, shortened.lastIndexOf(": ")+1);
	else if (shortened.indexOf("; ") > -1) shortened = shortened.substring(0, shortened.lastIndexOf("; ")+1);
	else if (shortened.indexOf(", ") > -1) shortened = shortened.substring(0, shortened.lastIndexOf(", ")+1);
	else if (shortened.indexOf(" ") > -1) shortened = shortened.substring(0, shortened.lastIndexOf(" "));
	var remaining = message.substring(shortened.length, message.length);
	shortened = shortened.trim().replace(/^\s+|\s+$/g, '').trim();
	remaining = remaining.trim().replace(/^\s+|\s+$/g, '').trim();
	return [shortened, remaining];
}



function sendMessageAfterDelay(message, delay, endpoint) {
	logger.trace(sendMessageAfterDelay);
	const d = Q.defer();
	if (!message.sender_action) sendSenderAction(message.recipient.id, 'typing_on');
	setTimeout(function() {
		callSendAPI(message, endpoint)
		.then(function(body) {
      sendSenderAction(message.recipient.id, 'typing_off');
			d.resolve(body)
		}).catch(function(err) {
      logger.error(err)
			d.reject(err)
		});
	}, delay);
	return d.promise;
}

/* being able to send the message */
var callSendAPI = function(messageData, endpoint) {
	const d = Q.defer();
	const requestData = {
    uri: (endpoint || properties.facebook_message_endpoint),
    qs: { access_token: (process.env.FACEBOOK_TOKEN || properties.facebook_token) },
    method: 'POST',
    json: messageData
  };
  logger.trace()
  logger.log(requestData)
  request(requestData, function (error, response, body) {
    logger.log(body)
    if (!error && response.statusCode == 200) {
			if (body.recipient_id) {
				console.log("Successfully sent message with id %s to recipient %s", body.message_id, body.recipient_id);
			} else if (body.attachment_id) {
				console.log("Successfully saved attachment");
			}
			d.resolve(body);
    } else {
      console.error("Unable to send message.", error);
			d.reject(error);
    }
  });
	return d.promise;
}

function sendSenderAction(recipientId, sender_action) {
	logger.trace(sendSenderAction);
	const d = Q.defer()
  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: sender_action
  };
	callSendAPI(messageData, properties.facebook_message_endpoint)
	.then(function(body) {
		d.resolve(body)
	}).catch(function(err) {
    logger.error(err)
		d.reject(err)
	});
	return d.promise
}







// Need to implement this!
function sendAttachmentUpload(recipientId, attachmentType, attachmentUrl) {
	logger.trace();
  const d = Q.defer()
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
			attachment: {
	      type: attachmentType,
	      payload: {
	        url: attachmentUrl,
					'is_reusable': true
	      }
	    }
    }
  };
	// This won't work as trying to resolve with more than one argument
  // , 0, properties.facebook_message_attachments_endpoint); /* @TODO: will this work? */
  d.resolve(messageData)
  return d.promise
}
