const chatbotController = require('../controller/chatbot')

const properties = require('../config/properties.js')
const schedule = require('node-schedule')
const chrono = require('chrono-node')
const crypto = require("crypto")
const Q = require("q")

const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'trace'})
// const debug = true
// const logger = debug ? tracer.colorConsole({level: 'log'}) : {trace:()=>{},log:()=>{}}
// tracer.setLevel('error')

var bot;


var clientMessageFunction = () => new Promise(function(resolve, reject) { resolve() })
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

chatbotController.acceptClientMessageFunction((response) => {
	const d = Q.defer()
	handleResponseGroup(response)
	.then((res) => {
		d.resolve(res)
	}).catch((e) => {
		logger.error(e)
		d.reject(e)
	})
	return d.promise
})

function scopeMessage(botKeychain, message) {
	switch (message.channel.charAt(0)) {
		// it's a public channel
		case "C":
			message.channelType = "C";
			// message.sender = message.channel; // Address the channel/group, not the user.
			message.formsOfAddress = new RegExp(`<?@?(forgetmenot|${botKeychain.bot_user_id})>?[,\s ]*`,'i');
			break;
		// it's either a private channel or multi-person DM
		case "G":
			message.channelType = "G";
			// message.sender = message.channel; // Address the channel/group, not the user.
			message.formsOfAddress = new RegExp(`<?@?(forgetmenot|${botKeychain.bot_user_id})>?[,\s ]*`,'i');
			break;
		// it's a DM with the user
		case "D":
			message.channelType = "D";
			// message.sender = message.user;
			message.formsOfAddress = new RegExp(``,'i'); // listen to all messages
			break;
	}

	return message;
}

const transformMessage = function(botKeychain, message) {
	// DMs have a slightly different format.
	if(message.message) Object.assign(message, message.message)

	message = scopeMessage(botKeychain, message);

	message.sender = {
		user: message.user,
		channel: message.channel,
		team: message.team
	}

	console.log("🔧🔧⚙️🔬 Transforming an API-able message: ", message)

	return message;
}

exports.handleMessage = (botKeychain, message) => new Promise((resolve, reject) => {
	logger.trace('handleMessage', botKeychain, message)

	// * Transform the message so the bot replies to the right user/channel etc.
	// * Get rid of unwanted addressing (e.g. @forgetmenot)
	message = transformMessage(botKeychain, message)

	// Respond only when the bot's involved
	// But not if it's the bot posting.
	// logger.log("Event heard", message)
	message.usable = (message.type !== 'desktop_notification' && (!message.text || message.formsOfAddress.test(message.text)) && !message.bot_id)

	// Gendit bot post, ABORT
	if(!message.usable) {
		console.log('aborting!')
		resolve(false)
		return false
	}
	console.log('😈 CHATBOT listens to:', message)

	// Remove reference to @forgetmenot
	if(message.text) message.text = message.text.replace(message.formsOfAddress, '')

	// Transform into Facebook format.
	var messagePackage = { entry: [ { messaging: [ {
		sender: message.sender,
		message: { },
		platform: 'slack'
	} ] } ] }

	if(message.text) {
		messagePackage.entry[0].messaging[0].message.text = message.file && message.file.initial_comment ? message.file.initial_comment.comment : message.text;
		// Message, or if a file, use file comments rather than fugly long Slack strings
		message.text = message.text.replace(message.formsOfAddress,'');
	}

	if(message.quick_reply) {
		messagePackage.entry[0].messaging[0].message.quick_reply = {
			payload: message.quick_reply
		}
	}

	// Package it up, add it to the messages for API to figure out.
	if(message.file) {

		var fileTypes = {
			jpg: "image",
			jpeg: "image",
			png: "image"
		}
		var type = fileTypes[message.file.filetype] ? fileTypes[message.file.filetype] : "fallback"

		messagePackage.entry[0].messaging[0].message.attachments = [{
			type: type,
			url: message.file.permalink,
			payload: {
				url: message.file.permalink
			}
		}]

		// // NB: this is packaged as the second in a two-part message array.
		// // TODO: Have chatbot **automatically** treat this message[1]
		// //	as the attachment of the "PREVIOUS" message (i.e. message[0])
		// messagePackage.entry[0].messaging.push({
		// 	sender: { id: message.channel },
		// 	message: {
		// 		attachments: [{
		// 			type: type,
		// 			url: message.file.permalink,
		// 			payload: {
		// 				url: message.file.permalink
		// 			}
		// 		}]
		// 	}
		// })
		console.log("Packaged a file")
	}

	logger.trace("TO API==>", JSON.stringify(messagePackage, null, 2))

  chatbotController.handleMessage(messagePackage)
  .then(function(apiResult) {
    logger.trace("FROM API==>", apiResult && apiResult.messageData ? JSON.stringify(apiResult.messageData, null, 2) : "No response text.")
    return handleResponseGroup(apiResult)
  }).then(res => {
		resolve(res)
	})
	.catch(function(e) {
    logger.error(e);
  })
})

