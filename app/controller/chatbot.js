//TODO: ask about reminders at unsociable hours
//@TODO: general error handling!
//@TODO: always accept storeMemory after attachment (?)
//@TODO: Stop interpreting thumbs up as attachment - interpret it as 'affirmation' instead
//@TODO: Don't do default quick replies when bot asks for info
//@TODO: Have timeout on unresolved webhooks
//@TODO: Put GIFs back in (occasionally)



process.env.TZ = 'Europe/London' // Forces the timezone to be London

const api = require('../controller/api');

const request = require('request');
const properties = require('../config/properties.js');
const schedule = require('node-schedule');
const Q = require("q");
const emoji = require('moji-translate');
const Randoms = require('../controller/cannedResponses.js').Randoms



const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'});
// tracer.setLevel('error');

const C = {}; // C is for Context



var getContext = function(sender, context) {
	try {
		const id = sender.id || sender.objectID || sender.uid
		return C[id][context];
	} catch(e) {
		return null; //Probaby not safe!
	}
}
var setContext = function(sender, context, value) {
	try {
		const id = sender.id || sender.objectID || sender.uid
		if (!C[id])
			C[id] = {}
		C[id][context] = value;
	} catch(e) {
		//Probaby not safe!
	}
}
var increaseContext = function(sender, context) {
	setContext(sender, context, getContext(sender, context)+1)
}


var clientMessageFunction;
exports.acceptClientMessageFunction = function(messageFunction) {
	clientMessageFunction = messageFunction
}

// For sending standalone messages
const sendClientMessage = function(data) {
	const d = Q.defer()
	if (clientMessageFunction) {
		clientMessageFunction(data)
		.then(function(res) {
			d.resolve(res)
		}).catch(function(e) {
			logger.error(e)
			d.reject(e)
		})
	} else {
		const e = 'No clientMessageFunction defined'
		logger.error(e)
		d.reject(e)
	}
	return d.promise
}


const receiveMessageToSend = function(data) {
  const d = Q.defer()
	try {
		logger.info('Received message: ', data)
		const responseMessage = data ? getResponseMessage(data) : null
		sendClientMessage(data)
		d.resolve(responseMessage)
	} catch(e){
		logger.error(e)
		d.reject(e)
	}
  return d.promise
}
api.acceptClientMessageFunction(receiveMessageToSend)


/* Get user information */
exports.fbInformation = function() {

}


/* Recieve request */
/**
 * @param {Object} body expects {Array} body.entry[0].messaging
 * @param {Object} body.entry[0].messaging[0].sender.id
 * @param {Object} body.entry[0].messaging[0].message.text
 *
 * @example body.entry = [{
 	messaging: [
		 {
			 sender: {
				 id: sender
			 },
			 message: {
				 text: message
			 },
		 }
	 ]
 }]
*/
exports.handleMessage = function(body) {
	logger.trace('handleMessage', body, JSON.stringify(body))
	const d = Q.defer()
	try {
		body.entry[0].messaging.forEach(function(event) {
			sender = event.sender;
			if (!C[sender]) C[sender] = {
				lastResults: [],
				consecutiveFails: 0,
				totalFailCount: 0
			}
			const context = event.context || {}
			if (event.platform) context.platform = event.platform
			setContext(sender, 'failing', false);
			var firstPromise;
			try {
				postback = null;
				postback = event.postback.payload;
			} catch (err) {}
			if (postback) {
				firstPromise = handlePostbacks({sender: sender}, postback)
				logger.trace()
			} else if (event.message) {
				if (event.message.quick_reply) {
					//sendSenderAction(sender, 'mark_seen');
					firstPromise = handleQuickReplies({sender: sender}, event.message.quick_reply)
				}	else if ((text = event.message.text)) {
					//sendSenderAction(sender, 'typing_on'); // Ideally this would happen after checking we actually want to respond
					// Handle a text message from this sender
					switch(text) {
						case "test":
							createTextMessage(sender, "Test reply!");
							break;
						case "begin":
							firstPromise = handlePostbacks({sender: sender}, properties.facebook_get_started_payload)
							break;
						case "account":
							fetchUserData(sender);
							break;
						case "location":
							setTimeZone(sender)
							break;
						case "subscribe":
							subscribeUser(sender)
							break;
						case "unsubscribe":
							unsubscribeUser(sender)
							break;
						case "subscribestatus":
							subscribeStatus(sender)
							break;
						case "test memory":
							newTimeBasedMemory(sender)
							break;
						case "set timezone":
							setLocation(sender)
							break;
						case "whats my time zone":
							userLocation(sender)
							break;
						case "test this":
							updateUserLocation(sender, "Bristol")
							break;
						default: {
							var result = {}
							const extraData = event.message.attachments ? { attachments: event.message.attachments } : null
							firstPromise = intentConfidence(sender, text, context)
							setContext(sender, 'apiaiContexts', null) // Maybe don't always want to delete this straight away?
						}
					}
					setContext(sender, 'expectingAttachment', null);
				} else if ((attachments = event.message.attachments)) {
					if (!attachments[0].payload.sticker_id) {
						firstPromise = prepareAttachments({sender: sender}, attachments)
					}
					else {
						const p = Q.defer()
						logger.info('Sticker sent - sending no response')
						p.resolve()
						firstPromise = p.promise
					}
				}
			}

			if (!firstPromise || !firstPromise.then) {
				const message = createTextMessage(sender, 'Sorry, I didn\'t understand that!') // Should use GiveUp function
				firstPromise = createMessagePromise({sender: sender}, message)
			}
			firstPromise
			.then(function(res) {
				logger.trace('res:', res)
				const responseMessage = res ? getResponseMessage(res) : null
				logger.trace('responseMessage:', responseMessage)
				logger.trace('responseMessage first message data:', responseMessage.messageData[0].data)
				if (res && res.memories) { //Not sure if this is the right condition?
					setContext(sender, 'lastAction', res)
				}
				if (responseMessage) responseMessage.messageData.push.apply(responseMessage.messageData, onboardingCheck(sender, res.requestData.intent))
				d.resolve(responseMessage)
			}).then(function() {

			}).catch(function(e) {
				logger.error(e)
				d.reject(e)
			}).done()
		});
	} catch(e) {
		logger.error('-- Error processing the webhook! --')
		logger.error(e)
		d.reject(e)
	}
	return d.promise
}