function handleResponseGroup(response) {
	logger.trace(handleResponseGroup, response)
  const d = Q.defer();
  const promises = response && response.messageData ? response.messageData.map(function(singleResponse) {
		logger.trace(singleResponse.data)
		return sendResponseAfterDelay(singleResponse.data, (singleResponse.delay || 0) * 1000)
	}) : []
  Promise.all(promises)
  .then(function(res) {
    d.resolve(res)
  }).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
  return d.promise;
}

function sendResponseAfterDelay(thisResponse, delay) {
	logger.trace(sendResponseAfterDelay, thisResponse, delay)
	const d = Q.defer();

	// For push-reminders where Chatbot specifies recipient.id
	// Otherwise, look for `channel.id` and `channel` (the format for different Slack event types vary)
	// thisResponse.recipient = thisResponse.recipient.id || thisResponse.channel.id || thisResponse.channel;
	// rtm.sendTyping(emitter.recipient)

	var params = {
		attachments: []
	}

	if(thisResponse.message.attachment && thisResponse.message.attachment.payload) {
		if(thisResponse.message.attachment.payload.elements) {
			logger.log("Displaying a list of attachments")

			params.attachments.push({
        "fallback": "Here's a list of related memories.",
				"pretext": "",
        "footer": "Related reminders"
			})

			thisResponse.message.attachment.payload.elements.forEach(memory => {
				var memoryAttachment = {
	        "fallback": "Inspect memory",
	        "color": "#FED33C",
					"callback_id": thisResponse.recipient, // Specify who the bot is going to speak on behalf of, and where.
	        "title": memory.title,
					"text": "",
					"thumb_url": memory.image_url,
					"actions": []
	      }

				// Seems these haven't been implemented in Chatbot.js yet
				memory.buttons.forEach(button => {
					memoryAttachment.actions.push({
						"type": "button",
						"name": button.payload,
						"text": button.title,
						"value": button.title
					})
				})

				params.attachments.push(memoryAttachment)
			})
		} else if(thisResponse.message.attachment.type == "image") {
			// Display an attachment
			// NB: Slack bug (https://github.com/slackhq/slack-api-docs/issues/53) where image_url doesn't show at all :/
			logger.log("Displaying an image attachment")

			params.attachments.push({
        "fallback": "An image that's attached for your memory.",
				"thumb_url": thisResponse.message.attachment.payload.url,
				"text": "Attached image: "+thisResponse.message.attachment.payload.url,
        // "footer": "Attached image"
			})
		}
	}

	if(thisResponse.message.quick_replies && thisResponse.message.quick_replies.length > 0) {
		logger.log("Adding buttons");

		params.attachments.push({
			"footer": "Quick actions",
			"fallback": "Oops, you can't quick-reply",
			"callback_id": thisResponse.recipient, // Specify who the bot is going to speak on behalf of, and where.
      "color": "#FED33C",
      "attachment_type": "default",
			"actions": []
    })

		thisResponse.message.quick_replies.forEach(reply => {
			params.attachments[params.attachments.length-1].actions.push({
				"type": "button",
				"name": reply.payload,
				"text": reply.title,
				"value": reply.title
			})
		})
	}
	// if (!thisResponse.sender_action) sendSenderAction(thisResponse.recipient.id, 'typing_on');
	setTimeout(function() {
		// if(params.attachments) console.log("Buttons should attach", params.attachments[0].actions)
		const messageData = {
			recipient: thisResponse.recipient.platformSpecific.channel,
			text: thisResponse.message.text,
			params: params
		}
		logger.trace('messageData', messageData)
		sendClientMessage(messageData)
		.then(x => {
			d.resolve(messageData)
		})
		.catch(err => d.reject("ERROR Emitted response",err))
	}, delay);
	return d.promise;
}

// For webhooks
exports.quickreply = function(reaction) {

	logger.log("Quick reply pressed", reaction)

	// Define this specific message sender as part of the conversational chain
	// Even if the bot itself is speaking on behalf of the user
	// var alias = `On behalf of ${reaction.channel.id.charAt(0) === 'D' ? reaction.user.name : "#"+reaction.channel.name}`
	var alias = `${reaction.user.name} via ForgetMeNot` // Maybe say when you're reacting for the group?
	// console.log("Bot posting as", alias, aliasDirectory[alias])

	// 1. Remove the UI buttons
	var noBtnMessage = reaction.original_message
	noBtnMessage.attachments = {}
	noBtnMessage.ts = reaction.message_ts
	noBtnMessage.channel = reaction.channel.id

	res.json(noBtnMessage)


	// 2. Post reply to slack on behalf of user
	const messageData = {
		recipient: reaction.callback_id,
		text: reaction.actions[0].value,
		params: {
			as_user: false,
			username: alias
		}
	}
	sendClientMessage(messageData)
	.then(() => {
		// 3. Post the payload to the API on behalf of user
		handleMessage({
				channel: reaction.callback_id, // converts to sender at handleMessage()
				quick_reply: reaction.actions[0].name // the payload string
			}
			// emitter({recipient: reaction.callback_id})
			// I get the feeling the Chatbot specifies the recipient.id anyway.
		)
	}).catch((e)=>logger.log(e))
}

exports.dropdown = function() {
	//
}