const onboardingCheck = function(sender, intent) {
	if (getContext(sender, 'onboarding')) {
		switch (intent) {
			case 'storeMemory':
				const textMessage = createTextMessage(sender, "Now try typing: \n\nWhat\'s my secret superpower?")
				return [{data: textMessage, delay: 2000}]
				break;

			case 'query':
				const textMessage1 = createTextMessage(sender, "Actually you now have two powers! With me, you also get the power of Unlimited Memory 😎😇🔮")
				const textMessage2 = createTextMessage(sender, "Now feel free to remember anything below - text, images, video links you name it...")
				setContext(sender, 'onboarding', false);
				return [{data: textMessage1, delay: 2000}, {data: textMessage2, delay: 4000}]
				break;

			default:
				return []
		}
	} else {
		return []
	}
}


// not sure if this method is needed any longer as get started seems to work
/*exports.createGetStarted = function(req, res) {
  logger.trace("did this even work or get called?");
  var data = {
    setting_type: "call_to_actions",
    thread_state: "new_thread",
    call_to_actions:[{
      payload:"first connection"
    }]
  };
  prepareAndSendMessages(data);
}

curl -X POST -H "Content-Type: application/json" -d '{
   "setting_type":"call_to_actions",
   "thread_state":"new_thread",
   "call_to_actions":[
     {
       "payload":"first_connection"
     }
   ]
 }' "https://graph.facebook.com/v2.6/me/thread_settings?access_token=EAASK9LRTpCQBAGuZBYYhyJZBA9ZBfxZAX8X431tDkpZCEJzFu1JjrAANKEAD4kq86kAxVdsEIPNc0BHlLHo0wCh9vZAQO6qCSTGAvZA33Wwq8mrDcZCF6J41Lu7KVIA9pSIcQAS3ZCAW5nruqj9BDH8h7PKenNJ0x3a29lv6VTWcszwZDZD"

*/

const handlePostbacks = function(requestData, payload) {
	const d = Q.defer()
	try {
		const payloadCode = payload.split('-data-')[0]
		const payloadData = payload.split('-data-')[1]
		switch (payloadCode) {
			case properties.facebook_get_started_payload: //Should this be in messenger.js?
				// sendSenderAction(sender, 'typing_on');
				var allMessageData = firstMessage(requestData.sender)
				d.resolve({requestData: requestData, messageData: allMessageData})
				break;

			case "REQUEST_SPECIFIC_MEMORY":
				var data = getContext(sender, 'lastAction')
				data.requestData.hitNum = parseInt(payloadData)
				delete data.messageData
				d.resolve(data)
				break;

			default:
				d.reject()
		}
	} catch(e) {
		logger.error(e)
		d.reject(e)
	}
	return d.promise
}

const handleQuickReplies = function(requestData, quickReply) {
	logger.trace(handleQuickReplies)
	const d = Q.defer()
	const sender = requestData.sender
	const quickReplyCode = quickReply.payload.split('-data-')[0]
	const quickReplyData = quickReply.payload.split('-data-')[1]
	switch (quickReplyCode) {
		case "USER_FEEDBACK_MIDDLE":
			var messageData = sendCorrectionMessage(sender)
			d.resolve({requestData: requestData, messageData: [{data: messageData}]})
			break;

		case "USER_FEEDBACK_BOTTOM":
			var messageData = sendCorrectionMessage(sender)
			d.resolve({requestData: requestData, messageData: [{data: messageData}]})
			break;

		case "CORRECTION_STORE_TO_QUERY":
			api.deleteMemories(sender, getContext(sender, 'lastAction').memories[0].objectID)
			.then(function() {
				return intentConfidence(sender, getContext(sender, 'lastAction').requestData.resolvedQuery, {intent: 'query'})
			}).then(function(res) {
				d.resolve(res)
			}).catch(function(e) {
				logger.error(e)
				d.reject(e)
			})
			break;

		case "CORRECTION_QUERY_TO_STORE":
			intentConfidence(sender, getContext(sender, 'lastAction').requestData.resolvedQuery, {intent: 'storeMemory'})
			.then(function(res) {
				d.resolve(res)
			}).catch(function(e) {
				logger.error(e)
				d.reject(e)
			})
			break;

		case "CORRECTION_QUERY_DIFFERENT":
			var data = getContext(sender, 'lastAction')
			data.requestData.hitNum = data.requestData.hitNum+1 || 1
			delete data.messageData
			d.resolve(data)
			break;

		case "CORRECTION_ADD_ATTACHMENT":
			const updatedMemory = getContext(sender, 'lastAction').memories[0]
			if (getContext(sender, 'holdingAttachments')) {
				updatedMemory.attachments = getContext(sender, 'holdingAttachments')
				updatedMemory.hasAttachments = true
				setContext(sender, 'holdingAttachments', null)
			} else {
				logger.error('No attachment found')
				d.reject('No attachment found')
			}
			intentConfidence(sender, updatedMemory.sentence, updatedMemory)
			.then(function(res) {
				d.resolve(res)
			}).catch(function(e) {
				logger.error(e)
				d.reject(e)
			})
			break;

		case "CORRECTION_CAROUSEL":
			var messageData = getCarousel(sender, getContext(sender, 'lastAction').memories)
			d.resolve({requestData: requestData, messageData: [{data: messageData}]})
			break;

		case "CORRECTION_GET_DATETIME":
			var messageData = createTextMessage(sender, "Sure thing - when shall I remind you?");
			setContext(sender, 'apiaiContexts', [{name: 'requiring-date-time', lifespan: 1}])
			d.resolve({requestData: requestData, messageData: [{data: messageData}]})
			break;

		case "CORRECTION_GET_URL":
			var messageData = createTextMessage(sender, "Sure thing - what's the url?");
			setContext(sender, 'apiaiContexts', [{name: 'requiring-url', lifespan: 1}])
			d.resolve({requestData: requestData, messageData: [{data: messageData}]})
			break;

		case "PREPARE_ATTACHMENT":
			var messageData = createTextMessage(sender, "Sure thing - type your message below and I'll attach it...")
			d.resolve({requestData: requestData, messageData: [{data: messageData}]})
			break;

		case "INTENT":
			requestData.intent = quickReplyData
			d.resolve({requestData: requestData, statusCode: 200})
			break;

		default:
			logger.info('Unknown quick reply - sending no response')
			d.resolve()
			break;
	}
	return d.promise
}

const createAttachments = function(attachments, sender) {
	logger.trace(createAttachments, attachments, sender)
	const type = attachments[0].type;
	const url = attachments[0].url || attachments[0].payload.url
	const attachment = {
		type: type,
		url: url
	}
	if (sender) attachment.userID = sender
	return [attachment]
}

// Prepare attachments for the next message to contain text and seal the deal
const prepareAttachments = function(requestData, attachments) {
	logger.trace()
	const d = Q.defer()
	const sender = requestData.sender
	attachments = createAttachments(attachments, sender)
	setContext(sender, 'holdingAttachments', attachments);
	const quickReplies = [
		["⤴️ Previous", "CORRECTION_ADD_ATTACHMENT"],
		["⤵️ Next", "PREPARE_ATTACHMENT"],
	];
	const messageData = createTextMessage(sender, "Did you want me to add this " + attachments.type + " to the previous message or the next one?", quickReplies)
	d.resolve({requestData: requestData, messageData: [{data: messageData}]})
	return d.promise
}



function giveUp(sender) {
	logger.trace(giveUp)
	sendGenericMessage(sender, 'dunno', getContext(sender, 'consecutiveFails'));
}

function sendGenericMessage(recipient, type, counter) {
	logger.trace(sendGenericMessage, recipient, type, counter)
	const d = Q.defer()
  // Bot didnt know what to do with message from user
	if (!Randoms.texts[type])
		type = 'dunno';
	if (type == 'dunno') {
		setContext(sender, 'failing', true)
		increaseContext(sender, 'totalFailCount')
		if (getContext(sender, 'consecutiveFails') < 4) increaseContext(sender, 'consecutiveFails');
	}
	if (typeof counter!=undefined) counter = 0
	const text = (Array.isArray(Randoms.texts[type][0])) ? Randoms.texts[type][counter] : Randoms.texts[type];
  var messageData = {
    recipient: recipient,
    message: {
      text: text[Math.floor(Math.random() * text.length)]
    }
  };
	logger.trace('messageData', messageData)
  return messageData

	// now won't do this yet

	if (false) {
		try {
			if (Randoms.gifs[type] && Math.floor(Math.random()*5)==0) { // (C[recipientId].totalFailCount < 5 || Math.floor(Math.random()*(C[recipientId].totalFailCount/4))==0 )) {
				const gif = (Array.isArray(Randoms.gifs[type][0])) ? Randoms.gifs[type][counter] : Randoms.gifs[type];
				if (gif) {
					var messageData2 = {
						recipient: recipient,
						message: {
							attachment: {
								type: "image",
								payload: {
									url: gif[Math.floor(Math.random() * gif.length)]
								}
							}
						}
					};
					d.resolve(messageData2);
				}
			}
		} catch(e) {
			logger.trace(e);
		}
	}
}



const createMessagePromise = function(requestData, messageData) {
	const d = Q.defer()
	if (messageData) {
		const data = {requestData: requestData, messageData: [{data: messageData}]}
		d.resolve(data)
	} else {
		d.reject()
	}
	return d.promise
}


function createTextMessage(recipient, message, quickReplies) {
	logger.trace(createTextMessage, recipient, message, quickReplies)
	try {

		if (typeof message === 'string') {
			message = {text: message}
		}
		const messageData = {
			recipient: recipient,
			message: {}
		};
		if (message.text) {
			message.text = message.text.replace(/"/g, '\"').replace(/'/g, '\'').replace(/\//g, '\/').replace(/‘/g, '\‘').replace(/’/g, '\’').replace(/’/g, '\’');
			messageData.message.text = message.text
		}
		if (message.attachment) {
			const messageAttachment = message.attachment.attachment_id ? {
				type: message.attachment.type,
				payload: {
					attachment_id: message.attachment.attachment_id
				}
			} : {
				type: message.attachment.type,
				payload: {
					url: message.attachment.url
				}
			}
			messageData.message.attachment = messageAttachment
		}
		messageData.message.quick_replies = getQuickReplies(quickReplies, true)
		return messageData
	} catch(e) {
		logger.error(e)
	}
}
function getCarouselMessage(recipient, elements, delay, quickReplies) {
	logger.trace(getCarouselMessage);
	// messageText = messageText.replace(/"/g, '\"').replace(/'/g, '\'').replace(/\//g, '\/').replace(/‘/g, '\‘');
	// messageText = messageText.replace(/"/g, '\"').replace(/'/g, '\'').replace(/\//g, '\/').replace(/‘/g, '\‘').replace(/’/g, '\’').replace(/’/g, '\’');
  var messageData = {
    recipient: recipient,
		message: {
			attachment: {
				type: 'template',
				payload: {
					template_type: 'generic',
					elements: elements
				}
			}
		}
  };
	messageData.message.quick_replies = getQuickReplies(quickReplies, true)
	if (messageData.message.quick_replies && !messageData.message.quick_replies.length) delete messageData.message.quick_replies
  return messageData
}
// function sendAttachmentMessage(recipient, attachment, delay, quickReplies) {
// 	logger.trace()
// 	const messageAttachment = attachment.attachment_id ? {
// 		type: attachment.type,
// 		payload: {
// 			attachment_id: attachment.attachment_id
// 		}
// 	} : {
// 		type: attachment.type,
// 		payload: {
// 			url: attachment.url
// 		}
// 	}
//   var messageData = {
//     recipient: recipient,
//     message: {
// 			attachment: messageAttachment
//     }
//   };
// 	messageData.message.quick_replies = getQuickReplies(quickReplies, !quickReplies || quickReplies.length)
//   return d.resolve(messageData);
// }
function sendCorrectionMessage(recipient) {
	logger.trace();
  var messageData = {
    recipient: recipient,
    message: {
			text: "Whoops - was there something you would have preferred me to do?"
    }
  };
	logger.log(getContext(sender, 'lastAction'))
	switch (getContext(sender, 'lastAction').requestData.intent) {
		case 'setTask.dateTime':
		case 'setTask.URL':
		case 'storeMemory':
			var quickReplies = [
				["💭 Recall a memory", "CORRECTION_STORE_TO_QUERY"]
			]
			messageData.message.quick_replies = getQuickReplies(quickReplies)
			break;
		case 'query':
			var quickReplies = [
				["🔀 Recall a different memory", "CORRECTION_QUERY_DIFFERENT"],
				["👨‍👩‍👧‍👦 Show me all related memories", "CORRECTION_CAROUSEL"],
				["💬 Store this memory", "CORRECTION_QUERY_TO_STORE"],
			]
			messageData.message.quick_replies = getQuickReplies(quickReplies)
			if (getContext(sender, 'lastAction').failed) {
				messageData.message.quick_replies = [messageData.message.quick_replies[2]]
			}
			break;
	}
  return messageData
}

function firstMessage(recipient) {
	logger.trace();
	setContext(sender, 'onboarding', true);

	const messages = [
		"Hello there!",
		"Nice to meet you. I'm ForgetMeNot, your helpful friend with (if I say so myself) a pretty darn good memory! 😇",
		"Ask me to remember things and I'll do just that. Then later you can ask me about them and I'll remind you! 😍",
		"To get started, let's try an example. Try typing the following: \n\nMy secret superpower is invisibility",
	]

	const allMessageData = messages.map(function(text, i) {
		return {
			data: {
				recipient: recipient,
				message: {
					text: text
				}
			},
			delay: i*3000
		}
	})
	return allMessageData
}


const getQuickReplies = function(quickReplies, useDefaults) {
	if (!quickReplies || !quickReplies.length) {
		if (useDefaults) {
			quickReplies = [
				["😍", "USER_FEEDBACK_TOP"],
				["✏️", "USER_FEEDBACK_MIDDLE"],
				["😔", "USER_FEEDBACK_BOTTOM"],
			]
		} else {
			return null
		}
	}
	return quickReplies.map(function(r) {
		return {
			content_type: "text",
			title: r[0],
			payload: r[1]
		}
	})
}

function fetchUserDataFromFacebook(recipientId) {
	logger.trace(fetchUserDataFromFacebook);
	const d = Q.defer()
	logger.trace(properties.facebook_user_endpoint + recipientId + "?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=" + (process.env.FACEBOOK_TOKEN || properties.facebook_token));
  request({
    uri: properties.facebook_user_endpoint + recipientId + "?fields=first_name,last_name,profile_pic,locale,timezone,gender&access_token=" + (process.env.FACEBOOK_TOKEN || properties.facebook_token),
    method: "GET"
  }, function (error, response, body) {
		if (error) {
			logger.trace(error);
			d.resolve(error)
		} else {
			logger.trace(body);
			d.resolve(JSON.parse(body))
		}
	});
	return d.promise
}



function intentConfidence(sender, message, extraData) {
	logger.trace(intentConfidence, sender, message, extraData)
	const d = Q.defer()
	const data = extraData || {};
	data.sender = sender
	data.text = message
	if (apiaiContexts = getContext(sender, 'apiaiContexts')) {
		data.contexts = apiaiContexts
		if (['requiring-date-time', 'requiring-url'].indexOf(apiaiContexts[0].name) > -1 ) {
			data.lastAction = getContext(sender, 'lastAction')
		}
	}
	if (data.attachments) {
		data.attachments = createAttachments(data.attachments)
		data.hasAttachments = true
	} else if (getContext(sender, 'holdingAttachments')) {
		data.attachments = getContext(sender, 'holdingAttachments')
		data.hasAttachments = true
		setContext(sender, 'holdingAttachments', null)
	}
  api.acceptRequest(data)
  .then(function(res) {
		if (res.requestData && res.requestData.intent == "Default Fallback Intent")
			res.requestData.intent = 'query'
		d.resolve(res)
  }).catch(function(e) {
    logger.error(e);
		const err = (e==404) ? 500 : e
		d.reject(err)
  })
	return d.promise
}

const getResponseMessage = function(data) {
	logger.trace(getResponseMessage, data)
	const sender = data.requestData.sender
	var m = data.memories ? data.memories[0] : null
	var intent = data.requestData.intent
	if (intent == 'provideDateTime') intent = 'setTask.dateTime'
	if (intent == 'provideURL') intent = 'setTask.URL'
	var followUp = null
	switch (data.statusCode) {
		case 200:
			logger.trace('m', m)
			if (m && !m.sentence) m.sentence = m.description || m.content
			logger.trace('m', m)

			switch (intent) {
				case 'query':
					setContext(sender, 'lastResults', data.memories)
					setContext(sender, 'lastResultTried', 0)
					if (data.requestData.carousel) {
						// @TODO: Send carousel
					} else if (data.memories.length - (data.requestData.hitNum || 0) > 0) {
						m = data.memories[(data.requestData.hitNum || 0)]
						m.resultSentence = m.sentence;
					} else {
						data.messageData = [{data: createTextMessage(sender, {text: 'Sorry I couldn\'t find any memories related to that!'})}]
					}
					break;

				case 'storeMemory':
					m.resultSentence = "I've now remembered that for you! " + (m.title ? m.title + '\n\n' : '') + m.sentence;
					break;

				case 'setTask.URL':
					m.resultSentence = "I've now set that reminder for you! 🔔 \n\n"
																	+ m.actionSentence + '\n'
																	+ '🖥 ' + m.triggerURL;
					break;

				case 'setTask.dateTime':
					m.resultSentence = "I've now set that reminder for you! 🕓 \n\n"
					 												+ m.actionSentence + '\n'
																	+ '🗓 ' + m.triggerDateTime.toDateString() + '\n'
																	+ '⏱ ' + m.triggerDateTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'} )
					var extraQuickReplies = [
						["You bet", "INTENT-data-affirmation",],
						["No, change the time please!", "CORRECTION_GET_DATETIME"]
					]
					if (m.triggerDateTime.getHours() >= 23 || m.triggerDateTime.getHours() <= 5) followUp = createTextMessage(data.requestData.sender, "Just to check - I've set this reminder for a slightly unsociable hour..! 😴 Was that what you meant?", extraQuickReplies)
					if (m.triggerDateTime < new Date()) {
						setContext(sender, 'apiaiContexts', [{name: 'requiring-date-time', lifespan: 1}])
						data.messageData = [{data: createTextMessage(data.requestData.sender, "Hmmm, I understood that date & time to be in the past...! ⏳ Can you try typing it again?")}]
					}

					break;

				case 'reminder.URL':
					m.resultSentence = '🔔 Reminder! ' + m.actionSentence
					break;

				case 'reminder.dateTime':
					m.resultSentence = '🔔 Reminder! ' + m.actionSentence
					break;

				default:
					if (!data.messageData) {
						data.messageData = [{data: sendGenericMessage(data.requestData.sender, intent)}]
					}
					break;
			}
			break;

		case 412:
			switch (intent) {
				case 'setTask.URL':
					setContext(sender, 'lastAction', data);
					var quickReplies = [
						["🖥 URL", "CORRECTION_GET_URL"],
						["📂 Just store", "CORRECTION_QUERY_TO_STORE"],
						["⏱ Date/time", "CORRECTION_GET_DATETIME"],
					];
					m.resultSentence = "Just to check - did you want me to remind you when you go to a certain URL, or just store this memory for later?"
					break;

				case 'setTask.dateTime':
					setContext(sender, 'lastAction', data);
					var quickReplies = [
						["⏱ Date/time", "CORRECTION_GET_DATETIME"],
						["📂 Just store", "CORRECTION_QUERY_TO_STORE"],
						["🖥 URL", "CORRECTION_GET_URL"],
					];
					m.resultSentence = "Just to check - did you want me to remind you at a certain date or time, or just store this memory for later?"
					break;

				default:
					break;
			}
			break;
		default:
			break;
	}
	logger.log(m)
	if (!data.messageData && m) {
		m = prepareResult(sender, m)
		data.messageData = [{data: createTextMessage(sender, {text: m.resultSentence || m.actionSentence || m.sentence, attachment: m.attachments && m.attachments[0] || null}, quickReplies)}]
		if (followUp) data.messageData.push({data: followUp, delay: 2000})
	}

	// ???
	if (data.messageData && data.messageData[0] && data.messageData[0].data && data.messageData[0].data.message && !getContext(data.messageData[0].data.recipient.id, 'failing')) {
		setContext(data.messageData[0].data.recipient.id, 'consecutiveFails', 0)
	}

	return data
}


const getCarousel = function(sender, memories) {
	if (memories.length) {
		const elements = memories.map(function(card, i) {
			return {
				title: card.sentence,
				subtitle: ' ',
				image_url: card.hasAttachments && card.attachments[0].url.indexOf('cloudinary') > -1 ? card.attachments[0].url : 'http://res.cloudinary.com/forgetmenot/image/upload/v1504715822/carousel_sezreg.png',
        buttons: [
          {
            type:"postback",
            title:"View full memory",
            payload:"REQUEST_SPECIFIC_MEMORY-data-"+i
          }
        ]
			}
		})
		return getCarouselMessage(sender, elements)
	} else {
		logger.trace('No memories - rejecting carousel');
		throw new Error(404)
	}
}
// -------------------------------------------- //





function prepareResult(sender, memory) {
	logger.trace(prepareResult);
	var sentence = memory.resultSentence || memory.sentence;
	if (memory.listCards) {
		sentence += '\n\n- ' + memory.listCards.join('\n- ')
		// sentence += '\n\n' + memory.listItems.map(function(key) {
		// 	const card = memory.listCards[key]
		// 	const text = card.sentence
		// 	return getEmojis(text, card.entities, 1, true) + ' ' + text
		// }).join('\n')
	}
	if (memory.attachments) {
		if (~[".","!","?",";"].indexOf(sentence[sentence.length-1])) sentence = sentence.substring(0, sentence.length - 1);;
		sentence+=" ⬇️";
		// sendAttachmentMessage(sender, memory.attachments[0])
	}
	memory.resultSentence = sentence
	return memory
}

function tryAnotherMemory(sender) {
	logger.trace(tryAnotherMemory);
	const memory = getContext(sender, 'lastResults')[getContext(sender, 'lastResultTried')+1];
	prepareResult(sender, memory);
	increaseContext(sender, 'lastResultTried');
}
// -------------------------------------------- //




const getEmojis = function(text, entities, max, strict) {
	if (strict) {
		const words = entities['noun'] || entities['action-noun'] || entities['verb'] || entities['action-verb']
		if (words) text = words.join(' ')
	}

	return (emoji.translate(text.replace(/[0-9]/g, ''), true).substring(0, 2) || '✅')
}




exports.setContext = setContext;
exports.getContext = getContext;











// --- Not currently in use ---


const googleMapsClient = require('../api_clients/googleMapsClient.js');
// models for users and the memories/reminders they submit
const user = require('../model/user');
const timeMemory = require('../model/timeBasedMemory');
const keyValue = require('../model/rememberKeyValue');
// user information global variable
var first_name = "";
var id = "";






/* Save a user to the database */
function subscribeUser(id) {
	logger.trace(subscribeUser);
  var newUser = new user({
    fb_id: id,
    location: "placeholder"
  });
  user.findOneAndUpdate(
    {fb_id: newUser.fb_id},
    {fb_id: newUser.fb_id, location: newUser.location},
    {upsert:true}, function(err, user) {
      if (err) {
        createTextMessage(id, "There was error subscribing you");
      } else {
        logger.trace('User saved successfully!');
        createTextMessage(newUser.fb_id, "You've been subscribed!")
      }
  });
}

/* remove user from database */
function unsubscribeUser(id) {
	logger.trace(unsubscribeUser);
  // built in remove method to remove user from db
  user.findOneAndRemove({fb_id: id}, function(err, user) {
    if (err) {
      createTextMessage(id, "There was an error unsubscribing you");
    } else {
      logger.trace("User successfully deleted");
      createTextMessage(id, "You've unsubscribed");
    }
  });
}

/* subscribed status */
function subscribeStatus(id) {
	logger.trace(subscribeStatus);
  user.findOne({fb_id: id}, function(err, user) {
    subscribeStatus = false;
    if (err) {
      logger.trace(err);
    } else {
      if (user != null) {
        subscribeStatus = true;
      }
      createTextMessage(id, "Your status is " + subscribeStatus);
    }
  });
}

/* find the users location from the db */
function userLocation(id) {
	logger.trace(userLocation);
  user.findOne({fb_id: id}, function(err, user) {
    location = "";
    if (err) {
      logger.trace(err);
    } else {
      if (user != null) {
        location = user.location;
        logger.trace(location);
        createTextMessage(id, "We currently have your location set to " + location);
      }
    }
  });
}

function updateUserLocation(id, newLocation) {
	logger.trace(updateUserLocation);
  user.findOneAndUpdate({fb_id: id}, {location: newLocation}, function(err, user) {
    if (err) {
      logger.trace(err);
    } else {
      if (user != null) {
        location = user.location;
        logger.trace(location);
        createTextMessage(id, "Your location has been updated to " + newLocation);
      }
    }
  });
}




// -----------User Memory Code Below--------------- //
function newTimeBasedMemory(id) {
	logger.trace(newTimeBasedMemory);
  var newTimeMemory = new timeMemory({
    fb_id: id,
    subject: "WiFi",
    value: "wifipassword"
  });
  timeMemory.findOneAndUpdate(
    {fb_id: newTimeMemory.fb_id},
    {fb_id: newTimeMemory.fb_id, subject: newTimeMemory.subject, value: newTimeMemory.value},
    {upsert:true}, function(err, user) {
      if (err) {
        createTextMessage(id, "I couldn't remember that");
      } else {
        logger.trace('User memory successfully!');
        createTextMessage(newTimeMemory.fb_id, "I've now remembered that for you")
      }
  });
}

function returnTimeMemory(id) {
	logger.trace(returnTimeMemory);
  timeMemory.findOne({fb_id: id}, function(err, memory) {
    if (err) {
      logger.trace(err);
    } else {
      if (memory != null) {
        subject = memory.subject;
        value = memory.value;
        logger.trace(subject + " " + value);
        createTextMessage(id, "Your " + subject + " password is " + value);
      }
    }
  });
}
// -------------------------------------------- //

// -----------User Key Value Reminder Code Below--------------- //
function newKeyValue(id, subject, value) {
	logger.trace(newKeyValue);
  var amendKeyValue = new keyValue({
    fb_id: id,
    subject: subject,
    value: value
  });
  keyValue.findOneAndUpdate(
    {fb_id: amendKeyValue.fb_id, subject: amendKeyValue.subject},
    {fb_id: amendKeyValue.fb_id, subject: amendKeyValue.subject, value: amendKeyValue.value},
    {upsert:true}, function(err, user) {
      if (err) {
        createTextMessage(id, "I couldn't remember that");
      } else {
        logger.trace('User memory successfully!');
        createTextMessage(amendKeyValue.fb_id, "I've now remembered that for you, if you want to recall it just ask \"whats my " + amendKeyValue.subject.replace(/"/g, '') + "?\"");
      }
  });
}

function returnKeyValue(id, subject) {
	logger.trace(returnKeyValue);
  keyValue.find({fb_id: id, subject: subject}, function(err, memory) {
    if (err) {
      logger.trace(err);
    } else {
      if (memory != null) {
        logger.trace(memory + "\n");
        var returnValue = memory[0].value;
        returnValue = returnValue.replace(/"/g, '');
        createTextMessage(id, returnValue);
      }
    }
  });
}
// -------------------------------------------- //




// -----------Google API Code Below--------------- //
/* query geolocation */
function setTimeZone(sender) {
	logger.trace(setTimeZone);
  // Fetch timezone from lat & long.
  googleMapsClient.timezone({
      location: [-33.8571965, 151.2151398],
      timestamp: 1331766000,
      language: 'en'
    }, function(err, response) {
      if (!err) {
          createTextMessage(sender, "From what you've told me I think you're based in " + response.json.timeZoneId + " am I right?");
        logger.trace(response);
      }
    });
}

/* set the location for a user */
function setLocation(sender) {
	logger.trace(setLocation);
  var count = 0;
  // Fetch location
  googleMapsClient.geocode({
      address: 'Sydney Opera House'
  }, function(err, response) {
    if (!err) {
      var coordinates = response.json.results[0].geometry.location;
      var lat = coordinates.lat;
      var lng = coordinates.lng;
      logger.trace(coordinates);
      return coordinates;
      //createTextMessage(sender, "I think I found your location " + lat + " " + lng);
      //createTextMessage(sender, "done that for you");
    }
  });
}
// -------------------------------------------- //
